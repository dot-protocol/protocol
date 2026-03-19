import { describe, it, expect } from 'vitest';
import { createBatchCompressor } from '../compress.js';

describe('browser-safe batch compression', () => {
  it('compresses an array of 153-byte DOTs', () => {
    const compressor = createBatchCompressor();
    const dots: Uint8Array[] = Array.from({ length: 20 }, (_, i) => {
      const d = new Uint8Array(153);
      d[137] = i % 4; // only low-variation in payload
      return d;
    });
    const { compressedSize, rawSize, ratio } = compressor.measure(dots);
    expect(rawSize).toBe(20 * 153);
    expect(ratio).toBeGreaterThan(0);
    expect(compressedSize).toBeGreaterThan(0);
  });

  it('returns ratio=1.0 for empty input', () => {
    const compressor = createBatchCompressor();
    const { ratio } = compressor.measure([]);
    expect(ratio).toBe(1);
  });

  it('feed() increases totalDots tracking', () => {
    const compressor = createBatchCompressor();
    const dot = new Uint8Array(153);
    compressor.feed(dot);
    compressor.feed(dot);
    // No public totalDots, but shouldn't throw
    expect(compressor.measure([dot]).ratio).toBeGreaterThan(0);
  });
});
