/**
 * The transport seam. In the MVP every message travels over an in-process bus.
 * Phase 2 swaps in a SimulatedNetworkTransport (latency/jitter/drop) and the
 * phone era swaps in WebRTC data channels. Workers and the orchestrator only
 * ever see this interface.
 */

export type MessageType =
  // MVP lifecycle events
  | 'query_started'
  | 'worker_started'
  | 'worker_token'
  | 'worker_done'
  | 'similarity_scores'
  | 'judge_started'
  | 'judge_retry'
  | 'judge_verdict'
  | 'final'
  | 'error'
  // Deliberation rounds (RecursiveMAS-style text recursion)
  | 'question'
  | 'proposal'
  | 'critique'
  | 'revision'
  | 'claim_op'
  | 'scratchpad_update'
  | 'worker_task'
  | 'worker_result';

export interface Message<T = unknown> {
  type: MessageType;
  /** workerId, 'orchestrator', or 'judge' */
  sender: string;
  /** workerId, 'orchestrator', or 'broadcast' */
  recipient: string;
  /** Always 0 in MVP; increments per deliberation round in phase 2. */
  round: number;
  sessionId: string;
  timestamp: number;
  payload: T;
}

export interface Transport {
  publish(msg: Message): void;
  /** Returns an unsubscribe function. */
  subscribe(handler: (msg: Message) => void): () => void;
}
