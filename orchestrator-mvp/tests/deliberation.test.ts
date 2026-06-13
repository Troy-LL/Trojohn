import { describe, expect, it, vi } from 'vitest';
import {
  parseQuestionsFromOutputs,
  runDeliberation,
  runProposalRound,
  runQuestionRound,
} from '../src/deliberation.js';
import type { AppConfig } from '../src/config.js';
import { InProcessTransport } from '../src/transport/inprocess.js';
import { SimulatedNetworkTransport } from '../src/transport/simulated.js';
import type { WorkerConfig, WorkerResult } from '../src/types.js';
import { BaseWorker, type CallOptions } from '../src/workers/base.js';

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKey: 'test-key',
    confidenceThreshold: 0.72,
    r0GateThreshold: 0.85,
    defaultTimeoutMs: 5000,
    roundTimeoutMs: 500,
    deliberationRounds: 2,
    activeWorkers: ['factual', 'reasoning', 'advocate'],
    port: 3000,
    transport: 'inprocess',
    simLatencyMs: 50,
    simJitterMs: 10,
    simDropRate: 0,
    ollamaUrl: 'http://localhost:11434',
    similarityMode: 'tfidf',
    embeddingModel: 'nomic-embed-text',
    models: {
      factual: 'test-factual',
      reasoning: 'test-reasoning',
      advocate: 'test-advocate',
      local: 'test-local',
      judge: 'test-judge',
    },
    sandboxRoot: '/tmp/sandbox',
    logDir: '/tmp/logs',
    demoEdgeModels: false,
    criticalThinking: false,
    scratchpadMode: 'off' as const,
    dbPath: '/tmp/test.db',
    signalPort: 3001,
    ...overrides,
  };
}

function workerConfig(id: 'factual' | 'reasoning' | 'advocate'): WorkerConfig {
  return {
    id,
    role: id,
    provider: 'cursor',
    model: 'test-model',
    systemPrompt: 'test',
    timeoutMs: 5000,
    weight: id === 'factual' ? 0.55 : id === 'reasoning' ? 0.45 : 0,
    voter: id !== 'advocate',
  };
}

class StubWorker extends BaseWorker {
  constructor(
    config: WorkerConfig,
    private readonly outputsByRound: Record<number, string | 'fail'>,
  ) {
    super(config);
  }

  async call(
    _query: string,
    _context: string | undefined,
    options?: CallOptions,
  ): Promise<WorkerResult> {
    const round = options?.roundInput?.round ?? 0;
    const planned = this.outputsByRound[round] ?? this.outputsByRound[0];

    if (planned === 'fail') {
      return {
        workerId: this.config.id,
        role: this.config.role,
        voter: this.config.voter,
        model: this.config.model,
        output: '',
        latencyMs: 1,
        status: 'error',
        errorMessage: 'stub failure',
        round,
      };
    }

    return {
      workerId: this.config.id,
      role: this.config.role,
      voter: this.config.voter,
      model: this.config.model,
      output: planned,
      latencyMs: 1,
      status: 'success',
      round,
    };
  }
}

describe('runDeliberation', () => {
  it('early-exits when round 0 confidence clears threshold', async () => {
    const agreed =
      'Inflation rises when demand exceeds supply and the money supply grows across the economy.';
    const workers = [
      new StubWorker(workerConfig('factual'), { 0: agreed }),
      new StubWorker(workerConfig('reasoning'), { 0: agreed + ' Central banks may expand supply.' }),
    ];
    const transport = new InProcessTransport();
    const cfg = testConfig({ deliberationRounds: 2 });

    const result = await runDeliberation(
      workers,
      'What causes inflation?',
      undefined,
      'session-1',
      cfg,
      transport,
      { publish: (msg) => transport.publish({ ...msg, timestamp: Date.now() }) },
    );

    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.earlyExit).toBe(true);
    expect(result.rounds[0]?.phase).toBe('propose');
    expect(result.finalResults).toHaveLength(2);
  });

  it('runs full propose → critique → revise path when confidence stays low', async () => {
    const workers = [
      new StubWorker(workerConfig('factual'), {
        0: 'Answer A completely different topic alpha bravo.',
        1: 'Critique: reasoning worker ignores monetary policy.',
        2: 'Revised: inflation is driven by excess demand and monetary expansion.',
      }),
      new StubWorker(workerConfig('reasoning'), {
        0: 'Answer B unrelated beta gamma delta epsilon.',
        1: 'Critique: factual worker oversimplifies supply constraints.',
        2: 'Revised: inflation is driven by excess demand and monetary expansion.',
      }),
      new StubWorker(workerConfig('advocate'), {
        0: 'Both may ignore structural supply shocks.',
        1: 'Neither mentions energy price spikes.',
        2: 'Energy shocks remain a valid caveat.',
      }),
    ];
    const transport = new InProcessTransport();
    const cfg = testConfig({ deliberationRounds: 2, confidenceThreshold: 0.95 });

    const result = await runDeliberation(
      workers,
      'What causes inflation?',
      undefined,
      'session-2',
      cfg,
      transport,
      { publish: (msg) => transport.publish({ ...msg, timestamp: Date.now() }) },
    );

    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.map((r) => r.phase)).toEqual(['propose', 'critique', 'revise']);
    // advocate runs R0 only; voters run all 3 rounds → 3 + 2 + 2 = 7
    expect(result.allResults.length).toBe(7);
    expect(result.allResults.filter((r) => r.workerId === 'advocate').every((r) => r.round === 0)).toBe(
      true,
    );
  });

  it('continues with survivors when a worker fails mid-round', async () => {
    const agreed = 'Shared answer about inflation and monetary policy growth supply demand.';
    const workers = [
      new StubWorker(workerConfig('factual'), { 0: 'Divergent alpha', 1: 'fail', 2: agreed }),
      new StubWorker(workerConfig('reasoning'), { 0: 'Divergent beta', 1: 'critique text', 2: agreed }),
    ];
    const transport = new InProcessTransport();
    const cfg = testConfig({ deliberationRounds: 2, confidenceThreshold: 0.95 });

    const result = await runDeliberation(
      workers,
      'What causes inflation?',
      undefined,
      'session-3',
      cfg,
      transport,
      { publish: (msg) => transport.publish({ ...msg, timestamp: Date.now() }) },
    );

    const factualRound1 = result.allResults.find(
      (r) => r.workerId === 'factual' && r.round === 1,
    );
    expect(factualRound1?.status).toBe('error');
    expect(result.finalResults.some((r) => r.workerId === 'reasoning')).toBe(true);
    expect(result.rounds.length).toBeGreaterThanOrEqual(2);
  });

  it('deliberation rounds=0 runs a single propose round', async () => {
    const workers = [new StubWorker(workerConfig('factual'), { 0: 'Only one round.' })];
    const transport = new InProcessTransport();
    const cfg = testConfig({ deliberationRounds: 0 });

    const result = await runDeliberation(
      workers,
      'test',
      undefined,
      'session-4',
      cfg,
      transport,
      { publish: (msg) => transport.publish({ ...msg, timestamp: Date.now() }) },
    );

    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.phase).toBe('propose');
  });
});

