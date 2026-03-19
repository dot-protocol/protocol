import { describe, it, expect } from 'vitest';
import { generateSensorStream, generateTrainingSamples, SensorProfile } from '../sample-generator.js';

const PROFILES: SensorProfile[] = ['kulhadVoltage', 'temperature', 'gps', 'random'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFloat32LE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return view.getFloat32(offset, true);
}

function sha256(data: Uint8Array): Promise<Uint8Array> {
  return crypto.subtle.digest('SHA-256', data).then(b => new Uint8Array(b));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateSensorStream', () => {
  it('all profiles produce arrays of 153-byte DOTs', async () => {
    for (const profile of PROFILES) {
      const dots = await generateSensorStream({ count: 10, profile });
      expect(dots).toHaveLength(10);
      for (const dot of dots) {
        expect(dot).toBeInstanceOf(Uint8Array);
        expect(dot.byteLength).toBe(153);
      }
    }
  });

  it('chain hash of dot[0] is 32 zero bytes (genesis)', async () => {
    const dots = await generateSensorStream({ count: 5, profile: 'kulhadVoltage' });
    const chainHash0 = dots[0].slice(96, 128);
    expect(chainHash0.every(b => b === 0)).toBe(true);
  });

  it('chain hash of dot[1] equals SHA-256(dot[0])', async () => {
    const dots = await generateSensorStream({ count: 5, profile: 'kulhadVoltage' });
    const expected = await sha256(dots[0]);
    const actual = dots[1].slice(96, 128);
    expect(actual).toEqual(expected);
  });

  it('timestamps are monotonically increasing within a stream', async () => {
    for (const profile of PROFILES) {
      const dots = await generateSensorStream({ count: 10, profile });
      let prevTs = 0n;
      for (const dot of dots) {
        const view = new DataView(dot.buffer, dot.byteOffset, dot.byteLength);
        const ts = view.getBigUint64(128, false);
        expect(ts).toBeGreaterThan(prevTs);
        prevTs = ts;
      }
    }
  });

  it('kulhadVoltage payloads are correlated — float32 values within 0.1V of each other', async () => {
    const dots = await generateSensorStream({ count: 20, profile: 'kulhadVoltage' });
    const values = dots.map(d => readFloat32LE(d, 137));
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeLessThan(0.1);
    // all near 0.497V
    for (const v of values) {
      expect(Math.abs(v - 0.497)).toBeLessThan(0.05);
    }
  });

  it('temperature payloads are correlated — float32 values within 5°C of each other', async () => {
    const dots = await generateSensorStream({ count: 20, profile: 'temperature' });
    const values = dots.map(d => readFloat32LE(d, 137));
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeLessThan(5);
    // all near 20°C
    for (const v of values) {
      expect(Math.abs(v - 20)).toBeLessThan(3);
    }
  });

  it('GPS payloads stay near Mumbai — lat ±0.5° and lon ±0.5°', async () => {
    const dots = await generateSensorStream({ count: 20, profile: 'gps' });
    for (const dot of dots) {
      const lat = readFloat32LE(dot, 137);
      const lon = readFloat32LE(dot, 141);
      expect(Math.abs(lat - 19.076)).toBeLessThan(0.5);
      expect(Math.abs(lon - 72.877)).toBeLessThan(0.5);
    }
  });

  it('random profile has entropy — not all payloads identical', async () => {
    const dots = await generateSensorStream({ count: 10, profile: 'random' });
    const payloads = dots.map(d => Array.from(d.slice(137, 153)).join(','));
    const unique = new Set(payloads);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('accepts custom keypair and uses it', async () => {
    const { createKeypair } = await import('@dot-protocol/core');
    const keypair = await createKeypair();
    const dots = await generateSensorStream({ count: 5, profile: 'temperature', keypair });
    // Public key at [0..31] should match the provided keypair
    for (const dot of dots) {
      expect(dot.slice(0, 32)).toEqual(keypair.publicKey);
    }
  });

  it('respects startTimestamp option', async () => {
    const startTs = 1_700_000_000_000n;
    const dots = await generateSensorStream({ count: 3, profile: 'temperature', startTimestamp: startTs });
    const view = new DataView(dots[0].buffer, dots[0].byteOffset, dots[0].byteLength);
    const ts0 = view.getBigUint64(128, false);
    expect(ts0).toBeGreaterThanOrEqual(startTs);
  });
});

describe('generateTrainingSamples', () => {
  it('returns arrays of Uint8Array(16) with correct count', async () => {
    const samples = await generateTrainingSamples('kulhadVoltage', 50);
    expect(samples).toHaveLength(50);
    for (const s of samples) {
      expect(s).toBeInstanceOf(Uint8Array);
      expect(s.byteLength).toBe(16);
    }
  });

  it('defaults to 100 samples when count omitted', async () => {
    const samples = await generateTrainingSamples('temperature');
    expect(samples).toHaveLength(100);
  });

  it('extracts payload bytes (not full DOT)', async () => {
    const samples = await generateTrainingSamples('kulhadVoltage', 10);
    // Each sample should be exactly 16 bytes — payload column only
    for (const s of samples) {
      expect(s.byteLength).toBe(16);
    }
  });
});
