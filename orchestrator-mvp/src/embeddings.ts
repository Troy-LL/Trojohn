import type { AppConfig } from './config.js';

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

/** Session-scoped cache keyed by model + text hash. */
const cache = new Map<string, number[]>();

function cacheKey(model: string, text: string): string {
  return `${model}:${text.slice(0, 512)}:${text.length}`;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function fetchEmbeddings(
  texts: string[],
  cfg: Pick<AppConfig, 'ollamaUrl' | 'embeddingModel'>,
): Promise<number[][]> {
  const res = await fetch(`${cfg.ollamaUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.embeddingModel,
      input: texts,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`ollama embed ${res.status}: ${body}`);
  }

  const data = (await res.json()) as OllamaEmbedResponse;
  if (Array.isArray(data.embeddings)) return data.embeddings;
  if (Array.isArray(data.embedding)) return [data.embedding];
  throw new Error('ollama embed returned no vectors');
}

export async function embedTexts(
  texts: string[],
  cfg: Pick<AppConfig, 'ollamaUrl' | 'embeddingModel'>,
): Promise<number[][]> {
  const vectors: number[][] = new Array(texts.length);
  const missing: { index: number; text: string }[] = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i] ?? '';
    if (!text.trim()) {
      vectors[i] = [];
      continue;
    }
    const key = cacheKey(cfg.embeddingModel, text);
    const hit = cache.get(key);
    if (hit) {
      vectors[i] = hit;
    } else {
      missing.push({ index: i, text });
    }
  }

  if (missing.length > 0) {
    const fetched = await fetchEmbeddings(
      missing.map((m) => m.text),
      cfg,
    );
    for (let j = 0; j < missing.length; j++) {
      const { index, text } = missing[j]!;
      const vec = fetched[j] ?? [];
      vectors[index] = vec;
      if (vec.length) cache.set(cacheKey(cfg.embeddingModel, text), vec);
    }
  }

  return vectors;
}

export async function embeddingSimilarity(
  a: string,
  b: string,
  cfg: Pick<AppConfig, 'ollamaUrl' | 'embeddingModel'>,
): Promise<number> {
  const [va, vb] = await embedTexts([a, b], cfg);
  if (!va?.length || !vb?.length) return 0;
  return Math.max(0, Math.min(1, cosine(va, vb)));
}

/** Clear embedding cache between test runs. */
export function clearEmbeddingCache(): void {
  cache.clear();
}
