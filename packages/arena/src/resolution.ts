/**
 * DOT Protocol v0.3.0 — Arena Resolution Engine
 *
 * Blind evaluation protocol:
 *   1. Predictor signs a prediction DOT (claim + domain + expiry)
 *   2. Oracle signs a resolution DOT (outcome + evidence pointer)
 *   3. Arena matches them and updates Elo
 *
 * The protocol is blind: the oracle does not see individual predictions
 * before posting its resolution. Only the outcome is verifiable.
 */

import { verifyDOT } from '@dotprotocol/core';
import { toBytes } from '@dotprotocol/core';
import type { PredictionDOT, ResolutionDOT, ArenaMatch, BlindEvalSession } from './types.js';

/**
 * Verify a resolution DOT is authentic (oracle signed it).
 */
export async function verifyResolution(resolution: ResolutionDOT): Promise<boolean> {
  return verifyDOT(resolution.dot);
}

/**
 * Verify a prediction DOT is authentic (predictor signed it).
 */
export async function verifyPrediction(prediction: PredictionDOT): Promise<boolean> {
  return verifyDOT(prediction.dot);
}

/**
 * Resolve a blind evaluation session.
 * Matches prediction DOTs with the resolution DOT.
 * Returns one ArenaMatch per prediction.
 */
export async function resolveSession(
  session: BlindEvalSession,
  resolution: ResolutionDOT
): Promise<{ session: BlindEvalSession; matches: ArenaMatch[] }> {
  // Verify oracle's resolution
  const resValid = await verifyResolution(resolution);
  if (!resValid) {
    throw new Error('Resolution DOT signature invalid — oracle key mismatch');
  }

  // Verify oracle key matches session's declared oracle
  const oracleKeyMatches = resolution.dot.pubkey.every(
    (b, i) => b === session.oracleKey[i]
  );
  if (!oracleKeyMatches) {
    throw new Error('Resolution DOT pubkey does not match session oracle key');
  }

  // Match predictions against resolution
  const matches: ArenaMatch[] = [];
  for (const prediction of session.predictions) {
    const predValid = await verifyPrediction(prediction);
    if (!predValid) continue; // Skip invalid predictions silently

    matches.push({
      prediction,
      resolution,
      correct: resolution.outcome,
      pointsAwarded: resolution.outcome ? 1 : 0,
    });
  }

  const resolved: BlindEvalSession = {
    ...session,
    resolution,
    resolvedAt: Date.now(),
  };

  return { session: resolved, matches };
}

/**
 * Hash a prediction DOT's wire bytes (for resolution reference).
 * Uses SubtleCrypto if available, falls back to a simple XOR fingerprint.
 */
export async function hashPredictionDOT(prediction: PredictionDOT): Promise<Uint8Array> {
  const wire = toBytes(prediction.dot);

  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', wire);
    return new Uint8Array(hash);
  }

  // Fallback: XOR fold to 32 bytes (deterministic, not cryptographic)
  const fold = new Uint8Array(32);
  for (let i = 0; i < wire.length; i++) {
    fold[i % 32] ^= wire[i];
  }
  return fold;
}
