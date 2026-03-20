/**
 * batch-v2-dict.test.ts
 *
 * Tests for Task 2.3 — dictionary compression integration in batch v2.
 *
 * Wire format when FLAG_DICT_COMPRESSED (bit 3) is set:
 *   HEADER (118B): version(1) + flags(1) + count(4) + pubkey(32) + aggSig(48) + dictId(32)
 *   BODY: zstd-compressed column body
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
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
  FLAG_DICT_COMPRESSED,
} from '../batch-v2.js';
import { trainDictionary } from '../zstd.js';
import { DictionaryRegistry } from '../dictionary-registry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute SHA-256 of bytes (sync, via node:crypto). */
function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/**
 * Build a chain of N voltage-sensor DOTs.
 * Payload: float64 (big-endian) at bytes [0..7], rest zero.
 * Produces correlated data, ideal for demonstrating dictionary compression.
 */
async function buildVoltageChain(n: number): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    const payload = new Uint8Array(16);
    new DataView(payload.buffer).setFloat64(0, 0.497 + i * 0.0001, false);
    const dot = await createDOT({
      keypair,
      type: DotType.PUBLIC,
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
 * Generate training samples: 50 batches of 20 DOTs each.
 * Returns the raw body bytes (timestamps + types + payloads as serialized by batch v2
 * but WITHOUT dictionary compression — just the plain column-encoded body).
 *
 * We do this by serializing without dictionary and slicing off the 86-byte header.
 */
async function generateTrainingSamples(): Promise<Uint8Array[]> {
  const samples: Uint8Array[] = [];
  const blsKeypair = createBLSKeypair();

  for (let b = 0; b < 50; b++) {
    const dots = await buildVoltageChain(20);
    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
    });
    // Slice off the 86-byte header to get the raw body
    samples.push(frame.slice(86));
  }

  return samples;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('batch v2 dictionary compression', () => {

  // 1. Roundtrip with dictionary: 100 DOTs → serialize with dict → deserialize → all match
  it('roundtrip with dictionary: 100 DOTs fully match after serialize/deserialize', async () => {
    const dots = await buildVoltageChain(100);
    const blsKeypair = createBLSKeypair();

    // Train dictionary from 50×20-DOT samples
    const samples = await generateTrainingSamples();
    const dictionary = await trainDictionary(samples);
    const dictionaryId = sha256(dictionary);

    // Serialize with dictionary
    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
      dictionary,
      dictionaryId,
    });

    // Verify FLAG_DICT_COMPRESSED is set in the frame
    expect(frame[1]! & FLAG_DICT_COMPRESSED).toBe(FLAG_DICT_COMPRESSED);
    // Header is 118B when dict flag is set
    expect(frame.length).toBeGreaterThanOrEqual(118);

    // Register dictionary and deserialize
    const registry = new DictionaryRegistry();
    await registry.register(dictionary, 'voltage-sensor-v1');
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey, registry);

    expect(recovered.length).toBe(dots.length);

    for (let i = 0; i < dots.length; i++) {
      const orig = dots[i]!;
      const rec = recovered[i]!;

      expect(rec.length).toBe(153);

      // pubkey [0..31]
      expect(Array.from(rec.subarray(0, 32))).toEqual(Array.from(orig.subarray(0, 32)));
      // timestamp [128..135]
      expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136)));
      // type [136]
      expect(rec[136]).toBe(orig[136]);
      // payload [137..152]
      expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
    }
  }, 120_000);

  // 2. Backward compat: no dictionary flag → existing behavior unchanged
  it('backward compat: no dictionary flag — existing behavior unchanged', async () => {
    const dots = await buildVoltageChain(50);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
      // No dictionary or dictionaryId
    });

    // FLAG_DICT_COMPRESSED must NOT be set
    expect(frame[1]! & FLAG_DICT_COMPRESSED).toBe(0);

    // Deserialize without registry (must succeed)
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);
    expect(recovered.length).toBe(dots.length);

    for (let i = 0; i < dots.length; i++) {
      const orig = dots[i]!;
      const rec = recovered[i]!;
      expect(Array.from(rec.subarray(0, 32))).toEqual(Array.from(orig.subarray(0, 32)));
      expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136)));
      expect(rec[136]).toBe(orig[136]);
      expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
    }
  }, 60_000);

  // 3. Size reduction: dict-compressed batch should be smaller than plain v2
  it('size reduction: dict-compressed batch smaller than uncompressed v2 for 100 correlated DOTs', async () => {
    const blsKeypair = createBLSKeypair();
    const dots = await buildVoltageChain(100);

    // Plain v2 (no dict)
    const plainFrame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
    });

    // Train dictionary
    const samples = await generateTrainingSamples();
    const dictionary = await trainDictionary(samples);
    const dictionaryId = sha256(dictionary);

    // Dict-compressed v2
    const dictFrame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
      dictionary,
      dictionaryId,
    });

    const plainSize = plainFrame.length;
    const dictSize = dictFrame.length;

    console.log(
      `Size comparison (N=100): plain-v2=${plainSize}B  dict-v2=${dictSize}B  ` +
      `savings=${plainSize - dictSize}B (${(((plainSize - dictSize) / plainSize) * 100).toFixed(1)}%)`,
    );

    // Dictionary compression must produce a smaller frame for correlated voltage data
    expect(dictSize).toBeLessThan(plainSize);
  }, 120_000);

  // 4. Error: missing registry on dict-compressed frame
  it('error: missing registry — throws with message including dict id', async () => {
    const dots = await buildVoltageChain(20);
    const blsKeypair = createBLSKeypair();

    const samples = await generateTrainingSamples();
    const dictionary = await trainDictionary(samples);
    const dictionaryId = sha256(dictionary);

    const frame = await serializeBatchV2(dots, blsKeypair, {
      dictionary,
      dictionaryId,
    });

    // Deserialize without passing a registry — must throw with actionable message
    await expect(
      deserializeBatchV2(frame, blsKeypair.publicKey),
      // no registry argument
    ).rejects.toThrow(/no dictionaryRegistry/i);
  }, 120_000);

  // 5a. Error: dictionary provided without dictionaryId
  it('error: dictionary without dictionaryId throws TypeError', async () => {
    const dots = await buildVoltageChain(5);
    const blsKeypair = createBLSKeypair();
    const samples = await generateTrainingSamples();
    const dictionary = await trainDictionary(samples);

    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionary }),
    ).rejects.toThrow(/dictionaryId/i);
  }, 120_000);

  // 5b. Error: dictionaryId provided without dictionary
  it('error: dictionaryId without dictionary throws TypeError', async () => {
    const dots = await buildVoltageChain(5);
    const blsKeypair = createBLSKeypair();
    const dictionaryId = new Uint8Array(32).fill(1);

    await expect(
      serializeBatchV2(dots, blsKeypair, { dictionaryId }),
    ).rejects.toThrow(/dictionary/i);
  }, 120_000);

  // 5. Error: wrong dictionary in registry
  it('error: wrong dictionary in registry — throws with unknown id', async () => {
    const dots = await buildVoltageChain(20);
    const blsKeypair = createBLSKeypair();

    // Train dict1 (used to serialize)
    const samples1 = await generateTrainingSamples();
    const dict1 = await trainDictionary(samples1);
    const dictId1 = sha256(dict1);

    // Train a different dict2 (put in registry instead of dict1)
    const samples2 = await generateTrainingSamples();
    const dict2 = await trainDictionary(samples2);

    const frame = await serializeBatchV2(dots, blsKeypair, {
      dictionary: dict1,
      dictionaryId: dictId1,
    });

    // Registry only has dict2, not dict1
    const registry = new DictionaryRegistry();
    await registry.register(dict2, 'voltage-sensor-wrong');

    await expect(
      deserializeBatchV2(frame, blsKeypair.publicKey, registry),
    ).rejects.toThrow(/unknown dictionary id=/i);
  }, 120_000);

  // 6. BLS verification passes on roundtrip with dictionary
  it('BLS verification passes explicitly on roundtrip with dictionary', async () => {
    const dots = await buildVoltageChain(30);
    const blsKeypair = createBLSKeypair();

    const samples = await generateTrainingSamples();
    const dictionary = await trainDictionary(samples);
    const dictionaryId = sha256(dictionary);

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
      dictionary,
      dictionaryId,
    });

    const registry = new DictionaryRegistry();
    await registry.register(dictionary, 'voltage-sensor-v1');
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey, registry);

    expect(recovered.length).toBe(dots.length);

    // Explicitly reconstruct signedBytes and call verifyAggregateSameSigner
    // This mirrors what the deserializer does internally, making the BLS pass explicit.
    const OFF_PUBKEY = 0;
    const OFF_CHAIN = 96;
    const PUBKEY_SIZE = 32;
    const DOT_SIZE = 153;

    function extractSignedBytes(dot: Uint8Array): Uint8Array {
      const out = new Uint8Array(89);
      out.set(dot.subarray(OFF_PUBKEY, OFF_PUBKEY + PUBKEY_SIZE), 0);
      out.set(dot.subarray(OFF_CHAIN, DOT_SIZE), 32);
      return out;
    }

    // The recovered DOTs have the aggSig in [32..79] (48B zero-padded to 64B).
    // Extract the 48-byte aggSig from the first recovered dot's sig field.
    const aggSig = recovered[0]!.subarray(32, 80); // first 48B of sig field

    const signedMessages = recovered.map(dot => {
      // For verification we need the zeroed-sig form of each dot.
      // The deserializer returns DOTs with aggSig in sig field, but BLS was
      // computed over zeroed-sig DOTs. Reconstruct zeroed-sig form here.
      const zeroed = dot.slice();
      zeroed.fill(0, 32, 96); // zero out sig field [32..95]
      return extractSignedBytes(zeroed);
    });

    const valid = verifyAggregateSameSigner(aggSig, signedMessages, blsKeypair.publicKey);
    expect(valid).toBe(true);
  }, 120_000);

});
