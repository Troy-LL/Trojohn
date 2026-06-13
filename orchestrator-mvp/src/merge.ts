import type { AppConfig } from './config.js';
import type {
  DeliberationTrigger,
  JudgeVerdict,
  MergeStrategy,
  OrchestratorResponse,
  PairSimilarity,
  R0Gate,
  RoundSummary,
  SimilarityMethod,
  TransportMode,
  WorkerResult,
} from './types.js';
import { pairwiseSimilarity, type SimilarityCfg } from './similarity.js';

export interface MergeInput {
  sessionId: string;
  query: string;
  results: WorkerResult[];
  /** workerId → merge weight */
  weights: Map<string, number>;
  confidenceThreshold: number;
  totalLatencyMs: number;
  judgeVerdict?: JudgeVerdict | null;
  rounds?: RoundSummary[];
  similarityCfg?: SimilarityCfg;
  similarityMode: SimilarityMethod;
  deliberationTrigger: DeliberationTrigger;
  transport: TransportMode;
  r0Gate: R0Gate;
}

function pickBestByWeight(
  voters: WorkerResult[],
  weights: Map<string, number>,
): WorkerResult {
  return [...voters].sort((a, b) => (weights.get(b.workerId) ?? 0) - (weights.get(a.workerId) ?? 0))[0];
}

function buildResponse(
  input: MergeInput,
  finalOutput: string,
  confidence: number,
  mergeStrategy: MergeStrategy,
  withinTolerance: boolean,
  similarityScores: PairSimilarity[],
  judgeVerdict: JudgeVerdict | null,
  similarityMethod: SimilarityMethod,
): OrchestratorResponse {
  return {
    sessionId: input.sessionId,
    query: input.query,
    finalOutput,
    confidence,
    workerResults: input.results,
    mergeStrategy,
    withinTolerance,
    similarityScores,
    judgeVerdict,
    totalLatencyMs: input.totalLatencyMs,
    timestamp: new Date().toISOString(),
    rounds: input.rounds ?? [],
    similarityMode: input.similarityMode,
    similarityMethod,
    deliberationTrigger: input.deliberationTrigger,
    transport: input.transport,
    r0Gate: input.r0Gate,
    confidenceThreshold: input.confidenceThreshold,
  };
}

/**
 * Hybrid merge:
 * - factual + reasoning workers vote via embedding (or TF-IDF) similarity
 * - advocate is excluded from the vote but included in judge input
 * - quorum: need 2+ successful voters for withinTolerance via vote
 * - lone survivor → single-worker, withinTolerance: false
 * - low vote confidence → fallback-flagged; judge verdict used if provided
 */
export async function merge(input: MergeInput): Promise<OrchestratorResponse> {
  const successful = input.results.filter((r) => r.status === 'success' && r.output.trim());
  const voters = successful.filter((r) => r.voter);

  if (successful.length === 0) {
    throw new Error('All workers failed or timed out');
  }

  if (voters.length === 0) {
    const best = successful[0];
    const verdict = input.judgeVerdict;
    if (verdict) {
      return buildResponse(
        input,
        verdict.finalAnswer,
        verdict.confidence,
        'llm-judge',
        verdict.confidence >= input.confidenceThreshold,
        [],
        verdict,
        input.similarityMode,
      );
    }
    return buildResponse(input, best.output, 0, 'fallback-flagged', false, [], null, input.similarityMode);
  }

  if (voters.length === 1) {
    const v = voters[0];
    const verdict = input.judgeVerdict;
    if (verdict) {
      return buildResponse(
        input,
        verdict.finalAnswer,
        verdict.confidence,
        'llm-judge',
        verdict.confidence >= input.confidenceThreshold,
        [],
        verdict,
        input.similarityMode,
      );
    }
    return buildResponse(input, v.output, 0, 'single-worker', false, [], null, input.similarityMode);
  }

  const { pairs, average, method } = await pairwiseSimilarity(
    voters.map((r) => ({ id: r.workerId, output: r.output })),
    input.similarityCfg,
  );

  if (average >= input.confidenceThreshold) {
    const best = pickBestByWeight(voters, input.weights);
    return buildResponse(input, best.output, average, 'majority-vote', true, pairs, null, method);
  }

  const verdict = input.judgeVerdict;
  if (verdict) {
    return buildResponse(
      input,
      verdict.finalAnswer,
      verdict.confidence,
      'llm-judge',
      verdict.confidence >= input.confidenceThreshold,
      pairs,
      verdict,
      method,
    );
  }

  const best = pickBestByWeight(voters, input.weights);
  return buildResponse(input, best.output, average, 'fallback-flagged', false, pairs, null, method);
}
