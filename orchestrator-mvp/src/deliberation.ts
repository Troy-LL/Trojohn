import type { AppConfig } from './config.js';
import type {
  DeliberationPayload,
  DeliberationPhase,
  PeerOutput,
  RoundInput,
  RoundSummary,
  WorkerResult,
} from './types.js';
import type { Message, MessageType, Transport } from './transport/types.js';
import { pairwiseSimilarity } from './similarity.js';
import type { BaseWorker } from './workers/base.js';

const PHASE_BY_ROUND: DeliberationPhase[] = ['propose', 'critique', 'revise'];

const MESSAGE_TYPE_BY_ROUND: MessageType[] = ['proposal', 'critique', 'revision'];

function phaseForRound(round: number): DeliberationPhase {
  return PHASE_BY_ROUND[round] ?? 'revise';
}

function messageTypeForRound(round: number): MessageType {
  return MESSAGE_TYPE_BY_ROUND[round] ?? 'revision';
}

/** Advocate runs in R0 only — it feeds the judge but does not vote or recurse. */
function workersForRound(workers: BaseWorker[], round: number): BaseWorker[] {
  if (round === 0) return workers;
  return workers.filter((w) => w.config.role !== 'advocate');
}

function buildPeerOutputs(
  priorResults: Map<number, Map<string, DeliberationPayload>>,
  excludeWorkerId: string,
  upToRound: number,
): PeerOutput[] {
  const peers: PeerOutput[] = [];
  for (let r = 0; r < upToRound; r++) {
    const roundMap = priorResults.get(r);
    if (!roundMap) continue;
    const messageType = r === 0 ? 'proposal' : 'critique';
    for (const [workerId, payload] of roundMap) {
      if (workerId === excludeWorkerId) continue;
      peers.push({
        workerId,
        role: payload.role,
        text: payload.text,
        messageType,
      });
    }
  }
  return peers;
}

async function collectDeliberationMessages(
  transport: Transport,
  sessionId: string,
  round: number,
  msgType: MessageType,
  expectedIds: string[],
  timeoutMs: number,
): Promise<Map<string, DeliberationPayload>> {
  const received = new Map<string, DeliberationPayload>();
  if (expectedIds.length === 0) return received;

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsub();
      resolve(received);
    };

    const timer = setTimeout(finish, timeoutMs);

    const unsub = transport.subscribe((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.round !== round) return;
      if (msg.type !== msgType) return;
      const payload = msg.payload as DeliberationPayload;
      if (!expectedIds.includes(payload.workerId)) return;
      received.set(payload.workerId, payload);
      if (received.size >= expectedIds.length) finish();
    });
  });
}

export interface DeliberationHooks {
  onWorkerStart?: (workerId: string, round: number, phase: DeliberationPhase) => void;
  onWorkerToken?: (workerId: string, round: number, chunk: string) => void;
  onWorkerDone?: (result: WorkerResult) => void;
  onRoundComplete?: (summary: RoundSummary) => void;
  publish: (msg: Omit<Message, 'timestamp'>) => void;
}

export interface DeliberationState {
  priorResults: Map<number, Map<string, DeliberationPayload>>;
  allResults: WorkerResult[];
  latestByWorker: Map<string, WorkerResult>;
  rounds: RoundSummary[];
}

export interface DeliberationResult {
  finalResults: WorkerResult[];
  allResults: WorkerResult[];
  rounds: RoundSummary[];
}

export interface DeliberationRange {
  fromRound: number;
  toRound: number;
}

function emptyState(): DeliberationState {
  return {
    priorResults: new Map(),
    allResults: [],
    latestByWorker: new Map(),
    rounds: [],
  };
}

