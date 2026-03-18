/**
 * DOT Protocol — Batch Pack/Unpack (Ed25519 + BLS)
 *
 * Compresses N DOTs from the same identity into a single frame.
 * Redundant fields eliminated: pubkey (shared), chain hashes (recomputed), timestamps (delta-coded).
 *
 * Ed25519 frame layout (version 0x01):
 *   Header (44B): version(1) + count uint16 LE(2) + pubkey(32) + baseTs big-endian uint64(8) + baseType(1)
 *   Per entry:    sig(64) + tsDelta(1 or 1+4) + typeDelta(1) + payload(16) = 82B min
 *
 * BLS frame layout (version 0x02):
 *   Header (44B): version(1) + count uint16 LE(2) + pubkey(32) + baseTs big-endian uint64(8) + baseType(1)
 *   Per entry:    tsDelta(1 or 1+4) + typeDelta(1) + payload(16) = 18B min (NO individual sig)
 *   Footer:       aggregateSig(48B) — single BLS aggregate over all DOT signed portions
 *
 * BLS chain hash reconstruction rule:
 *   Each assembled BLS DOT's sig field = first 48B of aggregate sig, zero-padded to 64B.
 *   This ensures chain_hash_i = SHA-256(full_DOT_i_with_padded_sig) is deterministic and
 *   verifiable by any receiver that knows the aggregate signature.
 *
 * Savings vs raw 153B/DOT:
 *   Ed25519: ~67B saved per DOT, ~82B per DOT at 20 DOTs vs 3060B raw
 *   BLS: ~135B saved per DOT, ~18B per DOT at 20 DOTs (plus 44B header + 48B aggregate)
 *   BLS N=100: 44 + 100*18 + 48 = 1892B vs 15300B raw — 8.1× compression
 */

import { OFF, DOT_SIZE, PUBKEY_SIZE, SIG_SIZE, CHAIN_SIZE, TS_SIZE, PAYLOAD_SIZE } from './types.js';
import {
  BATCH_HEADER_SIZE,
  BATCH_VERSION_ED25519,
  BATCH_VERSION_BLS,
  BLS_ENTRY_SIZE,
  BLS_AGG_SIG_SIZE,
  TS_DELTA_ESCAPE,
} from './batch-types.js';
import { signBLS, aggregateSignatures, verifyAggregateSameSigner } from './bls.js';
import type { BLSKeypair } from './bls.js';
import { signedBytes } from './bytes.js';

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

// ---------------------------------------------------------------------------
// batchPackBLS
// ---------------------------------------------------------------------------

/**
 * Pack N DOTs (same pubkey, chain order) into a BLS-compressed batch frame.
 * Individual 64-byte Ed25519 sigs are replaced by a single 48-byte BLS aggregate.
 *
 * Frame layout: header(44B) + entries(18B each) + aggregateSig(48B)
 * For N=100: 44 + 1800 + 48 = 1892B vs 15300B raw (8.1× compression, 88% savings).
 *
 * BLS chain hash rule:
 *   Chain hashes are computed from DOTs assembled with a zeroed 64-byte sig field.
 *   This is deterministic at both pack and unpack time (no chicken-and-egg).
 *   chain_hash_0 = zeros (genesis), chain_hash_i = SHA-256(dot_{i-1} with zeroed sig).
 *
 * All DOTs must be exactly 153 bytes and share the same public key.
 * Throws on empty array, size mismatch, or pubkey mismatch.
 *
 * @param dots - Array of 153-byte DOT wire buffers (same pubkey, chain order)
 * @param blsKeypair - BLS12-381 keypair for signing (private 32B, public 96B)
 * @param prevChainHash - Optional: SHA-256 hash of the DOT preceding dot[0].
 *                        If omitted, dot[0]'s BLS chain field will be all zeros.
 */
