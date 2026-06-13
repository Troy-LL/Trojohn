import type { AppConfig } from './config.js';
import { embeddingSimilarity, embedTexts } from './embeddings.js';
import type { PairSimilarity } from './types.js';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function cosineMaps(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, v] of a) {
    normA += v * v;
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  for (const v of b.values()) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** TF-IDF cosine similarity between two text outputs (0-1). */
export function textSimilarityTfidf(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const tfA = termFreq(ta);
  const tfB = termFreq(tb);
  const all = new Set([...tfA.keys(), ...tfB.keys()]);
  const idf = new Map<string, number>();
  for (const term of all) {
    const docs = (tfA.has(term) ? 1 : 0) + (tfB.has(term) ? 1 : 0);
    idf.set(term, Math.log(2 / docs) + 1);
  }
  const vecA = new Map<string, number>();
  const vecB = new Map<string, number>();
  for (const term of all) {
    const w = idf.get(term)!;
    if (tfA.has(term)) vecA.set(term, (tfA.get(term)! / ta.length) * w);
    if (tfB.has(term)) vecB.set(term, (tfB.get(term)! / tb.length) * w);
  }
  return cosineMaps(vecA, vecB);
}

/** @deprecated alias — use textSimilarityTfidf */
export function textSimilarity(a: string, b: string): number {
  return textSimilarityTfidf(a, b);
}

function pairwiseTfidf(
  items: Array<{ id: string; output: string }>,
): { pairs: PairSimilarity[]; average: number } {
  const pairs: PairSimilarity[] = [];
  if (items.length < 2) return { pairs, average: items.length === 1 ? 1 : 0 };
  let sum = 0;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const score = textSimilarityTfidf(items[i]!.output, items[j]!.output);
      pairs.push({ a: items[i]!.id, b: items[j]!.id, score });
      sum += score;
      count++;
    }
  }
  return { pairs, average: count > 0 ? sum / count : 0 };
}

async function pairwiseEmbeddings(
  items: Array<{ id: string; output: string }>,
  cfg: Pick<AppConfig, 'ollamaUrl' | 'embeddingModel'>,
): Promise<{ pairs: PairSimilarity[]; average: number }> {
  const pairs: PairSimilarity[] = [];
  if (items.length < 2) return { pairs, average: items.length === 1 ? 1 : 0 };

  const texts = items.map((i) => i.output);
  const vectors = await embedTexts(texts, cfg);

  let sum = 0;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const va = vectors[i] ?? [];
      const vb = vectors[j] ?? [];
      let score = 0;
      if (va.length && vb.length) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let k = 0; k < va.length; k++) {
          dot += va[k]! * vb[k]!;
          normA += va[k]! * va[k]!;
          normB += vb[k]! * vb[k]!;
        }
        score = normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
        score = Math.max(0, Math.min(1, score));
      }
      pairs.push({ a: items[i]!.id, b: items[j]!.id, score });
      sum += score;
      count++;
    }
  }
  return { pairs, average: count > 0 ? sum / count : 0 };
}

export type SimilarityCfg = Pick<AppConfig, 'similarityMode' | 'ollamaUrl' | 'embeddingModel'>;

/**
 * Pairwise voter similarity. Uses Ollama embeddings when configured,
 * falls back to TF-IDF if Ollama is unreachable.
 */
export async function pairwiseSimilarity(
  items: Array<{ id: string; output: string }>,
  cfg?: SimilarityCfg,
): Promise<{ pairs: PairSimilarity[]; average: number; method: 'embeddings' | 'tfidf' }> {
  if (cfg?.similarityMode === 'embeddings') {
    try {
      const result = await pairwiseEmbeddings(items, cfg);
      return { ...result, method: 'embeddings' };
    } catch {
      // Ollama unavailable — degrade to TF-IDF
    }
  }
  return { ...pairwiseTfidf(items), method: 'tfidf' };
}
