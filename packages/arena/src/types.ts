/**
 * DOT Protocol v0.3.0 — Arena Types
 *
 * The Arena is where predictions meet reality.
 * DOTs make claims. Reality signs resolutions. The chain remembers.
 */

import type { DOT } from '@dotprotocol/core';

/** A prediction DOT — a claim about a future state */
export interface PredictionDOT {
  dot: DOT;
  domain: string;           // e.g. "prediction", "engineering", "teaching"
  claim: string;            // human-readable claim (stored off-chain)
  expiresAt: number;        // unix ms — when this prediction resolves
}

/** A resolution DOT — reality's answer, signed by an oracle key */
export interface ResolutionDOT {
  dot: DOT;
  predictionRef: Uint8Array;  // SHA-256 of prediction DOT wire bytes
  outcome: boolean;           // true = prediction correct, false = wrong
  evidence?: string;          // optional human-readable evidence pointer
}

/** A completed match in the Arena */
export interface ArenaMatch {
  prediction: PredictionDOT;
  resolution: ResolutionDOT;
  correct: boolean;
  pointsAwarded: number;
}

/** Blind evaluation session — predictions submitted before resolution is known */
export interface BlindEvalSession {
  id: string;               // ULID
  domain: string;
  oracleKey: Uint8Array;    // Ed25519 pubkey of the oracle that will resolve
  closesAt: number;         // unix ms — no more predictions after this
  resolvedAt?: number;      // unix ms — when oracle posted resolution
  predictions: PredictionDOT[];
  resolution?: ResolutionDOT;
}

/** Leaderboard entry computed from chain DOTs */
export interface LeaderboardEntry {
  pubkey: string;           // hex Ed25519 public key
  domain: string;
  elo: number;
  rank: number;             // position in this domain's leaderboard (1 = best)
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;         // 0–1
}
