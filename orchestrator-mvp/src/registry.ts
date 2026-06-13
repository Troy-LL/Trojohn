import type { AppConfig } from './config.js';
import type { WorkerConfig, WorkerRole } from './types.js';
import { CursorWorker } from './workers/cursorWorker.js';
import { OllamaWorker } from './workers/ollamaWorker.js';
import { RemoteWorker } from './workers/remoteWorker.js';
import type { BaseWorker } from './workers/base.js';
import type { Transport } from './transport/types.js';

const SCRATCHPAD_INSTRUCTION = `

SCRATCHPAD (parallel mode): After your answer, append a fenced JSON block:
\`\`\`claims
{"ops":[{"opId":"unique-id","type":"add","claim":{"id":"c1","text":"atomic claim","confidence":0.8}}]}
\`\`\`
Ops: add, support, dispute, revise, withdraw. Reference existing claim ids when supporting/disputing.`;

const NO_TOOLS =
  'Answer directly in plain text. Do not use any tools, do not read or write files, do not run commands, do not browse.';

const ROLE_PROMPTS: Record<WorkerRole, string> = {
  factual: `You are Worker FACTUAL in a distributed inference system. Your role is FACTUAL RETRIEVAL.

Rules:
- Answer only with verifiable facts. No speculation.
- If you are uncertain, say so explicitly with a confidence level (e.g. "70% confident").
- Do not ask clarifying questions. Give your best answer immediately.
- ${NO_TOOLS}
- Keep your response under 200 words.`,

  reasoning: `You are Worker REASONING in a distributed inference system. Your role is REASONING AND INFERENCE.

Rules:
- Do not just state facts. Explain the reasoning chain behind your answer, step by step.
- If the facts are ambiguous, reason through the most likely interpretation.
- Do not ask clarifying questions. Give your best answer immediately.
- ${NO_TOOLS}
- Keep your response under 200 words.`,

  advocate: `You are Worker ADVOCATE in a distributed inference system. Your role is DEVIL'S ADVOCATE.

Rules:
- Other isolated workers are answering this same query directly. Your job is to find what they might get wrong.
- Identify edge cases, exceptions, counterexamples, and common misconceptions about this query.
- If the likely answer is correct, still note the strongest counterargument or caveat.
- Do not ask clarifying questions.
- ${NO_TOOLS}
- Keep your response under 150 words.`,

  local: `You are Worker LOCAL in a distributed CLM (Composite Language Model) mesh. You run on-device as a small language model node.

Rules:
- Give a concise, practical answer using your local model capacity.
- If uncertain, say so explicitly.
- Do not ask clarifying questions.
- ${NO_TOOLS}
- Keep your response under 200 words.`,
};

/** Voters take part in the similarity vote; the advocate critiques and feeds the judge. */
const ROLE_TRAITS: Record<WorkerRole, { voter: boolean; weight: number; provider: 'cursor' | 'ollama' }> = {
  factual: { voter: true, weight: 0.55, provider: 'cursor' },
  reasoning: { voter: true, weight: 0.45, provider: 'cursor' },
  advocate: { voter: false, weight: 0, provider: 'cursor' },
  local: { voter: true, weight: 0.35, provider: 'ollama' },
};

export const ALL_WORKER_ROLES: WorkerRole[] = ['factual', 'reasoning', 'advocate', 'local'];

export function buildWorkerConfigs(cfg: AppConfig): WorkerConfig[] {
  const active = new Set(cfg.activeWorkers);
  const scratchSuffix = cfg.scratchpadMode === 'parallel' ? SCRATCHPAD_INSTRUCTION : '';
  const configs: WorkerConfig[] = ALL_WORKER_ROLES.filter((role) => active.has(role)).map((role) => ({
    id: role,
    role,
    provider: ROLE_TRAITS[role].provider,
    model: cfg.models[role],
    systemPrompt: ROLE_PROMPTS[role] + scratchSuffix,
    timeoutMs: cfg.defaultTimeoutMs,
    weight: ROLE_TRAITS[role].weight,
    voter: ROLE_TRAITS[role].voter,
  }));

  for (const entry of cfg.activeWorkers) {
    if (!entry.startsWith('phone:')) continue;
    const nodeId = entry.slice('phone:'.length);
    configs.push({
      id: nodeId,
      role: 'local',
      provider: 'ollama',
      model: cfg.models.local,
      systemPrompt: ROLE_PROMPTS.local + scratchSuffix,
      timeoutMs: cfg.defaultTimeoutMs,
      weight: 0.35,
      voter: true,
    });
  }

  return configs;
}

export function createWorker(config: WorkerConfig, cfg: AppConfig, transport?: Transport): BaseWorker {
  const isRemote = cfg.activeWorkers.some((a) => a.startsWith('phone:') && a.slice('phone:'.length) === config.id);
  if (cfg.transport === 'webrtc' && isRemote) {
    if (!transport) throw new Error('Remote worker requires mesh transport');
    return new RemoteWorker(config, transport);
  }
  if (config.provider === 'ollama') {
    return new OllamaWorker(config, cfg.ollamaUrl);
  }
  return new CursorWorker(config, cfg.apiKey, cfg.sandboxRoot);
}

export interface ModelHealth {
  name: string;
  model: string;
  ok: boolean;
}

/**
 * Validates configured model IDs against the account's model list.
 * Ollama workers are marked ok — health is checked at call time.
 */
export async function checkModelHealth(cfg: AppConfig): Promise<ModelHealth[]> {
  const { Cursor } = await import('@cursor/sdk');
  const list = (await Cursor.models.list({ apiKey: cfg.apiKey })) as Array<{
    id: string;
    aliases?: string[];
  }>;
  const known = new Set<string>();
  for (const m of list) {
    known.add(m.id);
    for (const alias of m.aliases ?? []) known.add(alias);
  }

  return modelHealthEntries(cfg, (model, checkCursor) =>
    checkCursor ? known.has(model) : true,
  );
}

/** Health rows from config when Cursor.models.list is unreachable at startup. */
export function modelHealthFromConfig(cfg: AppConfig): ModelHealth[] {
  return modelHealthEntries(cfg, () => true);
}

function modelHealthEntries(
  cfg: AppConfig,
  okFor: (model: string, checkCursor: boolean) => boolean,
): ModelHealth[] {
  const entries: Array<[string, string, boolean]> = [
    ['worker:factual', cfg.models.factual, true],
    ['worker:reasoning', cfg.models.reasoning, true],
    ['worker:advocate', cfg.models.advocate, true],
    ['worker:local', cfg.models.local, false],
    ['judge', cfg.models.judge, true],
  ];

  return entries
    .filter(([name]) => {
      if (name === 'judge') return true;
      const id = name.replace('worker:', '');
      return cfg.activeWorkers.includes(id);
    })
    .map(([name, model, checkCursor]) => ({
      name,
      model,
      ok: okFor(model, checkCursor),
    }));
}
