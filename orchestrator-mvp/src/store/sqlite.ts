import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { OrchestratorResponse } from '../types.js';
import type { Claim } from '../scratchpad/types.js';

export interface WorkerRecord {
  nodeId: string;
  lastSeen: string;
  model: string;
  commitment: string;
  auditScore: number;
}

interface StoreData {
  sessions: Array<{
    sessionId: string;
    query: string;
    timestamp: string;
    transport?: string;
    deliberationTrigger?: string;
    r0Gate?: string;
    confidence: number;
    withinTolerance: boolean;
    mergeStrategy: string;
    totalLatencyMs: number;
    similarityMethod?: string;
    confidenceThreshold: number;
    r0GateThreshold?: number | null;
    rounds: OrchestratorResponse['rounds'];
    similarityScores: OrchestratorResponse['similarityScores'];
  }>;
  workers: WorkerRecord[];
}

let storePath = '';
let data: StoreData = { sessions: [], workers: [] };

function persist(): void {
  if (!storePath) return;
  writeFileSync(storePath, JSON.stringify(data, null, 2));
}

export function initDb(dbPath: string): void {
  storePath = dbPath.endsWith('.json') ? dbPath : `${dbPath.replace(/\.db$/, '')}-index.json`;
  mkdirSync(path.dirname(storePath), { recursive: true });
  if (existsSync(storePath)) {
    try {
      data = JSON.parse(readFileSync(storePath, 'utf8')) as StoreData;
    } catch {
      data = { sessions: [], workers: [] };
    }
  } else {
    persist();
  }
}

export function upsertSessionResult(result: OrchestratorResponse): void {
  if (!storePath) return;
  data.sessions = data.sessions.filter((s) => s.sessionId !== result.sessionId);
  data.sessions.push({
    sessionId: result.sessionId,
    query: result.query,
    timestamp: result.timestamp,
    transport: result.transport,
    deliberationTrigger: result.deliberationTrigger,
    r0Gate: result.r0Gate,
    confidence: result.confidence,
    withinTolerance: result.withinTolerance,
    mergeStrategy: result.mergeStrategy,
    totalLatencyMs: result.totalLatencyMs,
    similarityMethod: result.similarityMethod,
    confidenceThreshold: result.confidenceThreshold,
    r0GateThreshold: result.r0GateThreshold ?? null,
    rounds: result.rounds,
    similarityScores: result.similarityScores,
  });
  persist();
}

export function upsertClaims(_sessionId: string, _claims: Claim[]): void {
  // claims persisted via artifact on session result when present
}

export function upsertWorker(record: WorkerRecord): void {
  if (!storePath) return;
  data.workers = data.workers.filter((w) => w.nodeId !== record.nodeId);
  data.workers.push(record);
  persist();
}

export function listWorkers(): WorkerRecord[] {
  return data.workers;
}

export function queryAggregates(): {
  totalSessions: number;
  avgConfidence: number;
  withinToleranceRate: number;
  byR0Gate: Record<string, number>;
  byTransport: Record<string, number>;
} {
  const sessions = data.sessions;
  if (sessions.length === 0) {
    return { totalSessions: 0, avgConfidence: 0, withinToleranceRate: 0, byR0Gate: {}, byTransport: {} };
  }

  const avgConfidence = sessions.reduce((a, s) => a + s.confidence, 0) / sessions.length;
  const withinToleranceRate = sessions.filter((s) => s.withinTolerance).length / sessions.length;

  const byR0Gate: Record<string, number> = {};
  const byTransport: Record<string, number> = {};
  for (const s of sessions) {
    const gate = s.r0Gate ?? 'unknown';
    byR0Gate[gate] = (byR0Gate[gate] ?? 0) + 1;
    const t = s.transport ?? 'unknown';
    byTransport[t] = (byTransport[t] ?? 0) + 1;
  }

  return {
    totalSessions: sessions.length,
    avgConfidence,
    withinToleranceRate,
    byR0Gate,
    byTransport,
  };
}

export function closeDb(): void {
  storePath = '';
  data = { sessions: [], workers: [] };
}