describe('parseQuestionsFromOutputs', () => {
  it('deduplicates and normalizes question lines', () => {
    const qs = parseQuestionsFromOutputs([
      '1. What timeframe should we consider?\n2. Who is the audience?',
      'What timeframe should we consider?\nHow should success be measured?',
    ]);
    expect(qs).toContain('What timeframe should we consider?');
    expect(qs).toContain('Who is the audience?');
    expect(qs).toContain('How should success be measured?');
    expect(qs.filter((q) => q.includes('timeframe'))).toHaveLength(1);
  });
});

describe('runQuestionRound', () => {
  it('aggregates worker questions and feeds them into propose', async () => {
    const workers = [
      new StubWorker(workerConfig('factual'), {
        [-1]: 'What geographic region applies?',
        0: 'Inflation rises when demand exceeds supply across the economy.',
      }),
      new StubWorker(workerConfig('reasoning'), {
        [-1]: 'What time horizon matters for this analysis?',
        0: 'Inflation rises when demand exceeds supply and money supply grows.',
      }),
    ];
    const transport = new InProcessTransport();
    const cfg = testConfig({ deliberationRounds: 2, criticalThinking: true });
    const hooks = { publish: (msg: { timestamp?: number }) => transport.publish({ ...msg, timestamp: Date.now() }) };

    const question = await runQuestionRound(
      workers,
      'What causes inflation?',
      undefined,
      'session-q',
      cfg,
      transport,
      hooks,
    );

    expect(question.state.rounds[0]?.phase).toBe('question');
    expect(question.questions.length).toBeGreaterThanOrEqual(2);

    const proposal = await runProposalRound(
      workers,
      'What causes inflation?',
      undefined,
      'session-q',
      cfg,
      transport,
      hooks,
      question.questions,
      question.state,
    );

    expect(proposal.rounds.map((r) => r.phase)).toEqual(['question', 'propose']);
    expect(proposal.allResults.some((r) => r.round === -1)).toBe(true);
    expect(proposal.allResults.some((r) => r.round === 0)).toBe(true);
  });
});

describe('SimulatedNetworkTransport', () => {
  it('delays deliberation messages but not lifecycle events', async () => {
    vi.useFakeTimers();
    const transport = new SimulatedNetworkTransport({
      latencyMs: 100,
      jitterMs: 0,
      dropRate: 0,
    });

    const lifecycle: string[] = [];
    const deliberation: string[] = [];
    transport.subscribe((msg) => {
      if (msg.type === 'worker_started') lifecycle.push('started');
      if (msg.type === 'proposal') deliberation.push('proposal');
    });

    transport.publish({
      type: 'worker_started',
      sender: 'orchestrator',
      recipient: 'factual',
      round: 0,
      sessionId: 's',
      timestamp: Date.now(),
      payload: {},
    });
    expect(lifecycle).toEqual(['started']);

    transport.publish({
      type: 'proposal',
      sender: 'factual',
      recipient: 'broadcast',
      round: 0,
      sessionId: 's',
      timestamp: Date.now(),
      payload: { workerId: 'factual', role: 'factual', text: 'hello' },
    });
    expect(deliberation).toEqual([]);

    await vi.advanceTimersByTimeAsync(100);
    expect(deliberation).toEqual(['proposal']);
    vi.useRealTimers();
  });

  it('drops deliberation messages according to dropRate', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transport = new SimulatedNetworkTransport({
      latencyMs: 0,
      jitterMs: 0,
      dropRate: 0.5,
    });

    const received: string[] = [];
    transport.subscribe((msg) => {
      if (msg.type === 'proposal') received.push('proposal');
    });

    transport.publish({
      type: 'proposal',
      sender: 'factual',
      recipient: 'broadcast',
      round: 0,
      sessionId: 's',
      timestamp: Date.now(),
      payload: { workerId: 'factual', role: 'factual', text: 'hello' },
    });

    expect(received).toEqual([]);
    expect(transport.getStats().dropped).toBe(1);
    vi.mocked(Math.random).mockRestore();
  });
});
