/**
 * Varint encoding — protobuf-style variable-length integers.
 *
 * Each byte uses 7 bits for data and bit 7 (MSB) as continuation flag.
 * 0-127       → 1 byte
 * 128-16383   → 2 bytes
 * 16384-2097151 → 3 bytes
 * etc.
 *
 * Signed integers use zigzag encoding:
 *   0 → 0, -1 → 1, 1 → 2, -2 → 3, 2 → 4, ...
 * This maps small negative numbers to small positive numbers,
 * making them encode efficiently.
 */

/**
 * Encode unsigned integer as varint.
 * Max safe value: 2^53 - 1 (Number.MAX_SAFE_INTEGER).
 */
export function encodeVarint(value: number): Uint8Array {
  if (value < 0 || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`encodeVarint: value must be a non-negative finite integer, got ${value}`);
  }

  // Fast path: single byte
  if (value < 128) {
    return new Uint8Array([value]);
  }

  // Compute bytes needed and encode
  const bytes: number[] = [];
  let remaining = value;

  while (remaining >= 128) {
    // Take low 7 bits and set continuation bit
    bytes.push((remaining & 0x7f) | 0x80);
    // Shift right 7 bits. For values > 2^31 we can't use bitwise >>
    // because JS bitwise ops truncate to signed 32-bit. Use division.
    remaining = Math.floor(remaining / 128);
  }
  // Last byte has no continuation bit
  bytes.push(remaining & 0x7f);

  return new Uint8Array(bytes);
}

/**
 * Decode varint from buffer at offset.
 * Returns [value, bytesConsumed].
 * Throws if the varint extends past the end of the buffer.
 */
export function decodeVarint(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let bytesConsumed = 0;

  while (true) {
    const pos = offset + bytesConsumed;
    if (pos >= buf.length) {
      throw new RangeError(
        `decodeVarint: unexpected end of buffer at offset ${pos} (buf.length=${buf.length})`,
      );
    }

    const byte = buf[pos]!;
    bytesConsumed++;

    // For shifts >= 32 we can't use bitwise << (truncates to 32-bit signed).
    // Use multiplication by powers of 2 instead.
    const contribution = (byte & 0x7f) * Math.pow(2, shift);
    value += contribution;
    shift += 7;

    // No continuation bit — done
    if ((byte & 0x80) === 0) {
      break;
    }

    // Guard against impossibly long varints (>= 8 bytes for 53-bit values)
    if (shift >= 56) {
      throw new RangeError(`decodeVarint: varint too long (shift=${shift}), possible data corruption`);
    }
  }

  return [value, bytesConsumed];
}

/**
 * Zigzag-encode a signed integer to an unsigned integer.
 * Maps small negatives to small positives:
 *   0 → 0, -1 → 1, 1 → 2, -2 → 3, 2 → 4, ...
 */
function zigzagEncode(n: number): number {
  // For safe integer range we can use: n >= 0 ? n * 2 : (-n * 2) - 1
  return n >= 0 ? n * 2 : (-n) * 2 - 1;
}

/**
 * Zigzag-decode an unsigned integer back to a signed integer.
 */
function zigzagDecode(n: number): number {
  // Even → positive: n >>> 1
  // Odd  → negative: -((n + 1) >>> 1)
  // For values > 2^31 we can't use bitwise >>> safely. Use Math.floor.
  if ((n & 1) === 0) {
    return n / 2;
  } else {
    return -((n + 1) / 2);
  }
}

/**
 * Encode signed integer using zigzag encoding, then varint.
 */
export function encodeSignedVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new RangeError(`encodeSignedVarint: value must be a finite integer, got ${value}`);
  }
  const MAX_SIGNED = Math.floor(Number.MAX_SAFE_INTEGER / 2);
  if (Math.abs(value) > MAX_SIGNED) {
    throw new RangeError(`encodeSignedVarint: value ${value} exceeds safe range (±${MAX_SIGNED})`);
  }
  return encodeVarint(zigzagEncode(value));
}

/**
 * Decode zigzag-encoded signed varint from buffer at offset.
 * Returns [value, bytesConsumed].
 */
export function decodeSignedVarint(buf: Uint8Array, offset: number): [number, number] {
  const [unsigned, bytesConsumed] = decodeVarint(buf, offset);
  return [zigzagDecode(unsigned), bytesConsumed];
}
