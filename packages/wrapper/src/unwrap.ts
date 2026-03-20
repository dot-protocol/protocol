// @dotprotocol/wrapper — unwrap()

import { deserializeBatchV2 } from '@dotprotocol/compression';
import { verifyAggregateSameSigner } from '@dotprotocol/core';
import type { UnwrappedPayload, UnwrapOptions } from './types.js';
import { PROTOCOL_FROM_ID } from './types.js';

const CHUNK_SIZE = 16;
const HEADER_SIZE = 5; // [1B protocol_id][4B uint32 BE original_length]

// Frame header layout (batch-v2):
//   [0]      version
//   [1]      flags
//   [2..5]   dot_count (uint32 LE)
//   [6..37]  shared_pubkey (Ed25519, 32B)
//   [38..85] aggregated_bls_sig (BLS G1, 48B)
const FRAME_PUBKEY_OFFSET = 6;
const FRAME_AGGSIG_OFFSET = 38;
const BLS_AGG_SIG_SIZE = 48;

/**
 * Read the BLS public key from a batch-v2 frame.
 * Note: this is the Ed25519 *signer* pubkey stored in the frame header,
 * not the BLS verification key. Use this only for frame inspection.
 *
 * To get the BLS public key for verification, use chain.blsPublicKey from wrap().
 */
export function readFramePubkey(frame: Uint8Array): Uint8Array {
  return frame.slice(FRAME_PUBKEY_OFFSET, FRAME_PUBKEY_OFFSET + 32);
}

/**
 * Unwrap a DOT chain frame back to the original binary payload.
 *
 * Pass blsPublicKey (from WrappedChain.blsPublicKey) for verified round-trips.
 * If blsPublicKey is omitted, BLS check is skipped and result.verified = false.
 *
 * @example
 * // Verified round-trip
 * const chain = await wrap(data, { protocol: 'json' });
 * const result = await unwrap(chain.frame, { blsPublicKey: chain.blsPublicKey });
 * // result.verified === true
 * // result.data deepEquals data
 *
 * // Unverified (just decode)
 * const result = await unwrap(chain.frame);
 * // result.verified === false
 */
