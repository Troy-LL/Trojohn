import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// .env must win over stale shell env (e.g. ACTIVE_WORKERS=factual from a prior smoke test).
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env'), override: true });

export type TransportMode = 'inprocess' | 'simulated';
export type SimilarityMode = 'embeddings' | 'tfidf';

export interface AppConfig {
  apiKey: string;
  confidenceThreshold: number;
  defaultTimeoutMs: number;
  roundTimeoutMs: number;
  deliberationRounds: number;
  activeWorkers: string[];
  port: number;
  transport: TransportMode;
  similarityMode: SimilarityMode;
  embeddingModel: string;
  simLatencyMs: number;
  simJitterMs: number;
  simDropRate: number;
  ollamaUrl: string;
  models: {
    factual: string;
    reasoning: string;
    advocate: string;
    local: string;
    judge: string;
  };
  sandboxRoot: string;
  logDir: string;
  /** When true, SSE + /api/health show on-device SLM names instead of real model IDs. */
  demoEdgeModels: boolean;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.CURSOR_API_KEY ?? '';
  if (!apiKey) {
    throw new Error('CURSOR_API_KEY is missing. Copy .env.example to .env and fill it in.');
  }

  const transport = (process.env.TRANSPORT ?? 'inprocess') as TransportMode;
  if (transport !== 'inprocess' && transport !== 'simulated') {
    throw new Error(`Invalid TRANSPORT="${transport}". Use inprocess or simulated.`);
  }

  return {
    apiKey,
    confidenceThreshold: num('CONFIDENCE_THRESHOLD', 0.72),
    defaultTimeoutMs: num('DEFAULT_TIMEOUT_MS', 90_000),
    roundTimeoutMs: num('ROUND_TIMEOUT_MS', 30_000),
    deliberationRounds: num('DELIBERATION_ROUNDS', 0),
    activeWorkers: (process.env.ACTIVE_WORKERS ?? 'factual,reasoning,advocate')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    port: num('PORT', 3000),
    transport,
    simLatencyMs: num('SIM_LATENCY_MS', 200),
    simJitterMs: num('SIM_JITTER_MS', 100),
    simDropRate: num('SIM_DROP_RATE', 0.05),
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    similarityMode: (process.env.SIMILARITY_MODE ?? 'embeddings') as SimilarityMode,
    embeddingModel: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text',
    models: {
      factual: process.env.WORKER_FACTUAL_MODEL || 'claude-sonnet-4-6',
      reasoning: process.env.WORKER_REASONING_MODEL || 'gpt-5.5',
      advocate: process.env.WORKER_ADVOCATE_MODEL || 'gemini-3.1-pro',
      local: process.env.WORKER_LOCAL_MODEL || 'llama3.2:3b',
      judge: process.env.JUDGE_MODEL || 'composer-2.5',
    },
    sandboxRoot: path.join(projectRoot, 'sandboxes'),
    logDir: path.join(projectRoot, 'logs'),
    demoEdgeModels: bool('DEMO_EDGE_MODELS', true),
  };
}
