import { describe, it, expect } from 'vitest';
import { buildFrequencyTable, ransEncode, ransDecode } from '../rans.js';

describe('rANS entropy coder', () => {
  // --- FrequencyTable tests ---

  it('FrequencyTable: sums to 4096', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 10, 20, 100, 200]);
    const table = buildFrequencyTable(data);
    const total = Array.from(table.freq).reduce((a, b) => a + b, 0);
    expect(total).toBe(4096);
  });

  it('FrequencyTable: no zero frequencies after Laplace smoothing', () => {
    // Even with all-zeros input, every symbol should have freq >= 1 after smoothing
    const data = new Uint8Array(100); // all zeros
    const table = buildFrequencyTable(data);
    for (let i = 0; i < 256; i++) {
      expect(table.freq[i]).toBeGreaterThanOrEqual(1);
    }
  });

  it('FrequencyTable: cumFreq[256] == 4096', () => {
    const data = new Uint8Array([0, 1, 2, 42, 255]);
    const table = buildFrequencyTable(data);
    expect(table.cumFreq[256]).toBe(4096);
  });

  // --- Roundtrip tests ---

  it('Roundtrip: all-zeros (length 100)', () => {
    const symbols = new Uint8Array(100); // all zeros
    const table = buildFrequencyTable(symbols);
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, symbols.length);
    expect(decoded).toEqual(symbols);
  });

  it('Roundtrip: all-same byte (0x42, length 50)', () => {
    const symbols = new Uint8Array(50).fill(0x42);
    const table = buildFrequencyTable(symbols);
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, symbols.length);
    expect(decoded).toEqual(symbols);
  });

  it('Roundtrip: random bytes (length 100)', () => {
    // Deterministic "random" using lcg
    const symbols = new Uint8Array(100);
    let seed = 0xdeadbeef;
    for (let i = 0; i < 100; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      symbols[i] = seed & 0xff;
    }
    const table = buildFrequencyTable(symbols);
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, symbols.length);
    expect(decoded).toEqual(symbols);
  });

  it('Roundtrip: highly skewed (90% zeros, length 100)', () => {
    const symbols = new Uint8Array(100);
    // 10 random non-zero bytes scattered in
    for (let i = 0; i < 10; i++) {
      symbols[i * 10] = (i + 1) & 0xff;
    }
    const table = buildFrequencyTable(symbols);
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, symbols.length);
    expect(decoded).toEqual(symbols);
  });

  // --- Compression ratio test ---

  it('Size: zeros compress better than random bytes', () => {
    const zeros = new Uint8Array(100);
    const random = new Uint8Array(100);
    let seed = 0xc0ffee;
    for (let i = 0; i < 100; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      random[i] = seed & 0xff;
    }

    const tableZeros = buildFrequencyTable(zeros);
    const tableRandom = buildFrequencyTable(random);

    const encodedZeros = ransEncode(zeros, tableZeros);
    const encodedRandom = ransEncode(random, tableRandom);

    expect(encodedZeros.length).toBeLessThan(encodedRandom.length);
  });

  // --- Edge cases ---

  it('Edge: length=1 roundtrip', () => {
    const symbols = new Uint8Array([0xab]);
    const table = buildFrequencyTable(symbols);
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, symbols.length);
    expect(decoded).toEqual(symbols);
  });

  it('Edge: length=0 returns empty output', () => {
    const symbols = new Uint8Array(0);
    const table = buildFrequencyTable(new Uint8Array([0])); // need some data for table
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, 0);
    expect(decoded.length).toBe(0);
  });
});
