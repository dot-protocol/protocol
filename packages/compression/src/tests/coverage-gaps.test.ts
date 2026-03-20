/**
 * coverage-gaps.test.ts
 *
 * Targeted tests to reach 100% coverage on:
 *   - rans.ts (line 99-111: over-allocated branch)
 *   - rle.ts (lines 81-84: inner guard — not reachable normally, but verifies edge)
 *   - sample-generator.ts (lines 128-129: timestamp overflow throw)
 *   - timestamp-delta.ts (lines 73-74: count=0; 76-79: buf too short)
 *   - varint.ts (lines 81-82: varint too long; 117-118: signed non-integer)
 *   - zstd.ts (lines 64-68: ENOENT; 95-102: execFileSync throw re-throw)
 *   - dictionary-registry.ts (lines 28-29: odd-length hex in hexToBytes)
 *   - index.ts (entire file: just import to load it)
 *   - batch-v2.ts (error paths not yet hit by existing tests)
 */

import { describe, it, expect, vi } from 'vitest';

// ─── index.ts: import the barrel to register coverage ─────────────────────────

import * as compression from '../index.js';

describe('index.ts barrel export', () => {
  it('exports key symbols from all sub-modules', () => {
    expect(compression.encodeVarint).toBeTypeOf('function');
    expect(compression.encodeTimestampDeltas).toBeTypeOf('function');
    expect(compression.encodePayloadTypes).toBeTypeOf('function');
    expect(compression.serializeBatchV2).toBeTypeOf('function');
    expect(compression.DictionaryRegistry).toBeTypeOf('function');
    expect(compression.generateSensorStream).toBeTypeOf('function');
    expect(compression.NullPredictor).toBeTypeOf('function');
    expect(compression.buildFrequencyTable).toBeTypeOf('function');
    expect(compression.weissmanScore).toBeTypeOf('function');
  });
});

// ─── rans.ts: line 99-111 — over-allocated branch (delta < 0) ─────────────────
// The over-allocated branch fires when the floor allocation exceeds SCALE.
// We can force it by crafting a frequency table where the allocated total
// exceeds 4096 due to Math.max(1, floored) promoting zeros to 1.
// With 256 symbols each floored to at least 1, and very few actual bytes,
// the total after the floor step can be > 4096.

import { buildFrequencyTable, ransEncode, ransDecode } from '../rans.js';

describe('rans.ts — over-allocated branch (lines 99-111)', () => {
  it('handles dataset where initial allocation exceeds SCALE (forces removal loop)', () => {
    // Over-allocation in the LRM step requires many symbols to be bumped from
    // floor=0 to min=1, causing the total to exceed SCALE=4096.
    //
    // With N dominant bytes (0x00) + one each of bytes 1-255:
    //   counts[0] = N+1, counts[x>0] = 2  (after Laplace smoothing)
    //   total = N+1 + 255*2 = N+511
    //   exact[x>0] = 2/(N+511) * 4096  — must be < 1 to trigger floor=0 → clamped to 1
    //   Condition: 2/(N+511) * 4096 < 1  →  N+511 > 8192  →  N > 7681
    //
    // With N=8192:
    //   total = 8703
    //   exact[0] = 8193/8703 * 4096 ≈ 3855.2 → floor 3855
    //   exact[x>0] = 2/8703 * 4096 ≈ 0.941 → floor 0 → clamped to 1
    //   allocated = 3855 + 255 = 4110 > 4096 → over-allocated by 14 → triggers lines 99-111
    const dominant = new Uint8Array(8192).fill(0x00);
    // Add one of each other byte to ensure all 256 symbols get count > 0
    const others = new Uint8Array(255);
    for (let i = 0; i < 255; i++) others[i] = i + 1;
    const data = new Uint8Array(dominant.length + others.length);
    data.set(dominant, 0);
    data.set(others, dominant.length);

    const table = buildFrequencyTable(data);

    // Verify the table is still valid (sums to exactly 4096)
    const total = Array.from(table.freq).reduce((a, b) => a + b, 0);
    expect(total).toBe(4096);
    expect(table.cumFreq[256]).toBe(4096);

    // Verify round-trip still works through this table
    const symbols = new Uint8Array([0x00, 0x01, 0x02, 0x00]);
    const encoded = ransEncode(symbols, table);
    const decoded = ransDecode(encoded, table, symbols.length);
    expect(Array.from(decoded)).toEqual(Array.from(symbols));
  });
});