export async function unwrap(frame: Uint8Array, options?: UnwrapOptions): Promise<UnwrappedPayload> {
  // ── Deserialize frame → DOT bytes ─────────────────────────────────────────
  // deserializeBatchV2 always requires a BLS pubkey for internal verification.
  // We use the provided key, or fall back to a self-consistency check:
  //   reconstruct the blsPublicKey embedded in the frame... but the frame only
  //   stores the Ed25519 pubkey, not the BLS key.
  //
  // Solution: deserializeBatchV2 verifies the BLS aggSig internally.
  // If no blsPublicKey is provided, we CANNOT call it without a key.
  // We use a workaround: read aggSig from frame and reconstruct verification
  // using the provided key, OR skip verification entirely by calling
  // deserializeBatchV2 with the provided key (throws on bad sig).
  //
  // If no key provided: we still need to decode. We do a two-phase approach:
  //   1. If blsPublicKey provided → pass directly, verified=true if no throw
  //   2. If not provided → we cannot verify; use a placeholder approach

  let dots: Uint8Array[];
  let verified = false;

  if (options?.blsPublicKey) {
    // Full verification path — throws if BLS sig is invalid
    dots = await deserializeBatchV2(frame, options.blsPublicKey);
    verified = true;
  } else {
    // No external key — we need to call deserializeBatchV2 which requires a key.
    // We use a dummy self-referential approach: we can't skip it, so we must
    // accept that decoding without a key requires us to provide SOME key.
    // Strategy: since we don't have the BLS key, we call deserializeBatchV2
    // with a dummy key and catch the verification failure, then manually
    // extract the DOT data without BLS check.
    //
    // BETTER approach: Read the aggSig from the frame and perform a direct
    // decode by bypassing BLS verification using a manual column parse.
    // But that duplicates a lot of deserializeBatchV2 logic.
    //
    // PRACTICAL approach: The frame ALWAYS contains valid BLS sigs (created by wrap()).
    // We only get here when the caller doesn't have the key. We decode by
    // providing a dummy key, expecting BLS verification to fail, then catch
    // and re-decode. But deserializeBatchV2 throws on bad sig, so we need
    // a different strategy.
    //
    // FINAL decision: use verifyAggregateSameSigner separately for opt-in
    // verification. For the decode path (no key), we still need deserializeBatchV2
    // to work. Since we control the frame (it was created by wrap()), we can
    // store the BLS pubkey alongside. But unwrap() only receives the frame.
    //
    // Real solution: extract the pubkey from the DOTs after a partial decode.
    // The frame header has the Ed25519 pubkey — not useful for BLS.
    //
    // Practical tradeoff: require blsPublicKey for decoding OR implement a
    // lightweight column parser. For now: if no key, we parse the frame
    // headers manually to extract DOT data without BLS verification.
    dots = await decodeFrameWithoutBLSVerification(frame);
    verified = false;
  }

  // ── Reassemble payload from DOT payload fields ────────────────────────────
  // Each DOT's payload field is bytes [137..152] = 16 bytes
  const OFF_PAYLOAD = 137;
  const assembled = new Uint8Array(dots.length * CHUNK_SIZE);
  for (let i = 0; i < dots.length; i++) {
    assembled.set(dots[i]!.subarray(OFF_PAYLOAD, OFF_PAYLOAD + CHUNK_SIZE), i * CHUNK_SIZE);
  }

  // ── Parse header: [1B protocol_id][4B uint32 BE original_length] ──────────
  if (assembled.length < HEADER_SIZE) {
    throw new RangeError(`unwrap: assembled data too short (${assembled.length} bytes)`);
  }
  const protocolId = assembled[0]!;
  const headerView = new DataView(assembled.buffer, assembled.byteOffset + 1, 4);
  const originalLength = headerView.getUint32(0, false); // big-endian

  const protocol = PROTOCOL_FROM_ID[protocolId] ?? 'raw';

  // ── Slice to original length ──────────────────────────────────────────────
  const dataStart = HEADER_SIZE;
  const dataEnd = dataStart + originalLength;
  if (dataEnd > assembled.length) {
    throw new RangeError(
      `unwrap: original_length=${originalLength} exceeds assembled data (${assembled.length - HEADER_SIZE} bytes available)`,
    );
  }
  const data = assembled.slice(dataStart, dataEnd);

  return {
    protocol,
    data,
    verified,
    dotCount: dots.length,
    compressionRatio: (originalLength > 0) ? originalLength / frame.length : 1,
  };
}

// ─── Frame decode without BLS verification ────────────────────────────────────
// Manual column parser that reconstructs DOTs from the frame without
// verifying the BLS aggregate signature. Used when no blsPublicKey is provided.

import { createHash } from 'node:crypto';

const DOT_SIZE = 153;
const PUBKEY_SIZE = 32;
const SIG_SIZE = 64;
const CHAIN_SIZE = 32;
const PAYLOAD_SIZE_DOT = 16;
const BLS_AGG_SIG_SIZE_LOCAL = 48;
const HEADER_BYTES = 86; // 1(ver) + 1(flags) + 4(count) + 32(pubkey) + 48(aggSig)

const FLAG_TS_DELTA = 0b00000001;
const FLAG_TYPE_RLE = 0b00000010;

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function readBigUint64BE(buf: Uint8Array, offset: number): bigint {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
}

function writeBigUint64BE(buf: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  view.setBigUint64(0, value, false);
}

/**
 * Decode a batch-v2 frame without BLS signature verification.
 * Reconstructs the DOT bytes from the frame's column data.
 */