export async function batchPackBLS(
  dots: Uint8Array[],
  blsKeypair: BLSKeypair,
  prevChainHash?: Uint8Array,
): Promise<Uint8Array> {
  if (dots.length === 0) {
    throw new Error('batchPackBLS: cannot pack empty array');
  }

  for (let i = 0; i < dots.length; i++) {
    if (dots[i].length !== DOT_SIZE) {
      throw new Error(`batchPackBLS: DOT[${i}] is ${dots[i].length}B, expected ${DOT_SIZE}B`);
    }
  }

  const pubkey = dots[0].slice(OFF.PUBKEY, OFF.PUBKEY + PUBKEY_SIZE);
  for (let i = 1; i < dots.length; i++) {
    for (let b = 0; b < PUBKEY_SIZE; b++) {
      if (dots[i][OFF.PUBKEY + b] !== pubkey[b]) {
        throw new Error(`batchPackBLS: pubkey mismatch at DOT[${i}]`);
      }
    }
  }

  // Extract base timestamp and base type from first DOT
  const firstView = new DataView(dots[0].slice(0).buffer as ArrayBuffer);
  const baseTs = firstView.getBigUint64(OFF.TS, false);
  const baseType = dots[0][OFF.TYPE];

  // Step 1: Assemble BLS-form DOTs with zeroed sig field and BLS-derived chain hashes.
  //   These are canonical BLS DOTs: pubkey(32) + zeros(64) + blsChain(32) + ts(8) + type(1) + payload(16)
  //   The zeroed sig allows deterministic chain hash computation at both pack and unpack.
  const zeroedSig = new Uint8Array(SIG_SIZE); // 64 zero bytes
  const blsDots: Uint8Array[] = [];
  let prevBlsDot: Uint8Array | null = null;

  for (let i = 0; i < dots.length; i++) {
    const src = dots[i];
    const srcView = new DataView(src.slice(0).buffer as ArrayBuffer);
    const ts = srcView.getBigUint64(OFF.TS, false);
    const type = src[OFF.TYPE];
    const payload = src.subarray(OFF.PAYLOAD, OFF.PAYLOAD + PAYLOAD_SIZE);

    let chainHash: Uint8Array;
    if (i === 0) {
      chainHash = prevChainHash
        ? prevChainHash.slice(0, CHAIN_SIZE)
        : new Uint8Array(CHAIN_SIZE); // all zeros for genesis
    } else {
      chainHash = await sha256(prevBlsDot!);
    }

    const blsDot = new Uint8Array(DOT_SIZE);
    blsDot.set(pubkey, OFF.PUBKEY);
    blsDot.set(zeroedSig, OFF.SIG);   // 64 zero bytes — canonical BLS sig field
    blsDot.set(chainHash, OFF.CHAIN);
    const blsDotView = new DataView(blsDot.buffer as ArrayBuffer);
    writeBigUint64BE(blsDotView, OFF.TS, ts);
    blsDot[OFF.TYPE] = type;
    blsDot.set(payload, OFF.PAYLOAD);

    blsDots.push(blsDot);
    prevBlsDot = blsDot;
  }

  // Step 2: Sign signedBytes of each BLS-form DOT (chain hashes are now BLS-derived)
  const allSignedBytes: Uint8Array[] = blsDots.map(dot => signedBytes(dot));
  const allSigs: Uint8Array[] = allSignedBytes.map(sb => signBLS(sb, blsKeypair.privateKey));

  // Step 3: Aggregate all individual BLS signatures → single 48-byte aggregate
  const aggregateSig = aggregateSignatures(allSigs);

  // Estimate max size: header + worst-case per entry (1 + 4 + 1 + 16 = 22 bytes each) + aggregate sig
  const maxSize = BATCH_HEADER_SIZE + dots.length * (BLS_ENTRY_SIZE + 4) + BLS_AGG_SIG_SIZE;
  const out = new Uint8Array(maxSize);
  let pos = 0;

  // --- Write header ---
  out[pos++] = BATCH_VERSION_BLS;
  // count as uint16 LE
  out[pos++] = dots.length & 0xFF;
  out[pos++] = (dots.length >> 8) & 0xFF;
  // pubkey (32 bytes — Ed25519 pubkey, shared across all DOTs)
  out.set(pubkey, pos);
  pos += PUBKEY_SIZE;
  // baseTs big-endian uint64
  const headerView = new DataView(out.buffer as ArrayBuffer);
  writeBigUint64BE(headerView, pos, baseTs);
  pos += TS_SIZE;
  // baseType
  out[pos++] = baseType;

  if (pos !== BATCH_HEADER_SIZE) throw new Error(`BLS header size mismatch: expected ${BATCH_HEADER_SIZE}, got ${pos}`);

  // --- Write per-DOT entries (NO individual sigs) ---
  let prevTs = baseTs;

  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i];
    const dotView = new DataView(dot.slice(0).buffer as ArrayBuffer);
    const ts = dotView.getBigUint64(OFF.TS, false);
    const type = dot[OFF.TYPE];

    // tsDelta — delta from previous ts (0 for first entry)
    const delta = Number(ts - prevTs);
    if (delta < 0) {
      throw new Error(`batchPackBLS: timestamp not monotonic at DOT[${i}]: delta=${delta}`);
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

  // --- Append aggregate signature (48 bytes) ---
  out.set(aggregateSig, pos);
  pos += BLS_AGG_SIG_SIZE;

  return out.slice(0, pos);
}

// ---------------------------------------------------------------------------
// batchUnpackBLS
// ---------------------------------------------------------------------------

/**
 * Unpack a BLS batch frame back into individual 153-byte DOT wire buffers.
 * Verifies the aggregate BLS signature over all reconstructed signed portions.
 *
 * BLS chain hash reconstruction rule:
 *   DOTs are assembled with a zeroed 64-byte sig field (same rule as batchPackBLS).
 *   chain_hash_i = SHA-256(dot_{i-1} assembled with zeroed sig).
 *   This is fully deterministic without knowing the aggregate sig in advance.
 *   The returned DOTs have the aggregate sig stored in the sig field (48B + 16B zeros)
 *   for wire-format completeness, but chain hashes are computed from the zeroed form.
 *
 * @param frame - The compressed BLS batch frame produced by batchPackBLS
 * @param blsPubkey - 96-byte BLS12-381 public key of the signer
 * @param prevChainHash - Optional: SHA-256 hash of the DOT preceding dot[0].
 *                        If omitted, dot[0]'s chain field will be all zeros (genesis-style).
 */
