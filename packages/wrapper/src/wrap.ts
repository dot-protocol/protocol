// @dotprotocol/wrapper — wrap()

import { createKeypair, createBLSKeypair, createDOT, toBytes, DotType } from '@dotprotocol/core';
import { serializeBatchV2 } from '@dotprotocol/compression';
import { createSession } from './session.js';
import type { WrappedChain, WrapOptions, WrapSession } from './types.js';
import { PROTOCOL_ID } from './types.js';

// Header prefix: [1B protocol_id][4B original_length uint32 BE] = 5 bytes
const HEADER_SIZE = 5;
const CHUNK_SIZE = 16; // DOT payload field is 16 bytes

/**
 * Wrap a binary payload as a signed, compressed DOT chain.
 *
 * Each 16-byte chunk of the prefixed payload becomes one DOT.
 * The DOTs are BLS-batch-signed and compressed via batch-v2.
 *
 * Stateless (no session): each call creates fresh keypairs, no chain linking.
 * Stateful (with session): DOTs chain from previous calls for better compression.
 *
 * @example
 * // Stateless (simple)
 * const chain = await wrap(new TextEncoder().encode('{"hello":"world"}'), { protocol: 'json' });
 *
 * // Stateful (better compression over time)
 * const session = await createSession();
 * const chain1 = await wrap(payload1, { session });
 * const chain2 = await wrap(payload2, { session });
 */
export async function wrap(payload: Uint8Array, options?: WrapOptions): Promise<WrappedChain> {
  const protocol = options?.protocol ?? 'raw';
  const dotType = options?.type ?? DotType.PUBLIC;
  const useTsDelta = options?.timestampDelta !== false;
  const useTypeRLE = options?.payloadTypeRLE !== false;

  // ── Build session (ephemeral if not provided) ──────────────────────────────
  const session: WrapSession = options?.session ?? await createSession();

  // ── Prefix payload with 5-byte header ─────────────────────────────────────
  // [1B protocol_id][4B original_length big-endian uint32]
  const protocolId = PROTOCOL_ID[protocol];
  const prefixed = new Uint8Array(HEADER_SIZE + payload.length);
  prefixed[0] = protocolId;
  const view = new DataView(prefixed.buffer);
  view.setUint32(1, payload.length, false); // big-endian
  prefixed.set(payload, HEADER_SIZE);

  // ── Chunk into 16-byte pieces ──────────────────────────────────────────────
  const chunkCount = Math.ceil(prefixed.length / CHUNK_SIZE) || 1;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = new Uint8Array(CHUNK_SIZE); // zero-padded
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, prefixed.length);
    chunk.set(prefixed.subarray(start, end));
    chunks.push(chunk);
  }

  // ── Create one DOT per chunk ───────────────────────────────────────────────
  const nowMs = Date.now();
  const newDots: Uint8Array[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const previous = i === 0 ? session.lastDot : newDots[i - 1];
    const dot = await createDOT({
      keypair: session.keypair,
      payload: chunks[i]!,
      type: dotType,
      previous,
      ts: nowMs + i, // ensure monotone within batch
    });
    newDots.push(toBytes(dot));
  }

  // ── BLS-batch-serialize (compress) ────────────────────────────────────────
  const frame = await serializeBatchV2(newDots, session.blsKeypair, {
    timestampDelta: useTsDelta,
    payloadTypeRLE: useTypeRLE,
  });

  // ── Update session state for next call ────────────────────────────────────
  if (options?.session) {
    session.dots.push(...newDots);
    session.lastDot = newDots[newDots.length - 1];
  }

  // ── Compute stats ─────────────────────────────────────────────────────────
  const originalBytes = payload.length;
  const compressedBytes = frame.length;
  const compressionRatio = originalBytes > 0
    ? originalBytes / compressedBytes
    : 1;

  // Extract aggSig from frame header [38..85]
  const batchSeal = frame.slice(38, 86);

  return {
    protocol,
    frame,
    dots: newDots,
    chunkCount,
    originalBytes,
    compressedBytes,
    compressionRatio,
    blsPublicKey: session.blsKeypair.publicKey,
    batchSeal,
  };
}