async function decodeFrameWithoutBLSVerification(frame: Uint8Array): Promise<Uint8Array[]> {
  if (frame.length < HEADER_BYTES) {
    throw new RangeError(`unwrap: frame too short (${frame.length} bytes)`);
  }

  // Parse fixed header
  // byte 0: version (skip check — we trust the frame)
  const flags = frame[1]!;
  const hasTsDelta = (flags & FLAG_TS_DELTA) !== 0;
  const hasTypeRLE = (flags & FLAG_TYPE_RLE) !== 0;
  const hasDictCompressed = (flags & 0x08) !== 0;
  const hasPrediction = (flags & 0x10) !== 0;

  const countView = new DataView(frame.buffer, frame.byteOffset + 2, 4);
  const dotCount = countView.getUint32(0, true); // LE

  if (dotCount === 0) throw new RangeError('unwrap: dot_count is 0');

  const pubkey = frame.slice(6, 38); // Ed25519 pubkey (32B)
  const aggSig = frame.slice(FRAME_AGGSIG_OFFSET, FRAME_AGGSIG_OFFSET + BLS_AGG_SIG_SIZE_LOCAL); // BLS aggSig (48B)

  if (hasDictCompressed) {
    throw new Error('unwrap: dictionary-compressed frames require blsPublicKey for decoding');
  }
  if (hasPrediction) {
    throw new Error('unwrap: prediction-coded frames require blsPublicKey for decoding');
  }

  // Body starts at byte 86
  let bodyCursor = 0;
  const body = frame.subarray(HEADER_BYTES);

  // ── Decode timestamp column ───────────────────────────────────────────────
  let timestamps: bigint[];
  let tsColumnSize: number;

  if (hasTsDelta) {
    // Import delta decoder
    const { decodeTimestampDeltas, encodeTimestampDeltas } = await import('@dotprotocol/compression');
    timestamps = decodeTimestampDeltas(body.subarray(bodyCursor), dotCount);
    tsColumnSize = encodeTimestampDeltas(timestamps).length;
  } else {
    tsColumnSize = dotCount * 8;
    timestamps = [];
    for (let i = 0; i < dotCount; i++) {
      timestamps.push(readBigUint64BE(body, bodyCursor + i * 8));
    }
  }
  const tsEnd = bodyCursor + tsColumnSize;

  // ── Decode type column ────────────────────────────────────────────────────
  let types: Uint8Array;
  let typesEnd: number;

  if (hasTypeRLE) {
    const { decodePayloadTypes } = await import('@dotprotocol/compression');
    const rleEnd = body.length - dotCount * PAYLOAD_SIZE_DOT;
    if (rleEnd <= tsEnd) {
      throw new RangeError('unwrap: buffer too short for RLE types + payloads');
    }
    const rleSlice = body.subarray(tsEnd, rleEnd);
    types = decodePayloadTypes(rleSlice, dotCount);
    typesEnd = rleEnd;
  } else {
    types = body.subarray(tsEnd, tsEnd + dotCount);
    typesEnd = tsEnd + dotCount;
  }

  // ── Decode payload column ─────────────────────────────────────────────────
  const payloadStart = typesEnd;
  const payloadTotal = dotCount * PAYLOAD_SIZE_DOT;
  if (payloadStart + payloadTotal > body.length) {
    throw new RangeError('unwrap: buffer too short for payloads');
  }

  // ── Reconstruct DOTs ──────────────────────────────────────────────────────
  // sig field = aggSig (48B) + 16 zero bytes
  const sigField = new Uint8Array(SIG_SIZE);
  sigField.set(aggSig);

  const dots: Uint8Array[] = [];
  let prevDot: Uint8Array | null = null;

  for (let i = 0; i < dotCount; i++) {
    const dot = new Uint8Array(DOT_SIZE);
    dot.set(pubkey, 0); // pubkey
    dot.set(sigField, 32); // sig

    // chain hash
    const chainHash = new Uint8Array(CHAIN_SIZE);
    if (prevDot !== null) {
      chainHash.set(sha256(prevDot));
    }
    dot.set(chainHash, 96); // chain

    writeBigUint64BE(dot, 128, timestamps[i]!); // timestamp
    dot[136] = types[i]!; // type

    // payload (16B)
    const payloadOffset = payloadStart + i * PAYLOAD_SIZE_DOT;
    dot.set(body.subarray(payloadOffset, payloadOffset + PAYLOAD_SIZE_DOT), 137);

    dots.push(dot);
    prevDot = dot;
  }

  return dots;
}
