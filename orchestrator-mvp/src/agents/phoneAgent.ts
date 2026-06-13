/**
 * Phone agent CLI — simulates a mesh phone node connected to the orchestrator hub.
 *
 * Usage:
 *   npm run phone-agent -- --node phone-1 --role local
 */
import { loadConfig } from '../config.js';
import { createWorker, buildWorkerConfigs } from '../registry.js';
import { initDb } from '../store/sqlite.js';
import { recordWorkerAttestation } from '../registry/attestation.js';
import { connectPhoneAgent } from '../transport/webrtc/signaling.js';
import type { Message } from '../transport/types.js';
import type { WorkerTaskPayload } from '../workers/remoteWorker.js';

function parseArgs(): { nodeId: string; role: string; signalUrl: string } {
  const nodeIdx = process.argv.indexOf('--node');
  const roleIdx = process.argv.indexOf('--role');
  const signalIdx = process.argv.indexOf('--signal');
  return {
    nodeId: nodeIdx >= 0 ? process.argv[nodeIdx + 1]! : 'phone-1',
    role: roleIdx >= 0 ? process.argv[roleIdx + 1]! : 'local',
    signalUrl: signalIdx >= 0 ? process.argv[signalIdx + 1]! : 'ws://localhost:3001',
  };
}

async function main(): Promise<void> {
  const { nodeId, role, signalUrl } = parseArgs();
  const cfg = loadConfig();
  initDb(cfg.dbPath);

  const conn = connectPhoneAgent(signalUrl, nodeId, (msg) => {
    void handleTask(msg, conn, cfg, nodeId, role);
  });

  await conn.ready;
  console.log(`Phone agent ${nodeId} (${role}) connected to ${signalUrl}`);
}

async function handleTask(
  msg: Message,
  conn: ReturnType<typeof connectPhoneAgent>,
  cfg: ReturnType<typeof loadConfig>,
  nodeId: string,
  role: string,
): Promise<void> {
  if (msg.type !== 'worker_task') return;
  const task = msg.payload as WorkerTaskPayload;
  if (task.workerId !== nodeId) return;

  const configs = buildWorkerConfigs({ ...cfg, activeWorkers: [role] });
  const workerConfig = configs.find((c) => c.role === role) ?? configs[0];
  if (!workerConfig) return;

  const worker = createWorker({ ...workerConfig, id: nodeId }, cfg);
  const start = Date.now();
  const result = await worker.call(task.query, task.context, { roundInput: task.roundInput });

  recordWorkerAttestation({
    nodeId,
    model: result.model,
    output: result.output,
    round: result.round,
  });

  conn.publish({
    type: 'worker_result',
    sender: nodeId,
    recipient: 'orchestrator',
    round: result.round,
    sessionId: msg.sessionId,
    timestamp: Date.now(),
    payload: { ...result, taskSessionId: task.taskSessionId },
  });

  console.log(`Task done in ${Date.now() - start}ms (${result.status})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
