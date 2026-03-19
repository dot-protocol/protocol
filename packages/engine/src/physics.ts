/**
 * DOT Engine — Physics
 *
 * createDotPhysics() returns an object where physics auto-apply on every
 * DOT creation: signing, chain linking, payload prediction, stats tracking.
 *
 * The developer never calls sign(), hash(), or chain() explicitly.
 * These happen like gravity — automatically, on every DOT.
 */

import { createDOT, toBytes, DotType } from '@dot-protocol/core';
import { LinearPredictor } from '@dot-protocol/compression';
import type { FullIdentity } from './identity.js';
import { createChain, appendToChain } from './chain.js';
import type { Chain } from './chain.js';

export interface Datom {
  /** Payload content. String auto-encoded to UTF-8, then truncated/hashed to 16B. */
  WHAT?: string | Uint8Array;
  /** Recipient public key (future: triggers encryption) */
  WHO?: Uint8Array;
  /** Timestamp override in Unix ms (default: Date.now()) */
  WHEN?: number;
  /** Visibility type (default: DotType.PUBLIC) */
  type?: DotType;
}

export interface PhysicsStats {
  totalDots: number;
  totalRawBytes: number;
  totalChains: number;
  /** 0.0 to 1.0 — fraction of payloads the predictor got exactly right */
  predictorAccuracy: number;
  /** > 1 means fewer bytes sent than raw (compression ratio, future) */
  compressionRatio: number;
}

export interface DotPhysics {
  identity: FullIdentity;

  /**
   * Create a DOT. Physics auto-apply:
   *   1. Encode WHAT → 16-byte payload (hash if > 16B)
   *   2. Link to previous DOT in chain (SHA-256 chain hash)
   *   3. Sign with device identity (Ed25519)
   *   4. Update predictor (LinearPredictor)
   *   5. Append to chain
   * Returns raw 153-byte DOT Uint8Array.
   */
  create(datom: Datom): Promise<Uint8Array>;

  /** Get the active chain for an identity pair (or own chain if no recipient). */
  getChain(recipientDid?: string): Chain;

  /** Current physics stats */
  stats(): PhysicsStats;
}

const enc = new TextEncoder();

/**
 * Encode a WHAT value into exactly 16 bytes.
 * ≤ 16 bytes → copy directly.
 * > 16 bytes → SHA-256 hash truncated to 16 bytes (content address).
 */
export async function encodePayload(what: string | Uint8Array | undefined): Promise<Uint8Array> {
  if (!what) return new Uint8Array(16);

  const raw = typeof what === 'string' ? enc.encode(what) : what;

  if (raw.length <= 16) {
    const payload = new Uint8Array(16);
    payload.set(raw);
    return payload;
  }

  // Hash to 16-byte content address
  const toArrayBuffer = (u8: Uint8Array): ArrayBuffer =>
    u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
      ? (u8.buffer as ArrayBuffer)
      : u8.slice(0).buffer as ArrayBuffer;

  const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', toArrayBuffer(raw));
  return new Uint8Array(hashBuf).slice(0, 16);
}

/**
 * Create a DotPhysics instance bound to a specific identity.
 */
export function createDotPhysics(identity: FullIdentity): DotPhysics {
  const chains = new Map<string, Chain>();
  const predictors = new Map<string, LinearPredictor>();

  let totalDots = 0;
  let predictorHits = 0;

  function getOrCreateChain(id: string): Chain {
    if (!chains.has(id)) {
      chains.set(id, createChain(id));
      predictors.set(id, new LinearPredictor());
    }
    return chains.get(id)!;
  }

  const physics: DotPhysics = {
    identity,

    async create(datom: Datom): Promise<Uint8Array> {
      const chainId = identity.did;
      const chain = getOrCreateChain(chainId);
      const predictor = predictors.get(chainId)!;

      // 1. Encode payload
      const payload = await encodePayload(datom.WHAT);

      // 2. Predictor accuracy tracking
      const predicted = predictor.predict();
      const allMatch = payload.every((b, i) => b === predicted[i]);
      if (allMatch) predictorHits++;

      // 3. Create DOT (signs internally via WebCrypto)
      const dot = await createDOT({
        keypair: { publicKey: identity.publicKey, privateKey: identity._privateKey },
        payload,
        type: datom.type ?? DotType.PUBLIC,
        ...(chain.lastDot ? { previous: chain.lastDot } : {}),
        ...(datom.WHEN !== undefined ? { ts: datom.WHEN } : {}),
      });

      const dotBytes = toBytes(dot);

      // 4. Update predictor with actual payload
      predictor.update(payload);

      // 5. Append to chain
      chains.set(chainId, appendToChain(chain, dotBytes));

      // 6. Update stats
      totalDots++;

      return dotBytes;
    },

    getChain(recipientDid?: string): Chain {
      const chainId = recipientDid ?? identity.did;
      if (!chains.has(chainId)) chains.set(chainId, createChain(chainId));
      return chains.get(chainId)!;
    },

    stats(): PhysicsStats {
      return {
        totalDots,
        totalRawBytes: totalDots * 153,
        totalChains: chains.size,
        predictorAccuracy: totalDots > 0 ? predictorHits / totalDots : 0,
        compressionRatio: 1, // Phase 2: wire actual compression
      };
    },
  };

  return physics;
}
