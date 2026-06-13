import { describe, expect, it } from 'vitest';
import { merge } from '../src/merge.js';
import type { WorkerResult } from '../src/types.js';

const weights = new Map([
  ['factual', 0.55],
  ['reasoning', 0.45],
]);

function result(
  id: 'factual' | 'reasoning' | 'advocate',
  output: string,
  voter = id !== 'advocate',
): WorkerResult {
  return {
    workerId: id,
    role: id,
    voter,
    model: 'test-model',
    output,
    latencyMs: 100,
    status: 'success',
    round: 0,
  };
}

const base = {
  sessionId: 'test',
  query: 'test query',
  weights,
  confidenceThreshold: 0.72,
  totalLatencyMs: 500,
  similarityCfg: { similarityMode: 'tfidf' as const, ollamaUrl: '', embeddingModel: '' },
  similarityMode: 'tfidf' as const,
  deliberationTrigger: 'vote' as const,
  transport: 'inprocess' as const,
  r0Gate: 'n/a' as const,
};

describe('merge', () => {
  it('throws when all workers fail', async () => {
    await expect(
      merge({
        ...base,
        results: [{ ...result('factual', 'x'), status: 'error' }],
      }),
    ).rejects.toThrow(/All workers failed/);
  });

  it('single voter returns single-worker without tolerance', async () => {
    const r = await merge({
      ...base,
      results: [result('factual', 'Inflation is caused by too much money chasing goods.')],
    });
    expect(r.mergeStrategy).toBe('single-worker');
    expect(r.withinTolerance).toBe(false);
  });

  it('agreeing voters pass majority-vote', async () => {
    const text = 'Inflation rises when demand exceeds supply and money supply grows.';
    const r = await merge({
      ...base,
      results: [
        result('factual', text),
        result('reasoning', text + ' Central banks may expand the money supply.'),
      ],
    });
    expect(r.mergeStrategy).toBe('majority-vote');
    expect(r.withinTolerance).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.72);
  });

  it('diverging voters use judge when provided', async () => {
    const r = await merge({
      ...base,
      results: [
        result('factual', 'The earth is flat.'),
        result('reasoning', 'The earth is an oblate spheroid.'),
        result('advocate', 'Flat earth models ignore satellite imagery.'),
      ],
      judgeVerdict: {
        finalAnswer: 'The earth is approximately spherical.',
        confidence: 0.95,
        conflicts: ['shape disagreement'],
      },
    });
    expect(r.mergeStrategy).toBe('llm-judge');
    expect(r.withinTolerance).toBe(true);
    expect(r.finalOutput).toContain('spherical');
  });

  it('diverging voters flag without judge', async () => {
    const r = await merge({
      ...base,
      results: [
        result('factual', 'Answer A completely different topic alpha.'),
        result('reasoning', 'Answer B unrelated beta gamma delta.'),
      ],
    });
    expect(r.mergeStrategy).toBe('fallback-flagged');
    expect(r.withinTolerance).toBe(false);
  });

  it('post-deliberation uses judge confidence over low TF-IDF', async () => {
    const r = await merge({
      ...base,
      deliberationTrigger: 'judge-gated',
      r0Gate: 'uncertain',
      rounds: [
        { round: 0, phase: 'propose', confidence: 0.28, latencyMs: 100, workerIds: [] },
        { round: 1, phase: 'critique', confidence: 0.28, latencyMs: 100, workerIds: [] },
        { round: 2, phase: 'revise', confidence: 0.35, latencyMs: 100, workerIds: [] },
      ],
      results: [
        result('factual', 'Revised factual position on death penalty with wrongful conviction data.'),
        result('reasoning', 'Revised reasoning on death penalty morality and retribution ethics.'),
      ],
      judgeVerdict: {
        finalAnswer: 'The death penalty is generally not morally justified in practice.',
        confidence: 0.82,
        conflicts: [],
      },
    });
    expect(r.mergeStrategy).toBe('llm-judge');
    expect(r.confidence).toBe(0.82);
    expect(r.withinTolerance).toBe(true);
    expect(r.finalOutput).toContain('not morally justified');
  });

  it('early-exit uses judge over high TF-IDF vote', async () => {
    const text =
      'Inflation rises when demand exceeds supply and the money supply grows faster than output.';
    const r = await merge({
      ...base,
      deliberationTrigger: 'judge-gated',
      r0Gate: 'early-exit',
      rounds: [
        {
          round: 0,
          phase: 'propose',
          confidence: 0.9,
          latencyMs: 100,
          workerIds: [],
          earlyExit: true,
        },
      ],
      results: [result('factual', text), result('reasoning', text)],
      judgeVerdict: {
        finalAnswer: 'Judge-synthesized inflation summary.',
        confidence: 0.91,
        conflicts: [],
      },
    });
    expect(r.mergeStrategy).toBe('llm-judge');
    expect(r.confidence).toBe(0.91);
    expect(r.finalOutput).toBe('Judge-synthesized inflation summary.');
  });

  it('post-deliberation without judge falls back to best reviser', async () => {
    const r = await merge({
      ...base,
      deliberationTrigger: 'judge-gated',
      r0Gate: 'uncertain',
      rounds: [
        { round: 0, phase: 'propose', confidence: 0.26, latencyMs: 100, workerIds: [] },
        { round: 1, phase: 'critique', confidence: 0.23, latencyMs: 100, workerIds: [] },
        { round: 2, phase: 'revise', confidence: 0.21, latencyMs: 100, workerIds: [] },
      ],
      results: [
        result('factual', 'Social media ban evidence and correlation studies for teens.'),
        result('reasoning', 'Social media ban reasoning on harm versus effectiveness.'),
      ],
    });
    expect(r.mergeStrategy).toBe('fallback-flagged');
    expect(r.withinTolerance).toBe(false);
    expect(r.confidence).toBe(0.21);
  });
});