// ─── timestamp-delta.ts: lines 73-74 (count=0) and 76-79 (buf too short) ─────

import { decodeTimestampDeltas } from '../timestamp-delta.js';

describe('timestamp-delta.ts — edge cases for decodeTimestampDeltas', () => {
  it('count=0 returns empty array immediately (line 73-74)', () => {
    // When count=0, decodeTimestampDeltas returns [] without touching the buffer
    const buf = new Uint8Array(8).fill(0);
    const result = decodeTimestampDeltas(buf, 0);
    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });

  it('buf.length < 8 throws RangeError for count > 0 (lines 76-79)', () => {
    // A 4-byte buffer is too short for even one timestamp (needs 8 bytes)
    const shortBuf = new Uint8Array(4).fill(0);
    expect(() => decodeTimestampDeltas(shortBuf, 1)).toThrow(RangeError);
    expect(() => decodeTimestampDeltas(shortBuf, 1)).toThrow('too short');
  });

  it('empty buffer throws RangeError for count > 0', () => {
    const emptyBuf = new Uint8Array(0);
    expect(() => decodeTimestampDeltas(emptyBuf, 1)).toThrow(RangeError);
  });
});

// ─── varint.ts: lines 81-82 (varint too long) ─────────────────────────────────

import { decodeVarint, encodeSignedVarint } from '../varint.js';

describe('varint.ts — varint too long guard (lines 81-82)', () => {
  it('throws RangeError when varint exceeds 8 continuation bytes', () => {
    // Craft a fake varint with 8+ continuation bytes (all with MSB=1)
    // This triggers the shift >= 56 guard.
    const tooLong = new Uint8Array(9).fill(0x80); // 9 bytes, all continuation
    tooLong[8] = 0x01; // final byte without continuation
    expect(() => decodeVarint(tooLong, 0)).toThrow(RangeError);
    expect(() => decodeVarint(tooLong, 0)).toThrow('too long');
  });
});

describe('varint.ts — signed non-integer guard (lines 117-118)', () => {
  it('throws RangeError when encodeSignedVarint receives a float', () => {
    expect(() => encodeSignedVarint(1.5)).toThrow(RangeError);
    expect(() => encodeSignedVarint(1.5)).toThrow('finite integer');
  });

  it('throws RangeError when encodeSignedVarint receives Infinity', () => {
    expect(() => encodeSignedVarint(Infinity)).toThrow(RangeError);
  });

  it('throws RangeError when encodeSignedVarint receives NaN', () => {
    expect(() => encodeSignedVarint(NaN)).toThrow(RangeError);
  });
});

// ─── dictionary-registry.ts: lines 28-29 (odd-length hex) ────────────────────
// hexToBytes is private but used via DictionaryRegistry.import().
// Inject invalid hex via JSON with an odd-length dictionary hex string.

import { DictionaryRegistry } from '../dictionary-registry.js';

describe('DictionaryRegistry — hexToBytes odd-length hex (lines 28-29)', () => {
  it('import throws RangeError when dictionary hex has odd length', () => {
    // Build a valid JSON array but with an odd-length hex string in dictionary field
    const badJson = JSON.stringify([
      {
        id: 'aabbcc' + 'dd'.repeat(13), // 32 bytes = 64 hex chars
        dictionary: 'abc', // odd-length hex → should throw
        domain: 'test',
        created: '1700000000000',
      },
    ]);
    expect(() => DictionaryRegistry.import(badJson)).toThrow(RangeError);
    expect(() => DictionaryRegistry.import(badJson)).toThrow('odd-length');
  });
});

// ─── sample-generator.ts: lines 128-129 (timestamp > MAX_SAFE_INTEGER) ────────
// generateSensorStream throws if ts > Number.MAX_SAFE_INTEGER.
// We need to trigger the internal timestamp conversion guard.

