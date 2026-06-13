import type { BaseWorker } from './workers/base.js';
import type { OrchestratorRequest } from './types.js';

/** MVP router: all enabled workers, or an explicit subset from the request. */
export function selectWorkers(workers: BaseWorker[], request: OrchestratorRequest): BaseWorker[] {
  if (request.workerIds?.length) {
    const set = new Set(request.workerIds);
    return workers.filter((w) => set.has(w.config.id));
  }
  return workers;
}
