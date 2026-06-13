export type WorkerRole = 'factual' | 'reasoning' | 'advocate' | 'local';

export type WorkerProvider = 'cursor' | 'ollama';

export type DeliberationPhase = 'propose' | 'critique' | 'revise';

export interface WorkerConfig {
  id: string;
  role: WorkerRole;
  provider: WorkerProvider;
  model: string;
  systemPrompt: string;
  timeoutMs: number;
  /** Influence on final merge (0-1). Later becomes the per-node trust score. */
  weight: number;
  /** Voters participate in the similarity vote; non-voters (advocate) feed the judge. */
  voter: boolean;
}

export type WorkerStatus = 'success' | 'timeout' | 'error';

export interface WorkerResult {
  workerId: string;
  role: WorkerRole;
  voter: boolean;
  model: string;
  output: string;
  latencyMs: number;
  status: WorkerStatus;
  errorMessage?: string;
  round: number;
}

export interface PeerOutput {
  workerId: string;
  role: WorkerRole;
  text: string;
  messageType: 'proposal' | 'critique';
}

export interface RoundInput {
  round: number;
  phase: DeliberationPhase;
  peerOutputs: PeerOutput[];
}

export type SimilarityMethod = 'embeddings' | 'tfidf';

export type DeliberationTrigger = 'judge-gated' | 'vote';

export type TransportMode = 'inprocess' | 'simulated';

/** Outcome of the R0 judge screen when DELIBERATION_ROUNDS > 0. */
export type R0Gate = 'n/a' | 'early-exit' | 'uncertain' | 'judge-failed';

export interface RoundSummary {
  round: number;
  phase: DeliberationPhase;
  confidence: number;
  latencyMs: number;
  workerIds: string[];
  earlyExit?: boolean;
  /** Actual similarity backend used for this round (may differ from configured mode on fallback). */
  similarityMethod?: SimilarityMethod;
}

export interface OrchestratorRequest {
  query: string;
  context?: string;
  /** Optional: force a subset of workers by id. */
  workerIds?: string[];
  /** Optional: client-provided session id for SSE subscription before run. */
  sessionId?: string;
}

export type MergeStrategy =
  | 'majority-vote'
  | 'llm-judge'
  | 'single-worker'
  | 'fallback-flagged';

export interface PairSimilarity {
  a: string;
  b: string;
  score: number;
}

export interface JudgeVerdict {
  finalAnswer: string;
  /** 0-1 */
  confidence: number;
  conflicts: string[];
  reasoning?: string;
}

export interface OrchestratorResponse {
  sessionId: string;
  query: string;
  finalOutput: string;
  /** 0-1: vote similarity (majority-vote) or judge confidence (llm-judge). */
  confidence: number;
  workerResults: WorkerResult[];
  mergeStrategy: MergeStrategy;
  withinTolerance: boolean;
  similarityScores: PairSimilarity[];
  judgeVerdict: JudgeVerdict | null;
  totalLatencyMs: number;
  timestamp: string;
  /** Per-round confidence and timing when deliberation is enabled. */
  rounds: RoundSummary[];
  /** Configured similarity mode from SIMILARITY_MODE env. */
  similarityMode: SimilarityMethod;
  /** Actual backend used for final merge similarity (embeddings or tfidf fallback). */
  similarityMethod: SimilarityMethod;
  /** How deliberation follow-up was triggered: judge-gated (rounds>0) or vote (rounds=0). */
  deliberationTrigger: DeliberationTrigger;
  /** Transport used for this session. */
  transport: TransportMode;
  /** R0 judge screen outcome when judge-gated; n/a for single-shot. */
  r0Gate: R0Gate;
  /** Confidence threshold used for gating this session. */
  confidenceThreshold: number;
}

export interface DeliberationPayload {
  workerId: string;
  role: WorkerRole;
  text: string;
}
