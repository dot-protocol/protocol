/**
 * DOT Protocol — Batch Pack/Unpack (Ed25519)
 *
 * Compresses N DOTs from the same identity into a single frame.
 * Redundant fields eliminated: pubkey (shared), chain hashes (recomputed), timestamps (delta-coded).
 *
 * Frame layout:
 *   Header (43B): version(1) + count uint16 LE(2) + pubkey(32) + baseTs big-endian int64(8) + baseType(1)
 *   Per entry:    sig(64) + tsDelta(1 or 1+4) + typeDelta(1) + payload(16)
 *
 * Savings vs raw 153B/DOT:
 *   Eliminated per DOT: pubkey(32) + chain(32) + ts(8 → 1-5B delta) = ~67B saved
 *   Fixed overhead: 43B header
 *   Net: ~82B per DOT at 20 DOTs vs 3060B raw
 */

import { OFF, DOT_SIZE, PUBKEY_SIZE, SIG_SIZE, CHAIN_SIZE, TS_SIZE, PAYLOAD_SIZE } from './types.js';
import {
  BATCH_HEADER_SIZE,
  BATCH_VERSION_ED25519,
  TS_DELTA_ESCAPE,
} from './batch-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 of a Uint8Array. Always uses a fresh ArrayBuffer to satisfy Web Crypto. */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // .slice(0) copies the bytes to own ArrayBuffer — Web Crypto requires the buffer
  // to match the view's bounds exactly; sliced Uint8Arrays share a larger backing buffer.
  const buf = data.slice(0).buffer as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(hash);
}

/** Read big-endian uint64 from 8 bytes at offset in a DataView. */
function readBigUint64BE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, false);
}

/** Write big-endian uint64 into a DataView at offset. */
function writeBigUint64BE(view: DataView, offset: number, value: bigint): void {
  view.setBigUint64(offset, value, false);
}

// ---------------------------------------------------------------------------
// batchPack
// ---------------------------------------------------------------------------

/**
 * Pack N DOTs (same pubkey, chain order) into a compressed batch frame.
 * All DOTs must be exactly 153 bytes and share the same public key.
 * Throws on empty array or pubkey mismatch.
 */
export function batchPack(dots: Uint8Array[]): Uint8Array {
  if (dots.length === 0) {
    throw new Error('batchPack: cannot pack empty array');
  }

  for (let i = 0; i < dots.length; i++) {
    if (dots[i].length !== DOT_SIZE) {
      throw new Error(`batchPack: DOT[${i}] is ${dots[i].length}B, expected ${DOT_SIZE}B`);
    }
  }

  const pubkey = dots[0].slice(OFF.PUBKEY, OFF.PUBKEY + PUBKEY_SIZE);
  for (let i = 1; i < dots.length; i++) {
    for (let b = 0; b < PUBKEY_SIZE; b++) {
      if (dots[i][OFF.PUBKEY + b] !== pubkey[b]) {
        throw new Error(`batchPack: pubkey mismatch at DOT[${i}]`);
      }
    }
  }

  // Extract base timestamp and base type from first DOT
  const firstView = new DataView(dots[0].slice(0).buffer as ArrayBuffer);
  const baseTs = firstView.getBigUint64(OFF.TS, false);
  const baseType = dots[0][OFF.TYPE];

  // Estimate max size: header + worst-case per entry (64 + 1 + 4 + 1 + 16 = 86 bytes each)
  const maxSize = BATCH_HEADER_SIZE + dots.length * (SIG_SIZE + 1 + 4 + 1 + PAYLOAD_SIZE);
  const out = new Uint8Array(maxSize);
  let pos = 0;

  // --- Write header ---
  out[pos++] = BATCH_VERSION_ED25519;
  // count as uint16 LE
  out[pos++] = dots.length & 0xFF;
  out[pos++] = (dots.length >> 8) & 0xFF;
  // pubkey
  out.set(pubkey, pos);
  pos += PUBKEY_SIZE;
  // baseTs big-endian uint64
  const headerView = new DataView(out.buffer as ArrayBuffer);
  writeBigUint64BE(headerView, pos, baseTs);
  pos += TS_SIZE;
  // baseType
  out[pos++] = baseType;

  // Verify header was written exactly as expected
  if (pos !== BATCH_HEADER_SIZE) throw new Error(`Header size mismatch: expected ${BATCH_HEADER_SIZE}, got ${pos}`);

  // --- Write entries ---
  let prevTs = baseTs;

  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i];
    const dotView = new DataView(dot.slice(0).buffer as ArrayBuffer);
    const ts = dotView.getBigUint64(OFF.TS, false);
    const type = dot[OFF.TYPE];

    // sig (64 bytes)
    out.set(dot.subarray(OFF.SIG, OFF.SIG + SIG_SIZE), pos);
    pos += SIG_SIZE;

    // tsDelta — delta from previous ts (0 for first entry)
    const delta = Number(ts - prevTs);
    if (delta < 0) {
      throw new Error(`batchPack: timestamp not monotonic at DOT[${i}]: delta=${delta}`);
    }
    if (delta <= 253) {
      out[pos++] = delta;
    } else {
      // escape: 0xFF + uint32 LE
      out[pos++] = TS_DELTA_ESCAPE;
      out[pos++] = delta & 0xFF;
      out[pos++] = (delta >> 8) & 0xFF;
      out[pos++] = (delta >> 16) & 0xFF;
      out[pos++] = (delta >> 24) & 0xFF;
    }
    prevTs = ts;

    // typeDelta
    out[pos++] = type === baseType ? 0x00 : type;

    // payload (16 bytes)
    out.set(dot.subarray(OFF.PAYLOAD, OFF.PAYLOAD + PAYLOAD_SIZE), pos);
    pos += PAYLOAD_SIZE;
  }

  return out.slice(0, pos);
}

