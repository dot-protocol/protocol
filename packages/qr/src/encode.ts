/**
 * DOT Protocol v0.3.0 — QR-DOT Encoder
 *
 * Encodes one or more DOTs into a QR payload buffer.
 * Supports three encoding modes:
 *   binary:          raw 153-byte DOTs, packed sequentially
 *   steganographic:  DOTs XOR-masked into QR module data
 *   nested:          each DOT prefixed with its index (for microdot containers)
 *
 * Transport (actually generating QR images) is the builder's choice.
 * This module produces the raw bytes to encode.
 */

import { toBytes, fromBytes } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import { QR_CAPACITY, type QREncoding, type QRDOTSpec } from './types.js';

export const DOT_SIZE = 153 as const;

/**
 * Encode an array of DOTs into a binary buffer.
 * Each DOT occupies exactly 153 bytes. No framing, no header.
 * Maximum ~19 DOTs per standard QR v40 L.
 */
export function encodeBinary(dots: DOT[]): Uint8Array {
  if (dots.length === 0) throw new Error('Cannot encode empty DOT array');
  if (dots.length > QR_CAPACITY.dotsPerCode) {
    throw new Error(
      `Too many DOTs: ${dots.length} exceeds QR capacity of ${QR_CAPACITY.dotsPerCode}`
    );
  }

  const buf = new Uint8Array(dots.length * DOT_SIZE);
  for (let i = 0; i < dots.length; i++) {
    buf.set(toBytes(dots[i]), i * DOT_SIZE);
  }
  return buf;
}

/**
 * Decode a binary buffer back into DOTs.
 * Buffer length must be a multiple of 153.
 */
export function decodeBinary(buf: Uint8Array): DOT[] {
  if (buf.length % DOT_SIZE !== 0) {
    throw new Error(`Buffer length ${buf.length} is not a multiple of ${DOT_SIZE}`);
  }

  const dots: DOT[] = [];
  for (let offset = 0; offset < buf.length; offset += DOT_SIZE) {
    dots.push(fromBytes(buf.slice(offset, offset + DOT_SIZE)));
  }
  return dots;
}

/**
 * Encode DOTs using steganographic mode.
 * DOTs are XOR-masked with a key derived from the QR module pattern.
 * The carrier (QR data) must be provided by the caller.
 *
 * mask: repeated cycling of DOT bytes XOR'd with carrier bytes.
 * The carrier is recovered by XOR-ing again — symmetrical.
 */
export function encodeSteganographic(dots: DOT[], carrier: Uint8Array): Uint8Array {
  const dotBytes = encodeBinary(dots);
  if (dotBytes.length > carrier.length) {
    throw new Error(
      `DOT payload (${dotBytes.length}B) exceeds carrier capacity (${carrier.length}B)`
    );
  }

  const result = new Uint8Array(carrier);
  for (let i = 0; i < dotBytes.length; i++) {
    result[i] = result[i] ^ dotBytes[i];
  }
  return result;
}

/**
 * Decode DOTs from a steganographic carrier.
 * XOR with the known mask (original carrier) to recover DOT bytes.
 */
export function decodeSteganographic(
  masked: Uint8Array,
  carrier: Uint8Array,
  dotCount: number
): DOT[] {
  const recovered = new Uint8Array(dotCount * DOT_SIZE);
  for (let i = 0; i < recovered.length; i++) {
    recovered[i] = masked[i] ^ carrier[i];
  }
  return decodeBinary(recovered);
}

/**
 * Encode DOTs in nested mode.
 * Each DOT is prefixed with a 2-byte index (big-endian uint16).
 * Used for microdot containers where modules are addressed individually.
 *
 * Format per entry: [index_hi, index_lo, ...153 bytes DOT]
 */
export function encodeNested(dots: DOT[]): Uint8Array {
  const ENTRY_SIZE = 2 + DOT_SIZE; // 2-byte index + 153-byte DOT
  const buf = new Uint8Array(dots.length * ENTRY_SIZE);

  for (let i = 0; i < dots.length; i++) {
    const offset = i * ENTRY_SIZE;
    buf[offset] = (i >> 8) & 0xff;
    buf[offset + 1] = i & 0xff;
    buf.set(toBytes(dots[i]), offset + 2);
  }
  return buf;
}