import { generateSensorStream } from '../sample-generator.js';

describe('sample-generator.ts — timestamp overflow guard (lines 128-129)', () => {
  it('throws RangeError when startTimestamp exceeds MAX_SAFE_INTEGER', async () => {
    // The overflow guard fires when ts > BigInt(Number.MAX_SAFE_INTEGER).
    // The random profile adds a spread BigInt per step — but even the first DOT
    // uses randomAccumTs = baseTs + spread. With kulhadVoltage, ts = baseTs + i*100.
    // So if startTimestamp itself is safe but the jitter pushes it over:
    // MAX_SAFE_INTEGER = 9007199254740991
    // We need ts to exceed this. Use a base just below max + large offset.
    const tooLargeBase = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await expect(
      generateSensorStream({ count: 1, profile: 'kulhadVoltage', startTimestamp: tooLargeBase }),
    ).rejects.toThrow(RangeError);
  });
});

// ─── zstd.ts: lines 64-68 (ENOENT) and 95-102 (re-throw non-ENOENT) ──────────
// trainDictionary shells out to the zstd CLI.
// These error paths are covered via the actual zstd.test.ts suite which runs
// real CLI calls. Here we cover the warning path by running with < 10 samples.
//
// NOTE: execFileSync from node:child_process has non-configurable properties
// in the ESM runtime, preventing vi.spyOn. We cover lines via actual runs.

import { trainDictionary } from '../zstd.js';

describe('zstd.ts — warning path (fewer than 10 samples)', () => {
  it('emits console.warn when fewer than 10 samples are provided', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Use 3 samples — will trigger warning and then attempt the real zstd CLI.
    // If zstd is installed, training will succeed (or fail with real zstd error).
    // If zstd is not installed, it will throw the ENOENT path.
    // Either way, the warning must fire FIRST.
    const fewSamples = Array.from({ length: 3 }, (_, i) =>
      new Uint8Array(200).fill(i + 1)
    );
    try {
      await trainDictionary(fewSamples);
    } catch {
      // expected — either ENOENT or zstd training failure
    }
    // Assert BEFORE mockRestore so vi can still inspect the call count
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('samples provided'));
    warnSpy.mockRestore();
  }, 30_000);
});

// ─── rle.ts: lines 81-84 (dead inner guard) ──────────────────────────────────
// The inner `if (readPos >= buf.length)` at line 80-84 in decodePayloadTypes
// is guarded by the outer `while (readPos < buf.length)` so it can never fire.
// Verify the outer while loop exits cleanly instead.

import { decodePayloadTypes, encodePayloadTypes } from '../rle.js';

