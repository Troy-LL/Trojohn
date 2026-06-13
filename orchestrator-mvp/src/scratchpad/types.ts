export type ClaimStatus = 'proposed' | 'supported' | 'disputed' | 'revised' | 'withdrawn';

export interface Claim {
  id: string;
  author: string;
  round: number;
  text: string;
  evidence?: string;
  confidence: number;
  status: ClaimStatus;
  refs?: string[];
}

export type ClaimOpType = 'add' | 'support' | 'dispute' | 'revise' | 'withdraw';

export interface ClaimOp {
  opId: string;
  type: ClaimOpType;
  author: string;
  round: number;
  claim?: Omit<Claim, 'author' | 'round' | 'status'>;
  claimId?: string;
  text?: string;
  evidence?: string;
  confidence?: number;
}

export interface Scratchpad {
  claims: Claim[];
  appliedOpIds: Set<string>;
}

export interface ArtifactSnapshot {
  acceptedClaims: Claim[];
  disputedClaims: Claim[];
  summary: string;
  round: number;
}

export function emptyScratchpad(): Scratchpad {
  return { claims: [], appliedOpIds: new Set() };
}
