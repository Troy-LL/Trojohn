import { describe, expect, it } from 'vitest';
import { initDb, upsertSessionResult, queryAggregates } from '../src/store/sqlite.js';
import type { OrchestratorResponse } from '../src/types.js';

function mockResult(overrides: Partial<OrchestratorResponse> = {}): OrchestratorResponse {
  return {
    sessionId: 'test-session',
    query: 'test',
    finalOutput: 'answer',
    confidence: 0.8,
    workerResults: [],
    mergeStrategy: 'majority-vote',
    withinTolerance: true,
    similarityScores: [],
    judgeVerdict: null,
    totalLatencyMs: 1000,
    timestamp: new Date().toISOString(),
    rounds: [],
    similarityMode: 'tfidf',
    similarityMethod: 'tfidf',
    deliberationTrigger: 'vote',
    transport: 'inprocess',
    r0Gate: 'n/a',
    confidenceThreshold: 0.72,
    ...overrides,
  };
}

describe('session store', () => {
  it('upserts and aggregates sessions', () => {
    initDb('/tmp/orchestrator-test-index.json');
    upsertSessionResult(mockResult({ sessionId: 's1', r0Gate: 'uncertain', transport: 'inprocess' }));
    upsertSessionResult(mockResult({ sessionId: 's2', r0Gate: 'early-exit', transport: 'simulated' }));
    const agg = queryAggregates();
    expect(agg.totalSessions).toBeGreaterThanOrEqual(2);
    expect(agg.byR0Gate['uncertain']).toBeGreaterThanOrEqual(1);
  });
});