/**
 * Decode DOTs from nested mode buffer.
 * Returns DOTs ordered by their embedded index.
 */
export function decodeNested(buf: Uint8Array): DOT[] {
  const ENTRY_SIZE = 2 + DOT_SIZE;
  if (buf.length % ENTRY_SIZE !== 0) {
    throw new Error(`Buffer length ${buf.length} is not a multiple of ${ENTRY_SIZE}`);
  }

  const entries: Array<{ index: number; dot: DOT }> = [];
  for (let offset = 0; offset < buf.length; offset += ENTRY_SIZE) {
    const index = (buf[offset] << 8) | buf[offset + 1];
    const dot = fromBytes(buf.slice(offset + 2, offset + 2 + DOT_SIZE));
    entries.push({ index, dot });
  }

  return entries
    .sort((a, b) => a.index - b.index)
    .map((e) => e.dot);
}

/**
 * Select appropriate QR spec for a given number of DOTs.
 * Returns the minimum QR version that fits all DOTs.
 */
export function selectQRSpec(dotCount: number, encoding: QREncoding = 'binary'): QRDOTSpec {
  const bytesNeeded = encoding === 'nested'
    ? dotCount * (2 + DOT_SIZE)
    : dotCount * DOT_SIZE;

  // QR capacity table (data bytes, error correction L)
  // Simplified: use version 40 for anything over 500 bytes
  let version = 10; // v10 = 346 bytes (fits ~2 DOTs)
  if (bytesNeeded <= 17)   version = 1;
  else if (bytesNeeded <= 32)   version = 2;
  else if (bytesNeeded <= 53)   version = 3;
  else if (bytesNeeded <= 78)   version = 4;
  else if (bytesNeeded <= 106)  version = 5;
  else if (bytesNeeded <= 134)  version = 6;
  else if (bytesNeeded <= 154)  version = 7;
  else if (bytesNeeded <= 192)  version = 8;
  else if (bytesNeeded <= 230)  version = 9;
  else if (bytesNeeded <= 271)  version = 10;
  else if (bytesNeeded <= 321)  version = 11;
  else if (bytesNeeded <= 367)  version = 12;
  else if (bytesNeeded <= 425)  version = 13;
  else if (bytesNeeded <= 458)  version = 14;
  else if (bytesNeeded <= 520)  version = 15;
  else if (bytesNeeded <= 586)  version = 16;
  else if (bytesNeeded <= 644)  version = 17;
  else if (bytesNeeded <= 718)  version = 18;
  else if (bytesNeeded <= 792)  version = 19;
  else if (bytesNeeded <= 858)  version = 20;
  else if (bytesNeeded <= 929)  version = 21;
  else if (bytesNeeded <= 1003) version = 22;
  else if (bytesNeeded <= 1091) version = 23;
  else if (bytesNeeded <= 1171) version = 24;
  else if (bytesNeeded <= 1273) version = 25;
  else if (bytesNeeded <= 1367) version = 26;
  else if (bytesNeeded <= 1465) version = 27;
  else if (bytesNeeded <= 1528) version = 28;
  else if (bytesNeeded <= 1628) version = 29;
  else if (bytesNeeded <= 1732) version = 30;
  else if (bytesNeeded <= 1840) version = 31;
  else if (bytesNeeded <= 1952) version = 32;
  else if (bytesNeeded <= 2068) version = 33;
  else if (bytesNeeded <= 2188) version = 34;
  else if (bytesNeeded <= 2303) version = 35;
  else if (bytesNeeded <= 2431) version = 36;
  else if (bytesNeeded <= 2563) version = 37;
  else if (bytesNeeded <= 2699) version = 38;
  else if (bytesNeeded <= 2809) version = 39;
  else version = 40;

  return {
    version,
    errorCorrection: 'L',
    dotsPerCode: dotCount,
    encoding,
  };
}
