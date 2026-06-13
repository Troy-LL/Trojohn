import type { Claim, ClaimOp, Scratchpad } from './types.js';

export function applyClaimOps(scratchpad: Scratchpad, ops: ClaimOp[]): Scratchpad {
  const next: Scratchpad = {
    claims: scratchpad.claims.map((c) => ({ ...c })),
    appliedOpIds: new Set(scratchpad.appliedOpIds),
  };

  for (const op of ops) {
    if (next.appliedOpIds.has(op.opId)) continue;
    next.appliedOpIds.add(op.opId);

    switch (op.type) {
      case 'add': {
        if (!op.claim?.id || !op.claim.text) break;
        if (next.claims.some((c) => c.id === op.claim!.id)) break;
        next.claims.push({
          id: op.claim.id,
          author: op.author,
          round: op.round,
          text: op.claim.text,
          evidence: op.claim.evidence,
          confidence: op.claim.confidence ?? 0.5,
          status: 'proposed',
          refs: op.claim.refs,
        });
        break;
      }
      case 'support': {
        const c = next.claims.find((x) => x.id === op.claimId);
        if (c && c.status !== 'withdrawn') c.status = 'supported';
        break;
      }
      case 'dispute': {
        const c = next.claims.find((x) => x.id === op.claimId);
        if (c && c.status !== 'withdrawn') c.status = 'disputed';
        break;
      }
      case 'revise': {
        const c = next.claims.find((x) => x.id === op.claimId);
        if (c && op.text) {
          c.text = op.text;
          if (op.evidence !== undefined) c.evidence = op.evidence;
          if (op.confidence !== undefined) c.confidence = op.confidence;
          c.status = 'revised';
          c.author = op.author;
          c.round = op.round;
        }
        break;
      }
      case 'withdraw': {
        const c = next.claims.find((x) => x.id === op.claimId);
        if (c) c.status = 'withdrawn';
        break;
      }
    }
  }

  return next;
}

export function serializeScratchpad(scratchpad: Scratchpad): string {
  const claims = scratchpad.claims
    .filter((c) => c.status !== 'withdrawn')
    .map((c) => `- [${c.id}] (${c.status}, ${Math.round(c.confidence * 100)}%) ${c.text}`)
    .join('\n');
  return claims || '(empty scratchpad)';
}