export async function batchUnpackBLS(
  frame: Uint8Array,
  blsPubkey: Uint8Array,
  prevChainHash?: Uint8Array,
): Promise<Uint8Array[]> {
  let pos = 0;
  const frameView = new DataView(frame.slice(0).buffer as ArrayBuffer);

  // --- Read header ---
  const version = frame[pos++];
  if (version !== BATCH_VERSION_BLS) {
    throw new Error(`batchUnpackBLS: unknown version 0x${version.toString(16)}, expected 0x02`);
  }

  const count = frame[pos++] | (frame[pos++] << 8); // uint16 LE

  // Validate minimum frame length: header + entries + aggregate sig
  const minExpected = BATCH_HEADER_SIZE + count * BLS_ENTRY_SIZE + BLS_AGG_SIG_SIZE;
  if (frame.length < minExpected) {
    throw new Error(`batchUnpackBLS: frame too short: expected at least ${minExpected}B for ${count} entries, got ${frame.length}B`);
  }

  const pubkey = frame.slice(pos, pos + PUBKEY_SIZE);
  pos += PUBKEY_SIZE;

  const baseTs = readBigUint64BE(frameView, pos);
  pos += TS_SIZE;

  const baseType = frame[pos++];

  // Read aggregate signature from footer (last 48 bytes of frame)
  const aggregateSig = frame.slice(frame.length - BLS_AGG_SIG_SIZE);

  // Zeroed sig field — used for chain hash computation (deterministic, no chicken-and-egg)
  const zeroedSig = new Uint8Array(SIG_SIZE); // 64 zero bytes

  // Final sig field for returned DOTs: first 48B of aggregate sig + 16 zero bytes
  const paddedSig = new Uint8Array(SIG_SIZE);
  paddedSig.set(aggregateSig.slice(0, BLS_AGG_SIG_SIZE), 0);

  // --- Reconstruct BLS-form DOTs (zeroed sig) for chain hash + signedBytes verification ---
  const allSignedBytesForVerify: Uint8Array[] = [];
  const blsDots: Uint8Array[] = []; // zeroed-sig form (for chain hash chain)
  let prevBlsDot: Uint8Array | null = null;
  let cumulativeDelta = 0n;

  // Parse all entries first
  const entries: Array<{ ts: bigint; type: number; payload: Uint8Array }> = [];

  for (let i = 0; i < count; i++) {
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

    entries.push({ ts: baseTs + cumulativeDelta, type, payload });
  }

  // Assemble BLS-form DOTs with zeroed sig and BLS chain hashes
  for (let i = 0; i < count; i++) {
    const { ts, type, payload } = entries[i];

    let chainHash: Uint8Array;
    if (i === 0) {
      chainHash = prevChainHash
        ? prevChainHash.slice(0, CHAIN_SIZE)
        : new Uint8Array(CHAIN_SIZE); // all zeros for genesis
    } else {
      // SHA-256 of the previous BLS-form DOT (zeroed sig — same rule as batchPackBLS)
      chainHash = await sha256(prevBlsDot!);
    }

    // BLS-form DOT: zeroed sig for chain hash computation
    const blsDot = new Uint8Array(DOT_SIZE);
    blsDot.set(pubkey, OFF.PUBKEY);
    blsDot.set(zeroedSig, OFF.SIG);    // 64 zero bytes
    blsDot.set(chainHash, OFF.CHAIN);
    const blsDotView = new DataView(blsDot.buffer as ArrayBuffer);
    writeBigUint64BE(blsDotView, OFF.TS, ts);
    blsDot[OFF.TYPE] = type;
    blsDot.set(payload, OFF.PAYLOAD);

    allSignedBytesForVerify.push(signedBytes(blsDot));
    blsDots.push(blsDot);
    prevBlsDot = blsDot;
  }

  // --- Verify aggregate BLS signature over all signedBytes ---
  const valid = verifyAggregateSameSigner(aggregateSig, allSignedBytesForVerify, blsPubkey);
  if (!valid) {
    throw new Error('batchUnpackBLS: BLS aggregate signature verification failed');
  }

  // --- Assemble final returned DOTs with paddedSig (aggregate sig + 16 zero bytes) ---
  // The returned DOTs have the aggregate sig in the sig field for wire-format completeness.
  const results: Uint8Array[] = blsDots.map(blsDot => {
    const out = new Uint8Array(blsDot);
    out.set(paddedSig, OFF.SIG);
    return out;
  });

  return results;
}
