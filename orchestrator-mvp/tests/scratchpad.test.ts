import { describe, expect, it } from 'vitest';
import { applyClaimOps, serializeScratchpad } from '../src/scratchpad/apply.js';
import { parseClaimOps, stripClaimsBlock } from '../src/scratchpad/parse.js';
import { synthesizeArtifact } from '../src/scratchpad/synthesize.js';
import { emptyScratchpad } from '../src/scratchpad/types.js';

describe('scratchpad', () => {
  it('applies add and support ops idempotently', () => {
    let pad = emptyScratchpad();
    pad = applyClaimOps(pad, [
      {
        opId: 'op1',
        type: 'add',
        author: 'factual',
        round: 0,
        claim: { id: 'c1', text: 'Inflation is monetary', confidence: 0.8 },
      },
    ]);
    pad = applyClaimOps(pad, [
      {
        opId: 'op1',
        type: 'add',
        author: 'factual',
        round: 0,
        claim: { id: 'c1', text: 'Inflation is monetary', confidence: 0.8 },
      },
      {
        opId: 'op2',
        type: 'support',
        author: 'reasoning',
        round: 0,
        claimId: 'c1',
      },
    ]);
    expect(pad.claims).toHaveLength(1);
    expect(pad.claims[0]?.status).toBe('supported');
  });

  it('parses claims block from worker output', () => {
    const output = `My answer here.

\`\`\`claims
{"ops":[{"opId":"a1","type":"add","claim":{"id":"c1","text":"Claim one","confidence":0.7}}]}
\`\`\``;
    const ops = parseClaimOps(output, 'factual', 0);
    expect(ops).toHaveLength(1);
    expect(stripClaimsBlock(output)).toBe('My answer here.');
  });

  it('synthesizes artifact with disputed claims', () => {
    let pad = emptyScratchpad();
    pad = applyClaimOps(pad, [
      {
        opId: '1',
        type: 'add',
        author: 'factual',
        round: 0,
        claim: { id: 'c1', text: 'Earth is round', confidence: 0.9 },
      },
      {
        opId: '2',
        type: 'add',
        author: 'reasoning',
        round: 0,
        claim: { id: 'c2', text: 'Earth is flat', confidence: 0.5 },
      },
      { opId: '3', type: 'dispute', author: 'factual', round: 1, claimId: 'c2' },
    ]);
    const artifact = synthesizeArtifact(pad, 1);
    expect(artifact.acceptedClaims.some((c) => c.id === 'c1')).toBe(true);
    expect(artifact.disputedClaims.some((c) => c.id === 'c2')).toBe(true);
    expect(serializeScratchpad(pad)).toContain('c1');
  });
});
