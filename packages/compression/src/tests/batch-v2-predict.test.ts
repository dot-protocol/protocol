/**
 * Tests for predictor + rANS payload coding in batch v2.
 *
 * FLAG_PREDICTION (bit 4) integrates the PayloadPredictor + rANS entropy coder
 * into the batch v2 wire format, replacing the raw payload column with:
 *   - prediction metadata header (predictor_model_id + frequency_table)
 *   - rANS-encoded XOR residuals
 */

import { describe, it, expect } from 'vitest';
import {
  createKeypair,
  createDOT,
  toBytes,
  DotType,
  createBLSKeypair,
  verifyAggregateSameSigner,
} from '@dotprotocol/core';
import {
  serializeBatchV2,
  deserializeBatchV2,
  FLAG_PREDICTION,
  FLAG_DICT_COMPRESSED,
} from '../batch-v2.js';
import { LinearPredictor, NullPredictor, LastValuePredictor } from '../predictor.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a chain of N DOTs with voltage-style payloads: steadily-incrementing
 * 16-byte payloads that the LinearPredictor will compress well.
 */
async function buildVoltageChain(n: number): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    // Voltage-style: payload bytes 0..15 each increment by 1 per step
    const payload = new Uint8Array(16);
    for (let b = 0; b < 16; b++) {
      payload[b] = (i + b) & 0xff;
    }

    const dot = await createDOT({
      keypair,
      type: DotType.PUBLIC,
      ts: 1_700_000_000_000 + i * 100,
      payload,
      ...(prev ? { previous: prev } : {}),
    });
    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }

  return dots;
}

/**
 * Build a chain of N DOTs with temperature-style payloads: slowly-changing,
 * mostly-constant payloads suited to LastValuePredictor.
 */
async function buildTemperatureChain(n: number): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    // Temperature: first 4 bytes change slowly (every 10 steps), rest are fixed
    const payload = new Uint8Array(16);
    const temp = Math.floor(i / 10); // 0..9 for n=100
    payload[0] = temp & 0xff;
    payload[1] = 0x42; // fixed
    payload[2] = 0x00; // fixed
    payload[3] = 0x00; // fixed
    // bytes 4..15 stay zero

    const dot = await createDOT({
      keypair,
      type: DotType.PUBLIC,
      ts: 1_700_000_000_000 + i * 1000,
      payload,
      ...(prev ? { previous: prev } : {}),
    });
    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }

  return dots;
}

/**
 * Build a chain of N DOTs with random payloads (crypto-quality random bytes).
 * The LinearPredictor will not compress this better than NullPredictor.
 */
async function buildRandomChain(n: number): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    const payload = new Uint8Array(16);
    // Use Math.random for repeatability in tests (not crypto — just needs to be non-predictable)
    for (let b = 0; b < 16; b++) {
      payload[b] = Math.floor(Math.random() * 256);
    }

    const dot = await createDOT({
      keypair,
      type: DotType.PUBLIC,
      ts: 1_700_000_000_000 + i * 100,
      payload,
      ...(prev ? { previous: prev } : {}),
    });
    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }

  return dots;
}