// ---------------------------------------------------------------------------
// batchUnpack
// ---------------------------------------------------------------------------

/**
 * Unpack a batch frame back into individual 153-byte DOT wire buffers.
 * Reconstructs chain hashes via SHA-256 of each preceding DOT.
 *
 * @param frame - The compressed batch frame produced by batchPack
 * @param prevChainHash - Optional: SHA-256 hash of the DOT preceding dot[0] in the worldline.
 *                        If omitted, dot[0]'s chain field will be all zeros (genesis-style).
 */
export async function batchUnpack(
  frame: Uint8Array,
  prevChainHash?: Uint8Array,
): Promise<Uint8Array[]> {
  let pos = 0;
  const frameView = new DataView(frame.slice(0).buffer as ArrayBuffer);

  // --- Read header ---
  const version = frame[pos++];
  if (version !== BATCH_VERSION_ED25519) {
    throw new Error(`batchUnpack: unknown version 0x${version.toString(16)}`);
  }

  const count = frame[pos++] | (frame[pos++] << 8); // uint16 LE

  // Validate minimum frame length before reading entries (Fix 6)
  const minExpected = BATCH_HEADER_SIZE + count * (64 + 1 + 1 + 16); // Ed25519 entry size
  if (frame.length < minExpected) throw new Error(`Frame too short: expected at least ${minExpected}B for ${count} entries, got ${frame.length}B`);

  const pubkey = frame.slice(pos, pos + PUBKEY_SIZE);
  pos += PUBKEY_SIZE;

  const baseTs = readBigUint64BE(frameView, pos);
  pos += TS_SIZE;

  const baseType = frame[pos++];

  // --- Read entries ---
  const results: Uint8Array[] = [];
  let prevDotBytes: Uint8Array | null = null;
  let cumulativeDelta = 0n;

  for (let i = 0; i < count; i++) {
    // sig
    const sig = frame.slice(pos, pos + SIG_SIZE);
    pos += SIG_SIZE;

    // tsDelta
    let delta: number;
    const tsFirst = frame[pos++];
    if (tsFirst === TS_DELTA_ESCAPE) {
      // 4-byte uint32 LE
      delta = frame[pos]
        | (frame[pos + 1] << 8)
        | (frame[pos + 2] << 16)
        | (frame[pos + 3] << 24);
      delta = delta >>> 0; // ensure unsigned
      pos += 4;
    } else {
      delta = tsFirst;
    }
    cumulativeDelta += BigInt(delta);

    // typeDelta
    const typeDelta = frame[pos++];
    const type = typeDelta === 0x00 ? baseType : typeDelta;

    // payload
    const payload = frame.slice(pos, pos + PAYLOAD_SIZE);
    pos += PAYLOAD_SIZE;

    // Absolute timestamp
    const ts = baseTs + cumulativeDelta;

    // Chain hash
    let chainHash: Uint8Array;
    if (i === 0) {
      chainHash = prevChainHash
        ? prevChainHash.slice(0, CHAIN_SIZE)
        : new Uint8Array(CHAIN_SIZE); // all zeros for genesis
    } else {
      // SHA-256 of the previous reconstructed DOT
      chainHash = await sha256(prevDotBytes!);
    }

    // Assemble 153-byte DOT
    const dot = new Uint8Array(DOT_SIZE);
    dot.set(pubkey, OFF.PUBKEY);
    dot.set(sig, OFF.SIG);
    dot.set(chainHash, OFF.CHAIN);

    const dotView = new DataView(dot.buffer as ArrayBuffer);
    writeBigUint64BE(dotView, OFF.TS, ts);

    dot[OFF.TYPE] = type;
    dot.set(payload, OFF.PAYLOAD);

    results.push(dot);
    prevDotBytes = dot;
  }

  return results;
}
