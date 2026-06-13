import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AppConfig } from '../src/config.js';
import * as deliberation from '../src/deliberation.js';
import * as judge from '../src/judge.js';
import { Orchestrator } from '../src/orchestrator.js';
import type { WorkerResult } from '../src/types.js';

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKey: 'test-key',
    confidenceThreshold: 0.72,
    r0GateThreshold: 0.85,
    defaultTimeoutMs: 5000,
    roundTimeoutMs: 500,
    deliberationRounds: 2,
    activeWorkers: ['factual', 'reasoning'],
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

function workerResult(id: 'factual' | 'reasoning', output: string, round = 0): WorkerResult {
  return {
    workerId: id,
    role: id,
    voter: true,
    model: 'test-model',
    output,
    latencyMs: 1,
    status: 'success',
    round,
  };
}

const agreed =
  'Inflation rises when demand exceeds supply and the money supply grows across the economy.';

function proposalState() {
  const results = [workerResult('factual', agreed), workerResult('reasoning', agreed)];
  return {
    allResults: results,
    finalResults: results,
    rounds: [
      {
        round: 0,
        phase: 'propose' as const,
        confidence: 0.9,
        latencyMs: 100,
        workerIds: ['factual', 'reasoning'],
      },
    ],
  };
}

describe('R0 gate threshold', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not early-exit when judge confidence is below r0GateThreshold', async () => {
    const proposal = proposalState();
    const followUp = {
      ...proposal,
      rounds: [
        ...proposal.rounds,
        { round: 1, phase: 'critique' as const, confidence: 0.5, latencyMs: 100, workerIds: ['factual', 'reasoning'] },
        { round: 2, phase: 'revise' as const, confidence: 0.5, latencyMs: 100, workerIds: ['factual', 'reasoning'] },
      ],
    };

    vi.spyOn(deliberation, 'runProposalRound').mockResolvedValue(proposal);
    const followUpSpy = vi.spyOn(deliberation, 'runFollowUpRounds').mockResolvedValue(followUp);
    vi.spyOn(judge, 'runJudge')
      .mockResolvedValueOnce({
        finalAnswer: 'R0 synthesis.',
        confidence: 0.8,
        conflicts: [],
      })
      .mockResolvedValueOnce({
        finalAnswer: 'Final synthesis.',
        confidence: 0.88,
        conflicts: [],
      });

    const cfg = testConfig({ r0GateThreshold: 0.85, confidenceThreshold: 0.72 });
    const result = await new Orchestrator(cfg).run({ query: 'What causes inflation?' });

    expect(result.r0Gate).toBe('uncertain');
    expect(followUpSpy).toHaveBeenCalledOnce();
    expect(result.rounds.find((r) => r.phase === 'propose')?.judgeConfidence).toBe(0.8);
    expect(result.rounds.find((r) => r.phase === 'propose')?.earlyExit).toBeUndefined();
    expect(result.withinTolerance).toBe(true);
  });

  it('early-exits when judge confidence meets r0GateThreshold', async () => {
    const proposal = proposalState();
    vi.spyOn(deliberation, 'runProposalRound').mockResolvedValue(proposal);
    const followUpSpy = vi.spyOn(deliberation, 'runFollowUpRounds');
    vi.spyOn(judge, 'runJudge').mockResolvedValueOnce({
      finalAnswer: 'Strong R0 synthesis.',
      confidence: 0.9,
      conflicts: [],
    });

    const cfg = testConfig({ r0GateThreshold: 0.85, confidenceThreshold: 0.72 });
    const result = await new Orchestrator(cfg).run({ query: 'What causes inflation?' });

    expect(result.r0Gate).toBe('early-exit');
    expect(followUpSpy).not.toHaveBeenCalled();
    expect(result.rounds.find((r) => r.phase === 'propose')?.judgeConfidence).toBe(0.9);
    expect(result.rounds.find((r) => r.phase === 'propose')?.earlyExit).toBe(true);
    expect(result.r0GateThreshold).toBe(0.85);
  });
});