describe('rle.ts — boundary and error coverage', () => {
  it('decodes count that matches exactly (no boundary overshoot)', () => {
    const types = new Uint8Array([0x00, 0x00, 0x01, 0x02]);
    const encoded = encodePayloadTypes(types);
    const decoded = decodePayloadTypes(encoded, 4);
    expect(Array.from(decoded)).toEqual(Array.from(types));
  });

  it('throws when decoded count exceeds totalCount (lines 92-95)', () => {
    // Encode 10 types but try to decode only 5 — count mismatch at end
    const types = new Uint8Array(10).fill(0x00);
    const encoded = encodePayloadTypes(types); // encodes as [0x00, varint(10)]
    // Decoding with totalCount=5 will work (RLE decodes 10 but we expect 5 → mismatch)
    expect(() => decodePayloadTypes(encoded, 5)).toThrow(RangeError);
  });

  it('throws on empty types array (encodePayloadTypes line 22-24)', () => {
    expect(() => encodePayloadTypes(new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodePayloadTypes(new Uint8Array(0))).toThrow('must not be empty');
  });

  it('throws when writePos + count > totalCount (lines 92-95 overflow guard)', () => {
    // Craft a buffer where the RLE count overflows totalCount mid-decode
    // [type=0x00, count_varint=50] but totalCount=10 → overflow at fill
    const encoded = new Uint8Array([0x00, 50]); // type=0, count=50 (1-byte varint)
    expect(() => decodePayloadTypes(encoded, 10)).toThrow(RangeError);
    expect(() => decodePayloadTypes(encoded, 10)).toThrow('decoded count exceeds totalCount');
  });

  it('throws count mismatch when RLE ends early (lines 101-104)', () => {
    // Encode a buffer that has fewer types than totalCount expects
    const types = new Uint8Array([0x00, 0x01]); // 2 types
    const encoded = encodePayloadTypes(types);
    // Try to decode 10 from a buffer that only has 2 → mismatch
    expect(() => decodePayloadTypes(encoded, 10)).toThrow(RangeError);
    expect(() => decodePayloadTypes(encoded, 10)).toThrow('count mismatch');
  });
});

// ─── batch-v2.ts: uncovered error/alternate paths ────────────────────────────

import {
  serializeBatchV2,
  deserializeBatchV2,
  FLAG_PREDICTION,
  FLAG_DICT_COMPRESSED,
} from '../batch-v2.js';
import {
  createKeypair,
  createDOT,
  toBytes,
  DotType,
  createBLSKeypair,
} from '@dotprotocol/core';
import { LinearPredictor, NullPredictor, LastValuePredictor } from '../predictor.js';

async function buildTestChain(n: number, tsStart = 1_700_000_000_000): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    const dot = await createDOT({
      keypair,
      type: DotType.PUBLIC,
      ts: tsStart + i * 100,
      ...(prev ? { previous: prev } : {}),
    });
    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }
  return dots;
}

describe('batch-v2.ts — validation error paths', () => {
  it('throws when dot has wrong size (not 153 bytes)', async () => {
    const blsKeypair = createBLSKeypair();
    const badDot = new Uint8Array(100); // not 153 bytes
    await expect(serializeBatchV2([badDot], blsKeypair)).rejects.toThrow(RangeError);
    await expect(serializeBatchV2([badDot], blsKeypair)).rejects.toThrow('153');
  });

  it('throws when dots have different pubkeys', async () => {
    const blsKeypair = createBLSKeypair();
    const kp1 = await createKeypair();
    const kp2 = await createKeypair();
    const dot1 = toBytes(await createDOT({ keypair: kp1, type: DotType.PUBLIC, ts: 1_700_000_000_000 }));
    const dot2 = toBytes(await createDOT({ keypair: kp2, type: DotType.PUBLIC, ts: 1_700_000_000_001 }));
    await expect(serializeBatchV2([dot1, dot2], blsKeypair)).rejects.toThrow('different pubkey');
  });

  it('throws when dictionary provided without dictionaryId', async () => {
    const dots = await buildTestChain(2);
    const blsKeypair = createBLSKeypair();
    const dict = new Uint8Array(100).fill(0xab);
    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionary: dict })
    ).rejects.toThrow(TypeError);
    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionary: dict })
    ).rejects.toThrow('dictionaryId');
  });

  it('throws when dictionaryId provided without dictionary', async () => {
    const dots = await buildTestChain(2);
    const blsKeypair = createBLSKeypair();
    const dictId = new Uint8Array(32).fill(0x01);
    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionaryId: dictId })
    ).rejects.toThrow(TypeError);
    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionaryId: dictId })
    ).rejects.toThrow('dictionary');
  });

  it('throws when predictor and dictionary are both provided', async () => {
    const dots = await buildTestChain(2);
    const blsKeypair = createBLSKeypair();
    const dict = new Uint8Array(100).fill(0xab);
    const dictId = new Uint8Array(32).fill(0x01);
    await expect(
      serializeBatchV2(dots, blsKeypair, {
        predictor: new LinearPredictor(),
        dictionary: dict,
        dictionaryId: dictId,
      })
    ).rejects.toThrow(TypeError);
    await expect(
      serializeBatchV2(dots, blsKeypair, {
        predictor: new LinearPredictor(),
        dictionary: dict,
        dictionaryId: dictId,
      })
    ).rejects.toThrow('mutually exclusive');
  });

  it('throws when dictionaryId has wrong length (not 32 bytes)', async () => {
    const dots = await buildTestChain(2);
    const blsKeypair = createBLSKeypair();
    const dict = new Uint8Array(100).fill(0xab);
    const badDictId = new Uint8Array(16).fill(0x01); // wrong length
    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionary: dict, dictionaryId: badDictId })
    ).rejects.toThrow(RangeError);
    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionary: dict, dictionaryId: badDictId })
    ).rejects.toThrow('32 bytes');
  });
});

