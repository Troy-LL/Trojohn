import type { ArtifactSnapshot, Claim, Scratchpad } from './types.js';

export function synthesizeArtifact(scratchpad: Scratchpad, round: number): ArtifactSnapshot {
  const active = scratchpad.claims.filter((c) => c.status !== 'withdrawn');
  const acceptedClaims = active.filter(
    (c) => c.status === 'supported' || c.status === 'revised' || (c.status === 'proposed' && !hasDispute(active, c.id)),
  );
  const disputedClaims = active.filter((c) => c.status === 'disputed');

  return {
    acceptedClaims,
    disputedClaims,
    summary: buildSummary(acceptedClaims, disputedClaims),
    round,
  };
}

function hasDispute(claims: Claim[], claimId: string): boolean {
  return claims.some((c) => c.status === 'disputed' && c.refs?.includes(claimId));
}

function buildSummary(accepted: Claim[], disputed: Claim[]): string {
  const lines: string[] = [];
  for (const c of accepted) {
    lines.push(`• ${c.text}${c.evidence ? ` (${c.evidence})` : ''}`);
  }
  if (disputed.length > 0) {
    lines.push('\nUnresolved disputes:');
    for (const c of disputed) {
      lines.push(`• [disputed] ${c.text}`);
    }
  }
  return lines.join('\n') || 'No accepted claims yet.';
}
