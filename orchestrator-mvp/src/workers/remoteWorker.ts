import type { WorkerConfig, WorkerResult } from '../types.js';
import type { RoundInput } from '../types.js';
import type { Transport, Message } from '../transport/types.js';
import { BaseWorker, type CallOptions } from './base.js';

const TASK_TIMEOUT_MS = 120_000;

/** Orchestrator-side proxy for a phone node connected via mesh transport. */
export class RemoteWorker extends BaseWorker {
  constructor(
    config: WorkerConfig,
    private readonly transport: Transport,
  ) {
    super(config);
  }

  async call(
    query: string,
    context: string | undefined,
    options?: CallOptions,
  ): Promise<WorkerResult> {
    const round = options?.roundInput?.round ?? 0;
    const sessionId = `remote-${this.config.id}-${Date.now()}`;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(this.errorResult(round, 'Remote worker timeout'));
      }, this.config.timeoutMs ?? TASK_TIMEOUT_MS);

      const unsub = this.transport.subscribe((msg: Message) => {
        if (msg.type !== 'worker_result') return;
        const p = msg.payload as WorkerResult & { taskSessionId?: string };
        if (p.workerId !== this.config.id) return;
        if (p.taskSessionId && p.taskSessionId !== sessionId) return;
        clearTimeout(timer);
        unsub();
        resolve({ ...p, round, workerId: this.config.id, role: this.config.role, voter: this.config.voter, model: this.config.model });
      });

      this.transport.publish({
        type: 'worker_task',
        sender: 'orchestrator',
        recipient: this.config.id,
        round,
        sessionId,
        timestamp: Date.now(),
        payload: {
          workerId: this.config.id,
          query,
          context,
          roundInput: options?.roundInput,
          taskSessionId: sessionId,
        },
      });
    });
  }

  private errorResult(round: number, message: string): WorkerResult {
    return {
      workerId: this.config.id,
      role: this.config.role,
      voter: this.config.voter,
      model: this.config.model,
      output: '',
      latencyMs: 0,
      status: 'error',
      errorMessage: message,
      round,
    };
  }
}

export type WorkerTaskPayload = {
  workerId: string;
  query: string;
  context?: string;
  roundInput?: RoundInput;
  taskSessionId: string;
};
