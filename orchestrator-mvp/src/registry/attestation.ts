import { createHash } from 'node:crypto';
import { listWorkers, upsertWorker, type WorkerRecord } from '../store/sqlite.js';

export function computeCommitment(output: string, nodeId: string, round: number, timestamp: number): string {
  return createHash('sha256').update(`${output}|${nodeId}|${round}|${timestamp}`).digest('hex');
}

export function recordWorkerAttestation(params: {
  nodeId: string;
  model: string;
  output: string;
  round: number;
  auditScore?: number;
}): WorkerRecord {
  const lastSeen = new Date().toISOString();
  const commitment = computeCommitment(params.output, params.nodeId, params.round, Date.now());
  const record: WorkerRecord = {
    nodeId: params.nodeId,
    lastSeen,
    model: params.model,
    commitment,
    auditScore: params.auditScore ?? 1.0,
  };
  upsertWorker(record);
  return record;
}

export function penalizeWorker(nodeId: string, delta = 0.1): void {
  const existing = listWorkers().find((w) => w.nodeId === nodeId);
  if (!existing) return;
  upsertWorker({
    ...existing,
    auditScore: Math.max(0, existing.auditScore - delta),
    lastSeen: new Date().toISOString(),
  });
}