describe('batch-v2.ts — deserializeBatchV2 error paths', () => {
  it('throws RangeError when buffer is shorter than header (86 bytes)', async () => {
    const blsKeypair = createBLSKeypair();
    const shortBuf = new Uint8Array(50);
    await expect(deserializeBatchV2(shortBuf, blsKeypair.publicKey)).rejects.toThrow(RangeError);
  });

  it('throws RangeError when dot_count is 0 in frame', async () => {
    const blsKeypair = createBLSKeypair();
    // Build a minimal 86-byte frame with version=0x03, dot_count=0
    const buf = new Uint8Array(86);
    buf[0] = 0x03; // version
    buf[1] = 0x00; // flags (no delta, no RLE)
    // dot_count at [2..5] = 0 (already 0)
    await expect(deserializeBatchV2(buf, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(buf, blsKeypair.publicKey)).rejects.toThrow('dot_count is 0');
  });

  it('throws buffer too short for dict header (FLAG_DICT_COMPRESSED but buf < 118B, line 555-558)', async () => {
    // Create a 100-byte frame with FLAG_DICT_COMPRESSED set → buf.length < 118 → line 555
    const blsKeypair = createBLSKeypair();
    const buf = new Uint8Array(100);
    buf[0] = 0x03; // version
    buf[1] = FLAG_DICT_COMPRESSED; // flag set
    const view = new DataView(buf.buffer);
    view.setUint32(2, 1, true); // dot_count = 1
    await expect(deserializeBatchV2(buf, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(buf, blsKeypair.publicKey)).rejects.toThrow('buffer too short for dict header');
  }, 15_000);

  it('throws buffer too short for prediction metadata (hasPrediction but body < 513B, line 604-607)', async () => {
    // Create a minimal frame (86 bytes + a few body bytes) with FLAG_PREDICTION set
    // bodyBuf.length = frame.length - 86 = few bytes < 513 → line 604
    const blsKeypair = createBLSKeypair();
    const buf = new Uint8Array(100); // 86 header + 14 body bytes (< 513)
    buf[0] = 0x03; // version
    buf[1] = FLAG_PREDICTION; // flag set, no dict
    const view = new DataView(buf.buffer);
    view.setUint32(2, 1, true); // dot_count = 1
    await expect(deserializeBatchV2(buf, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(buf, blsKeypair.publicKey)).rejects.toThrow('buffer too short for prediction metadata');
  }, 15_000);

  it('throws buffer too short for raw timestamps (no-delta path, line 649-650)', async () => {
    // no-delta, no-RLE, 1 DOT: body normally = 8+1+16 = 25B.
    // Truncate body to 4 bytes → bodyCursor+tsColumnSize = 8 > 4 → line 649.
    const dots = await buildTestChain(1);
    const blsKeypair = createBLSKeypair();
    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: false,
      payloadTypeRLE: false,
    });
    const truncated = frame.slice(0, 86 + 4); // only 4 body bytes, need 8 for ts
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow('buffer too short for raw timestamps');
  }, 15_000);

  it('throws buffer too short for RLE types + rANS data (prediction+RLE path, line 680-681)', async () => {
    // RLE+ts-delta+prediction, 1 DOT: last 4 bytes = ransEncodedLen.
    // To get rleEnd <= tsEnd: set ransEncodedLen = bodyBuf.length - 4 - tsEnd + 1
    // which makes rleEnd = tsEnd - 1 <= tsEnd.
    const dots = await buildTestChain(1);
    const blsKeypair = createBLSKeypair();
    const frame = await serializeBatchV2(dots, blsKeypair, {
      predictor: new NullPredictor(),
      timestampDelta: true,
      payloadTypeRLE: true,
    });

    // Read actual ts column size. For 1 DOT with ts-delta, tsColumnSize = 8 (anchor only).
    // tsEnd = 0 + PREDICTION_META_SIZE + 8 bytes... actually let's just corrupt ransEncodedLen
    // to the max possible value: bodyBuf.length - 4 (=> rleEnd = 0 <= tsEnd).
    const tampered = frame.slice();
    const view = new DataView(tampered.buffer);
    // bodyBuf.length = frame.length - 86 - PREDICTION_META_SIZE(513)
    // But we can compute it: set ransEncodedLen = (frame.length - 86 - 513) which makes rleEnd = 0
    const bodyLen = frame.length - 86 - 513; // 513 = prediction meta size
    const ransEncodedLen = bodyLen - 4; // makes rleEnd = bodyLen - 4 - (bodyLen-4) = 0 <= tsEnd
    view.setUint32(tampered.length - 4, ransEncodedLen, true);

    await expect(deserializeBatchV2(tampered, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(tampered, blsKeypair.publicKey)).rejects.toThrow('buffer too short for RLE types + rANS data');
  }, 15_000);

  it('throws buffer too short for raw types (line 698-699)', async () => {
    // no-RLE, no-delta, 1 DOT: normal body = 8(ts)+1(type)+16(payload) = 25B
    // Truncate to 86+8 bytes → bodyBuf.length=8, tsEnd=8, tsEnd+dotCount=9 > 8 → line 698
    const dots = await buildTestChain(1);
    const blsKeypair = createBLSKeypair();
    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: false,
      payloadTypeRLE: false,
    });
    const truncated = frame.slice(0, 86 + 8); // just the ts column, no type or payload
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow('buffer too short for raw types');
  }, 15_000);

  it('throws buffer too short for RLE types + payloads, no-prediction (line 689-690)', async () => {
    // RLE+ts-delta, 1 DOT, no-prediction: rleEnd = bodyBuf.length - 16
    // Need rleEnd <= tsEnd. With ts-delta for 1 DOT, tsColumnSize=8, tsEnd=8.
    // If bodyBuf.length = 24, rleEnd = 24-16 = 8 <= 8 → throws at line 689.
    const dots = await buildTestChain(1);
    const blsKeypair = createBLSKeypair();
    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
    });
    // Truncate to 86+24=110 bytes so body=24 bytes → rleEnd=8 <= tsEnd=8 → line 689
    const truncated = frame.slice(0, 86 + 24);
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow('buffer too short for RLE types + payloads');
  }, 15_000);

  it('throws when buffer is too short for raw payloads (no-delta, no-RLE, no-prediction) — line 739-740', async () => {
    // Serialize 1 DOT with no-delta, no-RLE, no-prediction
    const dots = await buildTestChain(1);
    const blsKeypair = createBLSKeypair();
    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: false,
      payloadTypeRLE: false,
    });

    // Frame body: 8B (raw ts) + 1B (raw type) + 16B (payload) = 25B
    // Truncate to remove last 16B (payload) → typesEnd+payloadsTotalSize > body.length
    const truncated = frame.slice(0, frame.length - 16);
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(truncated, blsKeypair.publicKey)).rejects.toThrow('buffer too short for payloads');
  }, 15_000);

  it('throws when rANS data length mismatches (prediction + no-RLE path, line 720-723)', async () => {
    // Serialize with prediction + no-RLE so the frame uses raw types.
    // With raw types: typesEnd is independent of ransLen (read from last 4 bytes).
    // Corrupting ransLen to a different value → ransEnd - ransStart !== ransLen → line 720-723.
    const dots = await buildTestChain(3);
    const blsKeypair = createBLSKeypair();
    const frame = await serializeBatchV2(dots, blsKeypair, {
      predictor: new NullPredictor(),
      payloadTypeRLE: false, // raw types so typesEnd is independent of ransLen
    });

    // Read the actual ransLen from the last 4 bytes, then change to ransLen + 1
    const tampered = frame.slice();
    const view = new DataView(tampered.buffer);
    const actualRansLen = view.getUint32(tampered.length - 4, true);
    // Set to actualRansLen + 1 → mismatch without affecting rleEnd (no RLE)
    view.setUint32(tampered.length - 4, actualRansLen + 1, true);

    await expect(deserializeBatchV2(tampered, blsKeypair.publicKey)).rejects.toThrow(RangeError);
    await expect(deserializeBatchV2(tampered, blsKeypair.publicKey)).rejects.toThrow('rANS data length mismatch');
  }, 15_000);

  it('throws on unknown predictor modelId during deserialization', async () => {
    const dots = await buildTestChain(3);
    const blsKeypair = createBLSKeypair();

    // Serialize with NullPredictor (modelId=0)
    const frame = await serializeBatchV2(dots, blsKeypair, {
      predictor: new NullPredictor(),
    });

    // Corrupt the modelId byte — it's right after the 86-byte header
    // at position 86 (first byte of prediction metadata = modelId)
    const tampered = frame.slice();
    tampered[86] = 0xFF; // unknown modelId

    await expect(deserializeBatchV2(tampered, blsKeypair.publicKey)).rejects.toThrow(
      'unknown predictor modelId'
    );
  }, 30_000);
});

