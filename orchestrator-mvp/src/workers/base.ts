import type { RoundInput, WorkerConfig, WorkerResult } from '../types.js';

export interface CallHooks {
  onStart?: () => void;
  onToken?: (chunk: string) => void;
}

export interface CallOptions {
  hooks?: CallHooks;
  roundInput?: RoundInput;
}

/**
 * A worker is an isolated async unit: it receives only (query, context, config)
 * and has no reference to other workers or shared state.
 */
export abstract class BaseWorker {
  constructor(public readonly config: WorkerConfig) {}

  abstract call(
    query: string,
    context: string | undefined,
    options?: CallOptions,
  ): Promise<WorkerResult>;
}
