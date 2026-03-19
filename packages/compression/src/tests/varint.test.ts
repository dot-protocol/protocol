import { describe, it, expect } from 'vitest';
import {
  encodeVarint,
  decodeVarint,
  encodeSignedVarint,
  decodeSignedVarint,
} from '../varint.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundtripUnsigned(n: number): number {
  const encoded = encodeVarint(n);
  const [decoded] = decodeVarint(encoded, 0);
  return decoded;
}

function roundtripSigned(n: number): number {
  const encoded = encodeSignedVarint(n);
  const [decoded] = decodeSignedVarint(encoded, 0);
  return decoded;
}

// ---------------------------------------------------------------------------
// Unsigned roundtrip
// ---------------------------------------------------------------------------

describe('encodeVarint / decodeVarint — roundtrip', () => {
  const cases: number[] = [0, 1, 127, 128, 255, 256, 16383, 16384, 2 ** 32, 2 ** 48];

  for (const n of cases) {
    it(`roundtrips ${n}`, () => {
      expect(roundtripUnsigned(n)).toBe(n);
    });
  }
});

// ---------------------------------------------------------------------------
// Signed roundtrip (zigzag)
// ---------------------------------------------------------------------------

describe('encodeSignedVarint / decodeSignedVarint — roundtrip', () => {
  const cases: number[] = [0, -1, 1, -127, 127, -128, 128, -1000000, 1000000];

  for (const n of cases) {
    it(`roundtrips signed ${n}`, () => {
      expect(roundtripSigned(n)).toBe(n);
    });
  }
});

// ---------------------------------------------------------------------------
// Size assertions (unsigned)
// ---------------------------------------------------------------------------

describe('encodeVarint — byte size guarantees', () => {
  it('0 encodes to 1 byte', () => {
    expect(encodeVarint(0).length).toBe(1);
  });

  it('127 encodes to 1 byte', () => {
    expect(encodeVarint(127).length).toBe(1);
  });

  it('128 encodes to 2 bytes', () => {
    expect(encodeVarint(128).length).toBe(2);
  });

  it('16383 encodes to 2 bytes', () => {
    expect(encodeVarint(16383).length).toBe(2);
  });

  it('16384 encodes to 3 bytes', () => {
    expect(encodeVarint(16384).length).toBe(3);
  });

  it('2097151 encodes to 3 bytes', () => {
    expect(encodeVarint(2097151).length).toBe(3);
  });

  it('2097152 encodes to 4 bytes', () => {
    expect(encodeVarint(2097152).length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// bytesConsumed is correct (mid-buffer offset test)
// ---------------------------------------------------------------------------

describe('decodeVarint — bytesConsumed accuracy', () => {
  it('correctly reports bytesConsumed for 1-byte varint at offset 3', () => {
    // Build a buffer: [0, 0, 0, 42, 0, 0]
    const buf = new Uint8Array([0, 0, 0, 42, 0, 0]);
    const [value, consumed] = decodeVarint(buf, 3);
    expect(value).toBe(42);
    expect(consumed).toBe(1);
  });

  it('correctly reports bytesConsumed for 2-byte varint at offset 2', () => {
    // Encode 300 = 0xAC 0x02 in varint
    const encoded = encodeVarint(300);
    expect(encoded.length).toBe(2);
    // Embed at offset 2 inside a larger buffer
    const buf = new Uint8Array(10);
    buf.set(encoded, 2);
    const [value, consumed] = decodeVarint(buf, 2);
    expect(value).toBe(300);
    expect(consumed).toBe(2);
  });

  it('correctly reports bytesConsumed for 3-byte varint at offset 1', () => {
    const encoded = encodeVarint(16384);
    expect(encoded.length).toBe(3);
    const buf = new Uint8Array(10);
    buf.set(encoded, 1);
    const [value, consumed] = decodeVarint(buf, 1);
    expect(value).toBe(16384);
    expect(consumed).toBe(3);
  });

  it('can decode multiple consecutive varints from a single buffer', () => {
    // Pack three varints: 1 (1B), 300 (2B), 16384 (3B)
    const a = encodeVarint(1);
    const b = encodeVarint(300);
    const c = encodeVarint(16384);
    const buf = new Uint8Array(a.length + b.length + c.length);
    buf.set(a, 0);
    buf.set(b, a.length);
    buf.set(c, a.length + b.length);

    const [v1, c1] = decodeVarint(buf, 0);
    const [v2, c2] = decodeVarint(buf, c1);
    const [v3, c3] = decodeVarint(buf, c1 + c2);

    expect(v1).toBe(1);
    expect(v2).toBe(300);
    expect(v3).toBe(16384);
    expect(c1).toBe(1);
    expect(c2).toBe(2);
    expect(c3).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// encodeVarint — float input guard
// ---------------------------------------------------------------------------

describe('encodeVarint — input validation', () => {
  it('throws RangeError for float input (1.5)', () => {
    expect(() => encodeVarint(1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// encodeSignedVarint — signed overflow guard
// ---------------------------------------------------------------------------

describe('encodeSignedVarint — range guard', () => {
  it('throws RangeError when value exceeds MAX_SIGNED (Math.floor(MAX_SAFE_INTEGER / 2) + 1)', () => {
    const tooLarge = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    expect(() => encodeSignedVarint(tooLarge)).toThrow(RangeError);
  });

  it('throws RangeError when value is below -MAX_SIGNED', () => {
    const tooSmall = -(Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1);
    expect(() => encodeSignedVarint(tooSmall)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Error on reading past end of buffer
// ---------------------------------------------------------------------------

describe('decodeVarint — error on buffer overrun', () => {
  it('throws RangeError when buffer is completely empty', () => {
    expect(() => decodeVarint(new Uint8Array(0), 0)).toThrow(RangeError);
  });

  it('throws RangeError when offset equals buffer length', () => {
    const buf = new Uint8Array([42]);
    expect(() => decodeVarint(buf, 1)).toThrow(RangeError);
  });

  it('throws RangeError when a multi-byte varint is truncated', () => {
    // 0x80 = continuation bit set but no following byte
    const buf = new Uint8Array([0x80]);
    expect(() => decodeVarint(buf, 0)).toThrow(RangeError);
  });

  it('throws RangeError when varint is truncated mid-sequence', () => {
    // 300 needs 2 bytes; only provide 1 continuation byte
    const partial = new Uint8Array([0xac]); // first byte of 300, continuation bit set
    expect(() => decodeVarint(partial, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Signed varint — additional edge cases
// ---------------------------------------------------------------------------

describe('encodeSignedVarint / decodeSignedVarint — edge cases', () => {
  it('negative zero is treated as zero', () => {
    expect(roundtripSigned(-0)).toBe(0);
  });

  it('signed 0 encodes to 1 byte (zigzag 0 → 0)', () => {
    expect(encodeSignedVarint(0).length).toBe(1);
  });

  it('signed -1 encodes to 1 byte (zigzag -1 → 1)', () => {
    expect(encodeSignedVarint(-1).length).toBe(1);
  });

  it('signed 1 encodes to 1 byte (zigzag 1 → 2)', () => {
    expect(encodeSignedVarint(1).length).toBe(1);
  });

  it('signed -64 encodes to 1 byte (zigzag -64 → 127)', () => {
    // zigzag(-64) = 64*2-1 = 127 → 1 byte
    expect(encodeSignedVarint(-64).length).toBe(1);
  });

  it('signed 64 encodes to 2 bytes (zigzag 64 → 128)', () => {
    // zigzag(64) = 128 → 2 bytes
    expect(encodeSignedVarint(64).length).toBe(2);
  });
});
