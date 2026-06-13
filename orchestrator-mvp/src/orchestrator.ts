import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import {
  runDeliberation,
  runFollowUpRounds,
  runProposalRound,
  runQuestionRound,
} from './deliberation.js';
import { runJudge } from './judge.js';
import { SessionLogger } from './log.js';
import { merge } from './merge.js';
import { buildWorkerConfigs, createWorker } from './registry.js';
import { selectWorkers } from './router.js';
import { pairwiseSimilarity } from './similarity.js';
import { createTransport } from './transport/factory.js';
import type { Transport } from './transport/types.js';
import type { Message } from './transport/types.js';
import type {
  DeliberationPhase,
  JudgeVerdict,
  OrchestratorRequest,
  OrchestratorResponse,
  R0Gate,
  WorkerResult,
} from './types.js';
import type { BaseWorker } from './workers/base.js';

export class Orchestrator {
  private workers: BaseWorker[];
  private weights: Map<string, number>;
  readonly transport: Transport;

  constructor(private readonly cfg: AppConfig) {
    const configs = buildWorkerConfigs(cfg);
    this.workers = configs.map((c) => createWorker(c, cfg));
    this.weights = new Map(configs.map((c) => [c.id, c.weight]));
    this.transport = createTransport(cfg);
  }

  getWorkerIds(): string[] {
    return this.workers.map((w) => w.config.id);
  }

  private publish(msg: Omit<Message, 'timestamp'>): void {
    this.transport.publish({ ...msg, timestamp: Date.now() });
  }

  private buildDeliberationHooks(sessionId: string) {
    return {
      publish: (msg: Omit<Message, 'timestamp'>) => this.publish(msg),
      onWorkerStart: (workerId: string, round: number, phase: DeliberationPhase) => {
        const worker = this.workers.find((w) => w.config.id === workerId);
        this.publish({
          type: 'worker_started',
          sender: 'orchestrator',
          recipient: workerId,
          round,
          sessionId,
          payload: {
            workerId,
            model: worker?.config.model ?? '',
            role: worker?.config.role ?? workerId,
            phase,
          },
        });
      },
      onWorkerToken: (workerId: string, round: number, chunk: string) => {
        this.publish({
          type: 'worker_token',
          sender: workerId,
          recipient: 'orchestrator',
          round,
          sessionId,
          payload: { workerId, chunk },
        });
      },
      onWorkerDone: (result: WorkerResult) => {
        this.publish({
          type: 'worker_done',
          sender: result.workerId,
          recipient: 'orchestrator',
          round: result.round,
          sessionId,
          payload: result,
        });
      },
      onRoundComplete: (summary: {
        round: number;
        phase: string;
        confidence: number;
        earlyExit?: boolean;
        similarityMethod?: 'embeddings' | 'tfidf';
      }) => {
        this.publish({
          type: 'similarity_scores',
          sender: 'orchestrator',
          recipient: 'broadcast',
          round: summary.round,
          sessionId,
          payload: {
            scores: [],
            confidence: summary.confidence,
            phase: summary.phase,
            earlyExit: summary.earlyExit ?? false,
            similarityMethod: summary.similarityMethod,
          },
        });
      },
    };
  }

  private async invokeJudge(
    sessionId: string,
    query: string,
    results: WorkerResult[],
    allResults: WorkerResult[],
    rounds: OrchestratorResponse['rounds'],
    round: number,
    label: 'r0-screen' | 'final',
    opts?: { retries?: number; retryDelayMs?: number },
  ): Promise<JudgeVerdict | null> {
    const maxAttempts = 1 + (opts?.retries ?? 0);
    const retryDelayMs = opts?.retryDelayMs ?? 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        this.publish({
          type: 'judge_retry',
          sender: 'orchestrator',
          recipient: 'judge',
          round,
          sessionId,
          payload: { attempt, phase: label, maxAttempts },
        });
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }

      this.publish({
        type: 'judge_started',
        sender: 'orchestrator',
        recipient: 'judge',
        round,
        sessionId,
        payload: { deliberationRounds: rounds.length, phase: label, attempt },
      });