export async function runDeliberation(
  workers: BaseWorker[],
  query: string,
  context: string | undefined,
  sessionId: string,
  cfg: AppConfig,
  transport: Transport,
  hooks: DeliberationHooks,
  range?: DeliberationRange,
  initial?: Partial<DeliberationState>,
): Promise<DeliberationResult> {
  const fromRound = range?.fromRound ?? 0;
  const toRound = range?.toRound ?? cfg.deliberationRounds;

  const state: DeliberationState = {
    priorResults: initial?.priorResults ?? new Map(),
    allResults: initial?.allResults ?? [],
    latestByWorker: initial?.latestByWorker ?? new Map(),
    rounds: initial?.rounds ?? [],
  };

  for (let round = fromRound; round <= toRound; round++) {
    const phase = phaseForRound(round);
    const roundStart = Date.now();
    const msgType = messageTypeForRound(round);
    const activeWorkers = workersForRound(workers, round);

    const roundInputByWorker = new Map<string, RoundInput>();
    if (round > 0) {
      for (const worker of activeWorkers) {
        roundInputByWorker.set(worker.config.id, {
          round,
          phase,
          peerOutputs: buildPeerOutputs(state.priorResults, worker.config.id, round),
        });
      }
    }

    const results = await Promise.all(
      activeWorkers.map(async (worker) => {
        const { id } = worker.config;
        hooks.onWorkerStart?.(id, round, phase);

        const result = await worker.call(query, context, {
          hooks: {
            onToken: (chunk) => hooks.onWorkerToken?.(id, round, chunk),
          },
          roundInput: roundInputByWorker.get(id),
        });

        const stamped: WorkerResult = { ...result, round };
        state.allResults.push(stamped);
        state.latestByWorker.set(id, stamped);
        hooks.onWorkerDone?.(stamped);
        return stamped;
      }),
    );

    const publishable = results.filter((r) => r.status === 'success' && r.output.trim());
    const expectedIds = publishable.map((r) => r.workerId);

    const collectionPromise = collectDeliberationMessages(
      transport,
      sessionId,
      round,
      msgType,
      expectedIds,
      cfg.roundTimeoutMs,
    );

    for (const r of publishable) {
      hooks.publish({
        type: msgType,
        sender: r.workerId,
        recipient: 'broadcast',
        round,
        sessionId,
        payload: {
          workerId: r.workerId,
          role: r.role,
          text: r.output,
        } satisfies DeliberationPayload,
      });
    }

    const delivered = await collectionPromise;
    state.priorResults.set(round, delivered);

    const voters = results.filter((r) => r.status === 'success' && r.voter && r.output.trim());
    const votePreview =
      voters.length >= 2
        ? await pairwiseSimilarity(
            voters.map((r) => ({ id: r.workerId, output: r.output })),
            cfg,
          )
        : { average: voters.length === 1 ? 1 : 0, pairs: [], method: 'tfidf' as const };

    const summary: RoundSummary = {
      round,
      phase,
      confidence: votePreview.average,
      latencyMs: Date.now() - roundStart,
      workerIds: results.map((r) => r.workerId),
      similarityMethod: votePreview.method,
    };
    state.rounds.push(summary);
    hooks.onRoundComplete?.(summary);

    if (votePreview.average >= cfg.confidenceThreshold) {
      summary.earlyExit = true;
      break;
    }

    if (round === toRound) break;
  }

  return {
    finalResults: [...state.latestByWorker.values()],
    allResults: state.allResults,
    rounds: state.rounds,
  };
}

/** Run round 0 (propose) only. */
export async function runProposalRound(
  workers: BaseWorker[],
  query: string,
  context: string | undefined,
  sessionId: string,
  cfg: AppConfig,
  transport: Transport,
  hooks: DeliberationHooks,
): Promise<DeliberationResult> {
  return runDeliberation(workers, query, context, sessionId, cfg, transport, hooks, {
    fromRound: 0,
    toRound: 0,
  });
}

/** Run follow-up rounds (critique + revise) after R0, reusing transport state. */
export async function runFollowUpRounds(
  workers: BaseWorker[],
  query: string,
  context: string | undefined,
  sessionId: string,
  cfg: AppConfig,
  transport: Transport,
  hooks: DeliberationHooks,
  afterProposal: DeliberationResult,
): Promise<DeliberationResult> {
  if (cfg.deliberationRounds < 1) return afterProposal;

  return runDeliberation(
    workers,
    query,
    context,
    sessionId,
    cfg,
    transport,
    hooks,
    { fromRound: 1, toRound: cfg.deliberationRounds },
    {
      priorResults: buildPriorResultsFromOutputs(afterProposal),
      allResults: afterProposal.allResults,
      latestByWorker: new Map(afterProposal.finalResults.map((r) => [r.workerId, r])),
      rounds: afterProposal.rounds,
    },
  );
}

function buildPriorResultsFromOutputs(
  proposal: DeliberationResult,
): Map<number, Map<string, DeliberationPayload>> {
  const map = new Map<number, Map<string, DeliberationPayload>>();
  const round0 = new Map<string, DeliberationPayload>();
  for (const r of proposal.allResults.filter((x) => x.round === 0 && x.status === 'success')) {
    round0.set(r.workerId, { workerId: r.workerId, role: r.role, text: r.output });
  }
  map.set(0, round0);
  return map;
}

export { emptyState };
