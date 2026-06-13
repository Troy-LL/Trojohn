import { randomUUID } from 'node:crypto';
import type { ClaimOp } from './types.js';

const CLAIMS_BLOCK = /```claims\s*([\s\S]*?)```/i;

export function stripClaimsBlock(output: string): string {
  return output.replace(CLAIMS_BLOCK, '').trim();
}

export function parseClaimOps(output: string, author: string, round: number): ClaimOp[] {
  const match = output.match(CLAIMS_BLOCK);
  if (!match?.[1]) return [];

  try {
    const raw = JSON.parse(match[1].trim()) as { ops?: ClaimOp[] };
    if (!Array.isArray(raw.ops)) return [];
    return raw.ops.map((op) => ({
      ...op,
      opId: op.opId || randomUUID(),
      author: op.author || author,
      round: op.round ?? round,
    }));
  } catch {
    return [];
  }
}
