import { describe, it, expect } from 'vitest';
import { encodeTimestampDeltas, decodeTimestampDeltas } from '../timestamp-delta.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Generate N timestamps starting at `start` with a fixed step in ms. */
function uniformTimestamps(count: number, startMs: bigint, stepMs: bigint): bigint[] {
  return Array.from({ length: count }, (_, i) => startMs + BigInt(i) * stepMs);
}

/** Assert exact roundtrip for a timestamp array. */
function assertRoundtrip(ts: bigint[]): void {
  const encoded = encodeTimestampDeltas(ts);
  const decoded = decodeTimestampDeltas(encoded, ts.length);
  expect(decoded.length).toBe(ts.length);
  for (let i = 0; i < ts.length; i++) {
    expect(decoded[i]).toBe(ts[i]);
  }
}

// ─── test suite ───────────────────────────────────────────────────────────────

const BASE = 1_700_000_000_000n; // Nov 2023 epoch anchor in ms

describe('timestamp-delta encoder', () => {
  // 1. 100ms intervals — delta=100 → zigzag(100)=200 → 2 varint bytes each
  //    (zigzag maps positive n to 2n, so 100→200 which needs 2 bytes)
  //    total = 8 + 99×2 = 206 bytes; assert ≤210
  it('100ms intervals: encodes 100 timestamps in ≤210 bytes', () => {
    const ts = uniformTimestamps(100, BASE, 100n);
    const encoded = encodeTimestampDeltas(ts);
    // zigzag(100) = 200 → needs 2 varint bytes (128-16383 range)
    // 8-byte anchor + 99 × 2-byte deltas = 206 bytes
    expect(encoded.byteLength).toBeLessThanOrEqual(210);
    // Verify it IS exactly 206 (not more)
    expect(encoded.byteLength).toBe(206);
    assertRoundtrip(ts);
  });

  // 2. 1s intervals — delta=1000 → zigzag(1000)=2000 → 2 varint bytes each
  it('1s intervals: encodes 100 timestamps in ≤210 bytes', () => {
    const ts = uniformTimestamps(100, BASE, 1000n);
    const encoded = encodeTimestampDeltas(ts);
    // zigzag(1000) = 2000 → 2 varint bytes (128-16383 range)
    // 8-byte anchor + 99 × 2-byte deltas = 206 bytes
    expect(encoded.byteLength).toBeLessThanOrEqual(210);
    expect(encoded.byteLength).toBe(206);
    assertRoundtrip(ts);
  });

  // 3. Irregular timestamps — random deltas 1–10,000,000ms
  it('irregular timestamps: roundtrip is exact', () => {
    const ts: bigint[] = [BASE];
    // Use a deterministic pseudo-random sequence (LCG) for reproducibility
    let seed = 42;
    for (let i = 1; i < 100; i++) {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const deltaMs = BigInt((seed % 10_000_000) + 1);
      ts.push(ts[ts.length - 1]! + deltaMs);
    }
    assertRoundtrip(ts);
  });

  // 4. Zero delta — consecutive timestamps with same ms value
  it('zero delta: consecutive identical timestamps roundtrip exactly', () => {
    const ts: bigint[] = Array.from({ length: 10 }, () => BASE);
    const encoded = encodeTimestampDeltas(ts);
    // Each zero delta = 1 varint byte (zigzag(0)=0 → 1 byte)
    expect(encoded.byteLength).toBe(8 + 9 * 1); // 8 anchor + 9 zero deltas
    assertRoundtrip(ts);
  });

  // 5. Negative deltas — out-of-order timestamps
  it('negative deltas: out-of-order timestamps roundtrip exactly', () => {
    const ts: bigint[] = [
      BASE,
      BASE - 500n,   // -500ms
      BASE - 1000n,  // -500ms again
      BASE + 200n,   // +1200ms
      BASE - 300n,   // -500ms
    ];
    assertRoundtrip(ts);
  });

  // 6. Size savings comparison vs raw uint64
  it('size savings: delta-encoded 100ms stream saves ≥60% vs raw uint64', () => {
    const ts = uniformTimestamps(100, BASE, 100n);
    const encoded = encodeTimestampDeltas(ts);
    const rawSize = 100 * 8; // 800 bytes as raw uint64
    const savedFraction = (rawSize - encoded.byteLength) / rawSize;
    expect(savedFraction).toBeGreaterThanOrEqual(0.6);
  });

  // 7. Single timestamp — edge case
  it('single timestamp: roundtrips exactly', () => {
    const ts = [BASE + 999n];
    const encoded = encodeTimestampDeltas(ts);
    expect(encoded.byteLength).toBe(8); // just the anchor
    assertRoundtrip(ts);
  });

  // 8. Empty array — should throw
  it('empty array: throws RangeError', () => {
    expect(() => encodeTimestampDeltas([])).toThrow(RangeError);
  });

  // 9. Roundtrip invariant — decodeTimestampDeltas(encodeTimestampDeltas(ts), ts.length) === ts
  it('roundtrip invariant: holds for all test patterns', () => {
    // Max safe delta for encodeSignedVarint: ±(MAX_SAFE_INTEGER / 2) ≈ ±4.5T ms ≈ ±143 years
    // DOT timestamps are realistic epoch values — deltas stay well within this range
    const cases: bigint[][] = [
      uniformTimestamps(1, BASE, 100n),
      uniformTimestamps(50, BASE, 100n),
      uniformTimestamps(50, BASE, 1000n),
      uniformTimestamps(10, BASE, 0n),                        // all same (zero delta)
      [BASE, BASE - 1n, BASE - 2n, BASE + 10n],               // mixed neg/pos
      [BASE, BASE + 1_000_000_000n, BASE + 1_000_000_001n],   // large but safe deltas
    ];

    for (const ts of cases) {
      assertRoundtrip(ts);
    }
  });

  // Bonus: very large anchor timestamp (near 2^53 ms) with small deltas still encodes correctly
  it('large timestamp anchor: encodes and decodes MAX_SAFE_INTEGER-scale timestamps', () => {
    // 2^53 - 1 ms ≈ year 285,428 — anchor can be huge; deltas stay small
    const huge = BigInt(Number.MAX_SAFE_INTEGER);
    const ts = [huge, huge + 100n, huge + 200n, huge + 300n];
    assertRoundtrip(ts);
  });

  // Verify that decoding with wrong count throws on buffer exhaustion
  it('decode: throws RangeError when count exceeds encoded data', () => {
    const ts = uniformTimestamps(5, BASE, 100n);
    const encoded = encodeTimestampDeltas(ts);
    expect(() => decodeTimestampDeltas(encoded, 100)).toThrow(RangeError);
  });
});
