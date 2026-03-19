// @dot-protocol/wrapper — session management

import { createKeypair, createBLSKeypair } from '@dot-protocol/core';
import type { WrapSession } from './types.js';

/**
 * Create a new wrap session with fresh Ed25519 + BLS keypairs.
 *
 * A session maintains chain continuity and predictor context
 * across multiple wrap() calls for better compression.
 *
 * @example
 * const session = await createSession();
 * const chain1 = await wrap(payload1, { session });
 * const chain2 = await wrap(payload2, { session }); // chains from chain1
 */
export async function createSession(): Promise<WrapSession> {
  const keypair = await createKeypair();
  const blsKeypair = createBLSKeypair();
  return {
    keypair,
    blsKeypair,
    dots: [],
    lastDot: undefined,
    baseTimestamp: BigInt(Date.now()),
  };
}

/**
 * Create a session from an existing Ed25519 keypair.
 * Use when you want wrap() to use a specific DOT identity.
 */
export async function createSessionFromKeypair(
  keypair: { publicKey: Uint8Array; privateKey: Uint8Array },
): Promise<WrapSession> {
  const blsKeypair = createBLSKeypair();
  return {
    keypair,
    blsKeypair,
    dots: [],
    lastDot: undefined,
    baseTimestamp: BigInt(Date.now()),
  };
}
