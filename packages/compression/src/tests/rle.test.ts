import { describe, it, expect } from 'vitest';
import { encodePayloadTypes, decodePayloadTypes } from '../rle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTypes(pattern: Array<[number, number]>): Uint8Array {
  const total = pattern.reduce((acc, [, n]) => acc + n, 0);
  const arr = new Uint8Array(total);
  let pos = 0;
  for (const [type, count] of pattern) {
    arr.fill(type, pos, pos + count);
    pos += count;
  }
  return arr;
}

function roundtrip(types: Uint8Array): Uint8Array {
  const encoded = encodePayloadTypes(types);
  return decodePayloadTypes(encoded, types.length);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 1. Homogeneous batch: 100 × type 0x01 → exactly 2 bytes
// ---------------------------------------------------------------------------

describe('encodePayloadTypes — homogeneous batch', () => {
  it('100 × 0x01 encodes to exactly 2 bytes', () => {
    const types = new Uint8Array(100).fill(0x01);
    const encoded = encodePayloadTypes(types);
    expect(encoded.length).toBe(2);
  });

  it('100 × 0x00 (public) encodes to exactly 2 bytes', () => {
    const types = new Uint8Array(100).fill(0x00);
    const encoded = encodePayloadTypes(types);
    expect(encoded.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Alternating types: worst case — [0x00, 0x01, ...] × 50 → 100 bytes
// ---------------------------------------------------------------------------

describe('encodePayloadTypes — alternating types (worst case)', () => {
  it('[0x00, 0x01] × 50 (100 elements) encodes to 200 bytes', () => {
    const types = new Uint8Array(100);
    for (let i = 0; i < 100; i++) {
      types[i] = i % 2 === 0 ? 0x00 : 0x01;
    }
    const encoded = encodePayloadTypes(types);
    // 100 runs of length 1 → each run = 1 type byte + 1 count varint byte = 2 bytes
    // 100 runs × 2 bytes = 200 bytes (worst case: 2× expansion vs raw storage)
    expect(encoded.length).toBe(200);
  });

  it('alternating roundtrip is correct', () => {
    const types = new Uint8Array(100);
    for (let i = 0; i < 100; i++) {
      types[i] = i % 2 === 0 ? 0x00 : 0x01;
    }
    const decoded = roundtrip(types);
    expect(arraysEqual(decoded, types)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Mixed runs: [0x01 × 50, 0x02 × 30, 0x01 × 20] → 6 bytes (3 runs × 2 bytes)
// ---------------------------------------------------------------------------

describe('encodePayloadTypes — mixed runs', () => {
  it('[0x01×50, 0x02×30, 0x01×20] encodes to exactly 6 bytes', () => {
    // All counts (50, 30, 20) are < 128 → each count varint = 1 byte
    // 3 runs × (1 type byte + 1 varint byte) = 6 bytes
    const types = makeTypes([[0x01, 50], [0x02, 30], [0x01, 20]]);
    const encoded = encodePayloadTypes(types);
    expect(encoded.length).toBe(6);
  });

  it('[0x01×50, 0x02×30, 0x01×20] roundtrip is correct', () => {
    const types = makeTypes([[0x01, 50], [0x02, 30], [0x01, 20]]);
    const decoded = roundtrip(types);
    expect(arraysEqual(decoded, types)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Single element → 2 bytes
// ---------------------------------------------------------------------------

describe('encodePayloadTypes — single element', () => {
  it('[0x03] encodes to 2 bytes', () => {
    const types = new Uint8Array([0x03]);
    const encoded = encodePayloadTypes(types);
    expect(encoded.length).toBe(2);
  });

  it('[0x00] encodes to 2 bytes', () => {
    const types = new Uint8Array([0x00]);
    const encoded = encodePayloadTypes(types);
    expect(encoded.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Roundtrip correctness on all cases
// ---------------------------------------------------------------------------

describe('encodePayloadTypes / decodePayloadTypes — roundtrip', () => {
  it('homogeneous 100 × 0x01 roundtrip', () => {
    const types = new Uint8Array(100).fill(0x01);
    expect(arraysEqual(roundtrip(types), types)).toBe(true);
  });

  it('single element [0x02] roundtrip', () => {
    const types = new Uint8Array([0x02]);
    expect(arraysEqual(roundtrip(types), types)).toBe(true);
  });

  it('mixed runs [0x00×10, 0x01×5, 0x02×1, 0x03×20] roundtrip', () => {
    const types = makeTypes([[0x00, 10], [0x01, 5], [0x02, 1], [0x03, 20]]);
    expect(arraysEqual(roundtrip(types), types)).toBe(true);
  });

  it('all four type values in sequence roundtrip', () => {
    const types = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(arraysEqual(roundtrip(types), types)).toBe(true);
  });

  it('large homogeneous batch of 1000 roundtrip', () => {
    const types = new Uint8Array(1000).fill(0x00);
    expect(arraysEqual(roundtrip(types), types)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Empty array → throws
// ---------------------------------------------------------------------------

describe('encodePayloadTypes — empty array', () => {
  it('throws RangeError for empty Uint8Array', () => {
    expect(() => encodePayloadTypes(new Uint8Array(0))).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 7. Count mismatch in decode → throws
// ---------------------------------------------------------------------------

describe('decodePayloadTypes — count mismatch', () => {
  it('throws RangeError when totalCount is too large', () => {
    const types = new Uint8Array(10).fill(0x01);
    const encoded = encodePayloadTypes(types);
    // Claim there should be 20 types, but only 10 are encoded
    expect(() => decodePayloadTypes(encoded, 20)).toThrow(RangeError);
  });

  it('throws RangeError when totalCount is too small', () => {
    const types = new Uint8Array(10).fill(0x01);
    const encoded = encodePayloadTypes(types);
    // Claim there should be only 5 types, but 10 are encoded
    expect(() => decodePayloadTypes(encoded, 5)).toThrow(RangeError);
  });
});
