/**
 * Sample data generator for @dotprotocol/compression benchmarks and tests.
 *
 * Generates arrays of 153-byte DOT Uint8Arrays for various sensor stream
 * profiles. Produces correlated, realistic data without external dependencies.
 */
import { createKeypair, createDOT, toBytes, DotType } from '@dotprotocol/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SensorProfile = 'kulhadVoltage' | 'temperature' | 'gps' | 'random';

export interface SampleGeneratorOptions {
  /** Number of DOTs to generate. */
  count: number;
  /** Which sensor profile to use. */
  profile: SensorProfile;
  /** Optional Ed25519 keypair. If omitted, a fresh one is generated. */
  keypair?: { publicKey: Uint8Array; privateKey: Uint8Array };
  /** Starting timestamp in Unix ms as bigint. Defaults to Date.now(). */
  startTimestamp?: bigint;
}

// ─── Profile helpers ──────────────────────────────────────────────────────────

/** Write a little-endian float32 into a 16-byte payload at the given offset. */
function writeFloat32LE(payload: Uint8Array, offset: number, value: number): void {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  view.setFloat32(offset, value, true);
}

/** Build payload + ts + type for kulhadVoltage profile (i = index in stream). */
function kulhadVoltagePayload(i: number, baseTs: bigint): { payload: Uint8Array; ts: bigint; type: DotType } {
  const payload = new Uint8Array(16); // bytes [4..15] remain zero
  const voltage = 0.497 + (Math.random() - 0.5) * 0.03; // ±0.015V
  writeFloat32LE(payload, 0, voltage);
  // ~100ms apart, starting at baseTs. Add positive jitter to avoid going before baseTs.
  const jitter = Math.round(Math.random() * 10); // 0..10ms (positive only)
  const ts = baseTs + BigInt(i * 100 + jitter);
  return { payload, ts, type: DotType.PUBLIC };
}

/** Build payload + ts + type for temperature profile. */
function temperaturePayload(i: number, baseTs: bigint): { payload: Uint8Array; ts: bigint; type: DotType } {
  const payload = new Uint8Array(16);
  const temp = 20 + (Math.random() - 0.5) * 4; // 20°C ±2°C
  writeFloat32LE(payload, 0, temp);
  // ~1000ms apart, starting at baseTs. Positive jitter only to stay >= baseTs.
  const jitter = Math.round(Math.random() * 100); // 0..100ms
  const ts = baseTs + BigInt(i * 1000 + jitter);
  return { payload, ts, type: DotType.PUBLIC };
}

/** Build payload + ts + type for GPS profile (near Mumbai). */
function gpsPayload(i: number, baseTs: bigint): { payload: Uint8Array; ts: bigint; type: DotType } {
  const payload = new Uint8Array(16);
  const lat = 19.076 + (Math.random() - 0.5) * 0.02;
  const lon = 72.877 + (Math.random() - 0.5) * 0.02;
  writeFloat32LE(payload, 0, lat);
  writeFloat32LE(payload, 4, lon);
  // ~1000ms apart, starting at baseTs. Positive jitter only.
  const jitter = Math.round(Math.random() * 200); // 0..200ms
  const ts = baseTs + BigInt(i * 1000 + jitter);
  return { payload, ts, type: DotType.PUBLIC };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an array of `count` properly-signed 153-byte DOT Uint8Arrays
 * according to the given sensor profile. DOTs form a valid chain (each DOT's
 * chain hash = SHA-256 of previous DOT bytes; genesis chain hash = 32 zeros).
 */
export async function generateSensorStream(
  options: SampleGeneratorOptions
): Promise<Uint8Array[]> {
  const { count, profile } = options;
  const keypair = options.keypair ?? (await createKeypair());
  const baseTs = options.startTimestamp ?? BigInt(Date.now());

  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;
  // For random profile we track accumulated offset to ensure monotonic ts
  let randomAccumTs = baseTs;

  for (let i = 0; i < count; i++) {
    let payload: Uint8Array;
    let ts: bigint;
    let type: DotType;

    switch (profile) {
      case 'kulhadVoltage': {
        const r = kulhadVoltagePayload(i, baseTs);
        payload = r.payload; ts = r.ts; type = r.type;
        break;
      }
      case 'temperature': {
        const r = temperaturePayload(i, baseTs);
        payload = r.payload; ts = r.ts; type = r.type;
        break;
      }
      case 'gps': {
        const r = gpsPayload(i, baseTs);
        payload = r.payload; ts = r.ts; type = r.type;
        break;
      }
      case 'random':
      default: {
        // Spread over 24h but keep monotonically increasing
        const spread = BigInt(Math.round((Math.random() + 0.5) * ((24 * 60 * 60 * 1000) / count)));
        randomAccumTs = randomAccumTs + spread;
        const rPay = new Uint8Array(16);
        crypto.getRandomValues(rPay);
        payload = rPay;
        ts = randomAccumTs;
        const VALID_TYPES: DotType[] = [DotType.PUBLIC, DotType.CIRCLE, DotType.PRIVATE, DotType.EPHEMERAL];
        type = VALID_TYPES[Math.floor(Math.random() * VALID_TYPES.length)]!;
        break;
      }
    }

    const dot = await createDOT({
      keypair,
      payload,
      type,
      ts: (() => {
        if (ts > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError(`Timestamp ${ts} exceeds Number.MAX_SAFE_INTEGER — cannot convert without precision loss`);
        }
        return Number(ts);
      })(),
      ...(prev ? { previous: prev } : {}),
    });

    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }

  return dots;
}

/**
 * Generate raw payload columns (16B each) suitable for zstd dictionary training.
 * Extracts the payload slice from each DOT (bytes [137..152]).
 */
export async function generateTrainingSamples(
  profile: SensorProfile,
  count: number = 100
): Promise<Uint8Array[]> {
  const dots = await generateSensorStream({ count, profile });
  return dots.map(dot => dot.slice(137, 153));
}