      try {
        const verdict = await runJudge(
          this.cfg.apiKey,
          this.cfg.models.judge,
          this.cfg.sandboxRoot,
          query,
          results,
          allResults,
          rounds,
          this.cfg.defaultTimeoutMs,
          {
            onToken: (chunk) => {
              this.publish({
                type: 'worker_token',
                sender: 'judge',
                recipient: 'orchestrator',
                round,
                sessionId,
                payload: { workerId: 'judge', chunk },
              });
            },
          },
        );
        this.publish({
          type: 'judge_verdict',
          sender: 'judge',
          recipient: 'orchestrator',
          round,
          sessionId,
          payload: verdict,
        });
        return verdict;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) continue;
        this.publish({
          type: 'error',
          sender: 'judge',
          recipient: 'orchestrator',
          round,
          sessionId,
          payload: { message: msg, phase: label, attempts: maxAttempts },
        });
        return null;
      }
    }
    return null;
  }

  async run(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    const sessionId = request.sessionId ?? randomUUID();
    const start = Date.now();
    const logger = new SessionLogger(this.cfg.logDir, sessionId);
    const unsub = this.transport.subscribe((m) => logger.logEvent(m));

    this.publish({
      type: 'query_started',
      sender: 'orchestrator',
      recipient: 'broadcast',
      round: 0,
      sessionId,
      payload: {
        query: request.query,
        workers: this.getWorkerIds(),
        deliberationRounds: this.cfg.deliberationRounds,
        transport: this.cfg.transport,
        deliberationTrigger: this.cfg.deliberationRounds > 0 ? 'judge-gated' : 'vote',
        confidenceThreshold: this.cfg.confidenceThreshold,
        criticalThinking: this.cfg.criticalThinking && this.cfg.deliberationRounds > 0,
      },
    });

    const selected = selectWorkers(this.workers, request);
    const hooks = this.buildDeliberationHooks(sessionId);

    let allResults: WorkerResult[];
    let finalResults: WorkerResult[];
    let rounds: OrchestratorResponse['rounds'];
    let judgeVerdict: JudgeVerdict | null = null;
    let r0Gate: R0Gate = 'n/a';
    let criticalQuestions: string[] | undefined;

    if (this.cfg.deliberationRounds > 0) {
      let afterQuestion = undefined;

      if (this.cfg.criticalThinking) {
        const questionRound = await runQuestionRound(
          selected,
          request.query,
          request.context,
          sessionId,
          this.cfg,
          this.transport,
          hooks,
        );
        criticalQuestions = questionRound.questions.length ? questionRound.questions : undefined;
        afterQuestion = questionRound.state;

        if (criticalQuestions?.length) {
          this.publish({
            type: 'similarity_scores',
            sender: 'orchestrator',
            recipient: 'broadcast',
            round: -1,
            sessionId,
            payload: {
              scores: [],
              confidence: 0,
              phase: 'question',
              criticalQuestions,
            },
          });
        }
      }

      // Judge-gated deliberation: R0 → quick judge → follow-up only if judge is uncertain
      const proposal = await runProposalRound(
        selected,
        request.query,
        request.context,
        sessionId,
        this.cfg,
        this.transport,
        hooks,
        criticalQuestions,
        afterQuestion,
      );

      allResults = proposal.allResults;
      finalResults = proposal.finalResults;
      rounds = proposal.rounds;

      const r0Judge = await this.invokeJudge(
        sessionId,
        request.query,
        finalResults,
        allResults,
        rounds,
        0,
        'r0-screen',
        { retries: 1, retryDelayMs: 2000 },
      );

      if (r0Judge && r0Judge.confidence >= this.cfg.confidenceThreshold) {
        r0Gate = 'early-exit';
        judgeVerdict = r0Judge;
        const proposeRound = rounds.find((r) => r.phase === 'propose');
        if (proposeRound) proposeRound.earlyExit = true;
      } else {
        r0Gate = r0Judge ? 'uncertain' : 'judge-failed';
        const followUp = await runFollowUpRounds(
          selected,
          request.query,
          request.context,
          sessionId,
          this.cfg,
          this.transport,
          hooks,
          proposal,
        );
        allResults = followUp.allResults;
        finalResults = followUp.finalResults;
        rounds = followUp.rounds;

        judgeVerdict = await this.invokeJudge(
          sessionId,
          request.query,
          finalResults,
          allResults,
          rounds,
          rounds.at(-1)?.round ?? 2,
          'final',
          // After a full deliberation the verdict is expensive to lose — retry harder than R0.
          { retries: 2, retryDelayMs: 3000 },
        );
        // Final judge failed — fall back to R0 synthesis rather than raw worker TF-IDF.
        if (!judgeVerdict && r0Judge) judgeVerdict = r0Judge;
      }
    } else {
      // Single-shot: R0 only, voter gate decides if judge runs
      const single = await runDeliberation(
        selected,
        request.query,
        request.context,
        sessionId,
        this.cfg,
        this.transport,
        hooks,
        { fromRound: 0, toRound: 0 },
      );
      allResults = single.allResults;
      finalResults = single.finalResults;
      rounds = single.rounds;

      const voters = finalResults.filter((r) => r.status === 'success' && r.voter);
      const votePreview =
        voters.length >= 2
          ? await pairwiseSimilarity(
              voters.map((r) => ({ id: r.workerId, output: r.output })),
              this.cfg,
            )
          : { average: voters.length === 1 ? 1 : 0, pairs: [], method: 'tfidf' as const };

      const needsJudge =
        finalResults.some((r) => r.status === 'success') &&
        (voters.length <= 1 || votePreview.average < this.cfg.confidenceThreshold);

      if (needsJudge) {
        judgeVerdict = await this.invokeJudge(
          sessionId,
          request.query,
          finalResults,
          allResults,
          rounds,
          0,
          'final',
          { retries: 1, retryDelayMs: 2000 },
        );
      }
    }

    const finalRound = rounds.at(-1)?.round ?? 0;

    const response = await merge({
      sessionId,
      query: request.query,
      results: finalResults,
      weights: this.weights,
      confidenceThreshold: this.cfg.confidenceThreshold,
      totalLatencyMs: Date.now() - start,
      judgeVerdict,
      rounds,
      similarityCfg: this.cfg,
      similarityMode: this.cfg.similarityMode,
      deliberationTrigger: this.cfg.deliberationRounds > 0 ? 'judge-gated' : 'vote',
      transport: this.cfg.transport,
      r0Gate,
      criticalQuestions,
    });

    if (response.similarityScores.length) {
      this.publish({
        type: 'similarity_scores',
        sender: 'orchestrator',
        recipient: 'broadcast',
        round: finalRound,
        sessionId,
        payload: {
          scores: response.similarityScores,
          confidence: response.confidence,
          final: true,
        },
      });
    }

    this.publish({
      type: 'final',
      sender: 'orchestrator',
      recipient: 'broadcast',
      round: finalRound,
      sessionId,
      payload: response,
    });

    logger.logResult(response);
    unsub();
    return response;
  }
}
