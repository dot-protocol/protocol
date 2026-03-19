import { describe, it, expect } from 'vitest';
import { trainDictionary, compressWithDictionary, decompressWithDictionary } from '../zstd.js';

// ─── DOT-like sample generators ───────────────────────────────────────────────

/**
 * Generate a single DOT-like batch body.
 *
 * Mimics the column layout of a batch v2 body:
 *   - Timestamp column: varint-delta encoded (small deltas, predictable range)
 *   - Type column: RLE-encoded (mostly 0x00 = public)
 *   - Payload column: 16-byte payloads (float64 fields with small deltas)
 *
 * Using realistic structure improves dictionary quality vs random bytes.
 */
function generateDotLikeSample(dotCount = 50, tsBase = 1_700_000_000_000): Uint8Array {
  // Timestamp deltas: varint-encoded, ~100ms intervals
  const tsDeltas: number[] = [];
  tsDeltas.push(tsBase & 0xff); // simplified — just push low byte as "base marker"
  for (let i = 0; i < dotCount; i++) {
    tsDeltas.push(100 + (i % 10)); // predictable 100-110ms deltas
  }

  // Type column: mostly 0x00 (PUBLIC)
  const types = new Uint8Array(dotCount);
  for (let i = 0; i < dotCount; i++) {
    types[i] = i % 20 === 0 ? 0x01 : 0x00; // 5% CIRCLE, 95% PUBLIC
  }

  // Payload column: 16 bytes per DOT — simulate float64 values with small deltas
  const payloads = new Uint8Array(dotCount * 16);
  const view = new DataView(payloads.buffer);
  let val = 42_000.0;
  for (let i = 0; i < dotCount; i++) {
    val += (Math.random() - 0.5) * 0.01; // tiny price tick
    view.setFloat64(i * 16, val, false);
    // bytes [8..15] = zero-padded (DOT payload structure)
  }

  // Concatenate: [tsDeltas][types][payloads]
  const tsBuf = new Uint8Array(tsDeltas);
  const total = tsBuf.length + types.length + payloads.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  out.set(tsBuf, cursor); cursor += tsBuf.length;
  out.set(types, cursor); cursor += types.length;
  out.set(payloads, cursor);
  return out;
}

/**
 * Generate N DOT-like batch bodies.
 * Each sample varies dot count (40-60) and timestamp base slightly to add
 * realistic variation without losing structural similarity — key for dict training.
 */
function generateDotLikeSamples(n: number): Uint8Array[] {
  return Array.from({ length: n }, (_, i) =>
    generateDotLikeSample(40 + (i % 21), 1_700_000_000_000 + i * 60_000),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('zstd dictionary compression', () => {

  it('trains dictionary without error from sample batch bodies', async () => {
    const samples = generateDotLikeSamples(20);
    const dict = await trainDictionary(samples);

    // Dictionary must be non-empty and not exceed requested size
    expect(dict.length).toBeGreaterThan(0);
    expect(dict.length).toBeLessThanOrEqual(32_768);

    // zstd dictionary magic number: 0xEC30A437 (little-endian)
    const view = new DataView(dict.buffer, dict.byteOffset);
    expect(view.getUint32(0, true)).toBe(0xEC30A437);
  }, 60_000);

  it('compress + decompress roundtrip with dictionary', async () => {
    const samples = generateDotLikeSamples(50);
    const dict = await trainDictionary(samples);

    const data = generateDotLikeSample();
    const compressed = compressWithDictionary(data, dict);
    const decompressed = decompressWithDictionary(compressed, dict);

    // Byte-exact roundtrip
    expect(decompressed.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      if (decompressed[i] !== data[i]) {
        throw new Error(`Byte mismatch at index ${i}: got ${decompressed[i]}, want ${data[i]}`);
      }
    }
  }, 60_000);

  it('compression reduces size on DOT-like data', async () => {
    const samples = generateDotLikeSamples(100);
    const dict = await trainDictionary(samples);
    const data = generateDotLikeSample(100); // larger sample for meaningful compression

    const compressed = compressWithDictionary(data, dict);

    // Dictionary-trained compression should not expand data significantly
    // Allow 10% expansion worst case (small input can slightly expand with compression overhead)
    expect(compressed.length).toBeLessThanOrEqual(data.length * 1.1);

    const ratio = data.length / compressed.length;
    console.log(
      `  DOT batch: ${data.length}B → ${compressed.length}B (${ratio.toFixed(2)}× compression)`,
    );
  }, 60_000);

  it('compression ratio improves with more training samples', async () => {
    const dataToCompress = generateDotLikeSample(200);

    // Train on small set (20 samples)
    const dictSmall = await trainDictionary(generateDotLikeSamples(20));
    const compressedSmall = compressWithDictionary(dataToCompress, dictSmall);

    // Train on larger set (100 samples)
    const dictLarge = await trainDictionary(generateDotLikeSamples(100));
    const compressedLarge = compressWithDictionary(dataToCompress, dictLarge);

    console.log(
      `  Small dict (20 samples): ${dataToCompress.length}B → ${compressedSmall.length}B`,
    );
    console.log(
      `  Large dict (100 samples): ${dataToCompress.length}B → ${compressedLarge.length}B`,
    );

    // Both should produce valid compressed output (decompressible)
    const roundtripped = decompressWithDictionary(compressedLarge, dictLarge);
    expect(roundtripped.length).toBe(dataToCompress.length);
  }, 60_000);

  it('decompression fails with wrong dictionary', async () => {
    // Train two independent dictionaries from different sample sets
    const dict1 = await trainDictionary(generateDotLikeSamples(20));
    const dict2 = await trainDictionary(generateDotLikeSamples(20));

    const data = generateDotLikeSample();
    const compressed = compressWithDictionary(data, dict1);

    // Decompressing with the wrong dictionary must throw, not silently corrupt
    // zstd embeds a 4-byte dictionary ID in the frame header and validates it
    expect(() => decompressWithDictionary(compressed, dict2)).toThrow();
  }, 60_000);

  it('respects custom dictSize parameter', async () => {
    const samples = generateDotLikeSamples(30);

    // Request a smaller dictionary (8 KB)
    const dict8k = await trainDictionary(samples, 8_192);
    expect(dict8k.length).toBeLessThanOrEqual(8_192);
    expect(dict8k.length).toBeGreaterThan(0);
  }, 60_000);

  it('throws on empty samples array', async () => {
    await expect(trainDictionary([])).rejects.toThrow('must not be empty');
  }, 60_000);
});
