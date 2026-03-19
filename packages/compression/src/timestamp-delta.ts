/**
 * Timestamp delta encoding for DOT batch streams.
 *
 * Given N timestamps (Unix ms as bigint), encode as:
 *   - First timestamp: 8 bytes big-endian uint64
 *   - Subsequent timestamps: signed varint delta from previous (in ms)
 *
 * For periodic sensors (100ms intervals), every delta = 100 → 1 varint byte.
 * For 1s intervals, delta = 1000 → 2 varint bytes.
 * For irregular sensors, delta varies but stays small → 2-3 bytes typically.
 *
 * Negative deltas are supported (out-of-order timestamps from sensors).
 */

import { encodeSignedVarint, decodeSignedVarint } from './varint.js';

/**
 * Encode array of bigint timestamps as first-value + signed-varint deltas.
 * Returns a Uint8Array containing the encoded data.
 *
 * Layout:
 *   [0..7]  — first timestamp as 8-byte big-endian uint64
 *   [8..]   — signed varint deltas for timestamps[1], timestamps[2], ...
 *
 * @throws RangeError if timestamps array is empty
 */
export function encodeTimestampDeltas(timestamps: bigint[]): Uint8Array {
  if (timestamps.length === 0) {
    throw new RangeError('encodeTimestampDeltas: timestamps array must not be empty');
  }

  // Collect all encoded pieces: first the 8-byte anchor, then varint deltas
  const pieces: Uint8Array[] = [];

  // Write first timestamp as 8-byte big-endian uint64
  const anchor = new Uint8Array(8);
  const view = new DataView(anchor.buffer);
  // bigint → write high 32 bits and low 32 bits separately
  const first = timestamps[0]!;
  const high = Number(first >> 32n);
  const low = Number(first & 0xffffffffn);
  view.setUint32(0, high, false); // big-endian
  view.setUint32(4, low, false);  // big-endian
  pieces.push(anchor);

  // Write each subsequent delta as a signed varint
  for (let i = 1; i < timestamps.length; i++) {
    const delta = Number(timestamps[i]! - timestamps[i - 1]!);
    pieces.push(encodeSignedVarint(delta));
  }

  // Concatenate all pieces into a single buffer
  const totalLength = pieces.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const piece of pieces) {
    result.set(piece, offset);
    offset += piece.length;
  }

  return result;
}

/**
 * Decode timestamp delta buffer back to array of bigint timestamps.
 *
 * @param buf   - The encoded buffer (from encodeTimestampDeltas)
 * @param count - Number of timestamps to decode
 * @throws RangeError if buf is too short for count timestamps
 */
export function decodeTimestampDeltas(buf: Uint8Array, count: number): bigint[] {
  if (count === 0) {
    return [];
  }
  if (buf.length < 8) {
    throw new RangeError(
      `decodeTimestampDeltas: buffer too short (${buf.length} bytes) to decode even the anchor timestamp`,
    );
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Read first timestamp as 8-byte big-endian uint64
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  const first = (BigInt(high) << 32n) | BigInt(low);

  const timestamps: bigint[] = [first];

  if (count === 1) {
    return timestamps;
  }

  // Decode varint deltas starting at byte 8
  let offset = 8;
  for (let i = 1; i < count; i++) {
    if (offset >= buf.length) {
      throw new RangeError(
        `decodeTimestampDeltas: unexpected end of buffer at offset ${offset} while decoding timestamp ${i} of ${count}`,
      );
    }
    const [delta, bytesConsumed] = decodeSignedVarint(buf, offset);
    offset += bytesConsumed;
    timestamps.push(timestamps[i - 1]! + BigInt(delta));
  }

  return timestamps;
}
