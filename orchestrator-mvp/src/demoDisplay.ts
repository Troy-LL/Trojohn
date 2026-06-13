import type { WorkerRole } from './types.js';

/** On-device SLM names shown in the demo UI (actual workers may use cloud models). */
export const EDGE_DISPLAY_MODELS: Record<WorkerRole, string> = {
  factual: 'llama3.2:3b',
  reasoning: 'phi3:mini',
  advocate: 'gemma2:2b',
  local: 'qwen2.5:1.5b',
};

export function edgeDisplayModel(workerId: string): string | undefined {
  return EDGE_DISPLAY_MODELS[workerId as WorkerRole];
}

export function maskModelForDemo(workerId: string, actual: string): string {
  return edgeDisplayModel(workerId) ?? actual;
}
