/**
 * Run-length encoding for DOT payload type arrays.
 *
 * Format: [type_byte, count_varint, type_byte, count_varint, ...]
 *
 * For a homogeneous batch (all same type), encodes to 2 bytes total.
 * For alternating types, encodes to 2× the number of elements (no savings, but no expansion).
 *
 * Used in batch v2 to compress the type column.
 */

import { encodeVarint, decodeVarint } from './varint.js';

/**
 * Encode a Uint8Array of type bytes using run-length encoding.
 * @param types - Array of uint8 DOT type values
 * @returns RLE-encoded buffer
 * @throws RangeError if types is empty
 */
export function encodePayloadTypes(types: Uint8Array): Uint8Array {
  if (types.length === 0) {
    throw new RangeError('encodePayloadTypes: types array must not be empty');
  }

  // First pass: collect [type, runLength] pairs
  const runs: Array<[number, number]> = [];
  let currentType = types[0]!;
  let runLength = 1;

  for (let i = 1; i < types.length; i++) {
    const t = types[i]!;
    if (t === currentType) {
      runLength++;
    } else {
      runs.push([currentType, runLength]);
      currentType = t;
      runLength = 1;
    }
  }
  // Flush final run
  runs.push([currentType, runLength]);

  // Second pass: calculate total encoded size
  let totalBytes = 0;
  const countVarints: Uint8Array[] = [];
  for (const [, count] of runs) {
    const countEncoded = encodeVarint(count);
    countVarints.push(countEncoded);
    totalBytes += 1 + countEncoded.length; // 1 byte for type + varint for count
  }

  // Assemble output
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (let r = 0; r < runs.length; r++) {
    const [type] = runs[r]!;
    out[offset++] = type;
    const cv = countVarints[r]!;
    out.set(cv, offset);
    offset += cv.length;
  }

  return out;
}

/**
 * Decode RLE-encoded type buffer back to flat array.
 * @param buf - RLE buffer from encodePayloadTypes
 * @param totalCount - Total number of types to decode (must match original)
 * @returns Flat Uint8Array of type values
 * @throws RangeError if decoded count doesn't match totalCount or buffer is malformed
 */
export function decodePayloadTypes(buf: Uint8Array, totalCount: number): Uint8Array {
  const out = new Uint8Array(totalCount);
  let writePos = 0;
  let readPos = 0;

  while (readPos < buf.length) {
    // Read type byte
    if (readPos >= buf.length) {
      throw new RangeError(
        `decodePayloadTypes: unexpected end of buffer reading type byte at offset ${readPos}`,
      );
    }
    const type = buf[readPos++]!;

    // Read count varint
    const [count, bytesConsumed] = decodeVarint(buf, readPos);
    readPos += bytesConsumed;

    // Fill output
    if (writePos + count > totalCount) {
      throw new RangeError(
        `decodePayloadTypes: decoded count exceeds totalCount (${writePos + count} > ${totalCount})`,
      );
    }
    out.fill(type, writePos, writePos + count);
    writePos += count;
  }

  if (writePos !== totalCount) {
    throw new RangeError(
      `decodePayloadTypes: count mismatch — decoded ${writePos} types but expected ${totalCount}`,
    );
  }

  return out;
}