describe('batch-v2.ts — predictor roundtrip with all three models', () => {
  it('NullPredictor (modelId=0x00) roundtrips', async () => {
    const dots = await buildTestChain(5);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      predictor: new NullPredictor(),
    });
    expect(frame[1]! & FLAG_PREDICTION).toBeTruthy();

    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
    expect(recovered).toHaveLength(dots.length);
    for (let i = 0; i < dots.length; i++) {
      expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
        Array.from(dots[i]!.subarray(137, 153)),
      );
    }
  }, 30_000);

  it('LastValuePredictor (modelId=0x01) roundtrips', async () => {
    const dots = await buildTestChain(5);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      predictor: new LastValuePredictor(),
    });
    expect(frame[1]! & FLAG_PREDICTION).toBeTruthy();

    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
    expect(recovered).toHaveLength(dots.length);
    for (let i = 0; i < dots.length; i++) {
      expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
        Array.from(dots[i]!.subarray(137, 153)),
      );
    }
  }, 30_000);

  it('LinearPredictor (modelId=0x02) roundtrips', async () => {
    const dots = await buildTestChain(5);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      predictor: new LinearPredictor(),
    });
    expect(frame[1]! & FLAG_PREDICTION).toBeTruthy();

    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
    expect(recovered).toHaveLength(dots.length);
    for (let i = 0; i < dots.length; i++) {
      expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
        Array.from(dots[i]!.subarray(137, 153)),
      );
    }
  }, 30_000);

  it("'auto' predictor selects the best model and roundtrips", async () => {
    // Use a chain with linearly-changing payloads to bias toward LinearPredictor
    const keypair = await createKeypair();
    const blsKeypair = createBLSKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;

    for (let i = 0; i < 10; i++) {
      const payload = new Uint8Array(16);
      for (let b = 0; b < 16; b++) payload[b] = (i + b) & 0xff;
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

    const frame = await serializeBatchV2(dots, blsKeypair, { predictor: 'auto' });
    expect(frame[1]! & FLAG_PREDICTION).toBeTruthy();

    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
    expect(recovered).toHaveLength(dots.length);
    for (let i = 0; i < dots.length; i++) {
      expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
        Array.from(dots[i]!.subarray(137, 153)),
      );
    }
  }, 30_000);

  it('no-delta + no-RLE + prediction roundtrips', async () => {
    const dots = await buildTestChain(5);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: false,
      payloadTypeRLE: false,
      predictor: new LinearPredictor(),
    });

    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
    expect(recovered).toHaveLength(dots.length);
    for (let i = 0; i < dots.length; i++) {
      expect(Array.from(recovered[i]!.subarray(128, 136))).toEqual(
        Array.from(dots[i]!.subarray(128, 136)),
      );
      expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
        Array.from(dots[i]!.subarray(137, 153)),
      );
    }
  }, 30_000);
});