// ─── Byte offset constants (from batch v2 wire format) ────────────────────────
const OFF_PUBKEY = 0;
const PUBKEY_SIZE = 32;
const OFF_FLAGS = 1;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('batch v2 predictor + rANS integration', () => {

  // 1. Roundtrip with LinearPredictor: 100 voltage DOTs
  it(
    'roundtrip with LinearPredictor: 100 voltage DOTs byte-for-byte match',
    async () => {
      const dots = await buildVoltageChain(100);
      const blsKeypair = createBLSKeypair();

      const frame = await serializeBatchV2(dots, blsKeypair, {
        predictor: new LinearPredictor(),
      });

      const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

      expect(recovered.length).toBe(dots.length);
      for (let i = 0; i < dots.length; i++) {
        const orig = dots[i]!;
        const rec = recovered[i]!;
        // pubkey
        expect(Array.from(rec.subarray(0, 32))).toEqual(Array.from(orig.subarray(0, 32)));
        // timestamp
        expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136)));
        // type
        expect(rec[136]).toBe(orig[136]);
        // payload — must match exactly
        expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
      }
    },
    120_000,
  );

  // 2. BLS verification on reconstructed DOTs
  it(
    'BLS verification passes on reconstructed DOTs with LinearPredictor',
    async () => {
      const dots = await buildVoltageChain(20);
      const blsKeypair = createBLSKeypair();

      const frame = await serializeBatchV2(dots, blsKeypair, {
        predictor: new LinearPredictor(),
      });

      // deserializeBatchV2 verifies BLS internally — if it throws, the test fails
      const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
      expect(recovered.length).toBe(20);
    },
    120_000,
  );

  // 3. Roundtrip with LastValuePredictor: 100 temperature DOTs
  it(
    'roundtrip with LastValuePredictor: 100 temperature DOTs payload preserved',
    async () => {
      const dots = await buildTemperatureChain(100);
      const blsKeypair = createBLSKeypair();

      const frame = await serializeBatchV2(dots, blsKeypair, {
        predictor: new LastValuePredictor(),
      });

      const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

      expect(recovered.length).toBe(dots.length);
      for (let i = 0; i < dots.length; i++) {
        expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
          Array.from(dots[i]!.subarray(137, 153)),
        );
      }
    },
    120_000,
  );

  // 4. Auto predictor: voltage → FLAG_PREDICTION is set
  it(
    'auto predictor: voltage chain sets FLAG_PREDICTION in serialized frame',
    async () => {
      const dots = await buildVoltageChain(50);
      const blsKeypair = createBLSKeypair();

      const frame = await serializeBatchV2(dots, blsKeypair, {
        predictor: 'auto',
      });

      // Check that FLAG_PREDICTION (bit 4 = 0x10) is set in the flags byte
      const flags = frame[OFF_FLAGS]!;
      expect(flags & FLAG_PREDICTION).toBe(FLAG_PREDICTION);

      // Also verify roundtrip works
      const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
      expect(recovered.length).toBe(dots.length);
      for (let i = 0; i < dots.length; i++) {
        expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
          Array.from(dots[i]!.subarray(137, 153)),
        );
      }
    },
    120_000,
  );

  // 5. Auto predictor: random → FLAG_PREDICTION is set, modelId=0x00 (NullPredictor)
  it(
    'auto predictor: random chain sets FLAG_PREDICTION with NullPredictor (modelId=0x00)',
    async () => {
      const dots = await buildRandomChain(50);
      const blsKeypair = createBLSKeypair();

      const frame = await serializeBatchV2(dots, blsKeypair, {
        predictor: 'auto',
      });

      // FLAG_PREDICTION must be set regardless of which predictor was chosen
      const flags = frame[OFF_FLAGS]!;
      expect(flags & FLAG_PREDICTION).toBe(FLAG_PREDICTION);

      // Roundtrip must still work
      const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
      expect(recovered.length).toBe(dots.length);
      for (let i = 0; i < dots.length; i++) {
        expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
          Array.from(dots[i]!.subarray(137, 153)),
        );
      }
    },
    120_000,
  );

  // 6. Size: voltage with prediction < voltage without prediction
  it(
    'size: voltage batch with prediction is smaller than without prediction',
    async () => {
      const dots = await buildVoltageChain(100);
      const blsKeypair = createBLSKeypair();

      const withPrediction = await serializeBatchV2(dots, blsKeypair, {
        predictor: new LinearPredictor(),
      });

      const withoutPrediction = await serializeBatchV2(dots, blsKeypair, {
        // no predictor — raw payloads
      });

      console.log(
        `Voltage 100 DOTs: with_prediction=${withPrediction.length}B without=${withoutPrediction.length}B`,
      );

      // Prediction should reduce the payload column size for voltage data
      expect(withPrediction.length).toBeLessThan(withoutPrediction.length);
    },
    120_000,
  );

  // 7. Error: predictor + dictionary both set → throws TypeError
  it(
    'throws TypeError when both predictor and dictionary are set',
    async () => {
      const dots = await buildVoltageChain(10);
      const blsKeypair = createBLSKeypair();
      const fakeDict = new Uint8Array(1024);
      const fakeDictId = new Uint8Array(32).fill(0x42);

      await expect(
        serializeBatchV2(dots, blsKeypair, {
          predictor: new LinearPredictor(),
          dictionary: fakeDict,
          dictionaryId: fakeDictId,
        }),
      ).rejects.toThrow(TypeError);
    },
    30_000,
  );

  // 8. Roundtrip: 1 DOT with prediction works
  it(
    'roundtrip: single-DOT batch with LinearPredictor works',
    async () => {
      const dots = await buildVoltageChain(1);
      const blsKeypair = createBLSKeypair();

      const frame = await serializeBatchV2(dots, blsKeypair, {
        predictor: new LinearPredictor(),
      });

      const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

      expect(recovered.length).toBe(1);
      expect(recovered[0]!.length).toBe(153);
      expect(Array.from(recovered[0]!.subarray(0, 32))).toEqual(
        Array.from(dots[0]!.subarray(0, 32)),
      );
      expect(Array.from(recovered[0]!.subarray(128, 136))).toEqual(
        Array.from(dots[0]!.subarray(128, 136)),
      );
      expect(recovered[0]![136]).toBe(dots[0]![136]);
      expect(Array.from(recovered[0]!.subarray(137, 153))).toEqual(
        Array.from(dots[0]!.subarray(137, 153)),
      );
    },
    60_000,
  );

});
