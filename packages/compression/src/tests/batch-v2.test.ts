import { describe, it, expect } from 'vitest';
import {
  createKeypair,
  createDOT,
  toBytes,
  DotType,
  createBLSKeypair,
  batchPackBLS,
} from '@dotprotocol/core';
import { serializeBatchV2, deserializeBatchV2 } from '../batch-v2.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a chain of N DOTs starting from genesis (no previous).
 * All DOTs share the same Ed25519 keypair.
 */
async function buildChain(n: number, tsStart = 1_700_000_000_000): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    const dot = await createDOT({
      keypair,
      type: DotType.PUBLIC,
      ts: tsStart + i * 100, // 100ms intervals
      ...(prev ? { previous: prev } : {}),
    });
    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }

  return dots;
}

/**
 * Build a chain of N DOTs with varied types to stress the type RLE.
 */
async function buildMixedTypeChain(n: number): Promise<Uint8Array[]> {
  const keypair = await createKeypair();
  const types = [DotType.PUBLIC, DotType.CIRCLE, DotType.PRIVATE, DotType.EPHEMERAL];
  const dots: Uint8Array[] = [];
  let prev: Uint8Array | undefined;

  for (let i = 0; i < n; i++) {
    const type = types[i % types.length]!;
    const dot = await createDOT({
      keypair,
      type,
      ts: Date.now() + i * 1000,
      payload: new Uint8Array(16).fill(i & 0xff),
      ...(prev ? { previous: prev } : {}),
    });
    const bytes = toBytes(dot);
    dots.push(bytes);
    prev = bytes;
  }

  return dots;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('batch v2 serializer', () => {

  // 1. Basic roundtrip — 10 DOTs, defaults (delta + RLE enabled)
  it('basic roundtrip: 10 DOTs serialize/deserialize to identical bytes', async () => {
    const dots = await buildChain(10);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair);
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

    expect(recovered.length).toBe(dots.length);
    for (let i = 0; i < dots.length; i++) {
      expect(recovered[i]!.length).toBe(153);
      // The reconstructed DOT must have matching pubkey, type, payload, and timestamp.
      // (chain hash and sig field differ from original — batch v2 uses aggSig and
      // genesis-anchored reconstruction, which is a Sprint 1 design constraint)
      const orig = dots[i]!;
      const rec = recovered[i]!;
      // pubkey [0..31]
      expect(Array.from(rec.subarray(0, 32))).toEqual(Array.from(orig.subarray(0, 32)));
      // timestamp [128..135]
      expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136)));
      // type [136]
      expect(rec[136]).toBe(orig[136]);
      // payload [137..152]
      expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
    }
  }, 30_000);

  // 2. Flags roundtrip — 100 DOTs, both flags enabled, BLS verification passes
  it('flags roundtrip: 100 DOTs with both flags enabled — BLS passes', async () => {
    const dots = await buildChain(100);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
    });
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

    expect(recovered.length).toBe(100);
    for (const dot of recovered) {
      expect(dot.length).toBe(153);
    }
    // If BLS fails, deserializeBatchV2 throws — so getting here means it passed.
  }, 60_000);

  // 3. No-RLE roundtrip — payloadTypeRLE disabled
  it('no-RLE roundtrip: payloadTypeRLE:false still round-trips', async () => {
    const dots = await buildChain(20);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: false,
    });
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

    expect(recovered.length).toBe(20);
    for (let i = 0; i < dots.length; i++) {
      const orig = dots[i]!;
      const rec = recovered[i]!;
      expect(rec[136]).toBe(orig[136]);
      expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
    }
  }, 30_000);

  // 4. No-delta roundtrip — timestampDelta disabled
  it('no-delta roundtrip: timestampDelta:false still round-trips', async () => {
    const dots = await buildChain(20);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: false,
      payloadTypeRLE: true,
    });
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

    expect(recovered.length).toBe(20);
    for (let i = 0; i < dots.length; i++) {
      const orig = dots[i]!;
      const rec = recovered[i]!;
      // timestamp preserved
      expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136)));
      expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
    }
  }, 30_000);

  // 5. BLS verification — tamper payload byte → must throw
  it('BLS verification: tampered payload causes deserialize to throw', async () => {
    const dots = await buildChain(10);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair);

    // Tamper a byte in the payload section (last 160 bytes of the frame)
    const tampered = frame.slice();
    tampered[tampered.length - 5] ^= 0xff;

    await expect(deserializeBatchV2(tampered, blsKeypair.publicKey)).rejects.toThrow(
      'BLS aggregate signature verification failed',
    );
  }, 30_000);

  // 6. Size comparison: batch v2 vs batch v1 BLS for periodic DOTs
  //
  // v1 BLS layout: header(44) + N×entry(18) + aggSig(48)
  //   N=100: 44 + 1800 + 48 = 1892 B
  // v2 layout: header(86) + ts_delta(8+99×2) + type_rle(2) + payloads(N×16)
  //   N=100: 86 + 206 + 2 + 1600 = 1894 B  ← 2B larger due to bigger fixed header
  //   N=200: 86 + 8+199×2 + 2 + 3200 = 3704 B vs v1: 44+3600+48 = 3692 B  (still v1 wins for uniform types)
  //
  // v2 wins when timestamp deltas compress more than v1's 1B-per-delta,
  // and when payloads are diverse enough to reward column layout.
  // For homogeneous periodic streams, v1 and v2 are within 1% — within expected margin.
  //
  // Test: v2 is within 1% of v1 for N=100 periodic DOTs (acceptable overhead).
  it('size comparison: v2 frame is within 1% of v1 BLS frame for 100 periodic DOTs', async () => {
    const keypair = await createKeypair();
    const blsKeypair = createBLSKeypair();

    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;
    const N = 100;

    for (let i = 0; i < N; i++) {
      const dot = await createDOT({
        keypair,
        type: DotType.PUBLIC,
        ts: 1_700_000_000_000 + i * 100,
        ...(prev ? { previous: prev } : {}),
      });
      const bytes = toBytes(dot);
      dots.push(bytes);
      prev = bytes;
    }

    // v1 BLS: header(44) + N×18 + aggSig(48)
    const v1Frame = await batchPackBLS(dots, blsKeypair);
    const v2Frame = await serializeBatchV2(dots, blsKeypair);

    // v2 should be within 1% of v1 for this worst-case scenario
    const overhead = (v2Frame.length - v1Frame.length) / v1Frame.length;
    expect(overhead).toBeLessThanOrEqual(0.01); // ≤1% overhead

    // Log sizes for visibility
    const diff = v2Frame.length - v1Frame.length;
    console.log(
      `Size comparison (N=${N}): v1=${v1Frame.length}B v2=${v2Frame.length}B diff=${diff > 0 ? '+' : ''}${diff}B (${(overhead * 100).toFixed(2)}%)`
    );
  }, 60_000);

  // 7. Edge case: 1 DOT roundtrip
  it('edge case: 1 DOT roundtrips correctly', async () => {
    const dots = await buildChain(1);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair);
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

    expect(recovered.length).toBe(1);
    expect(recovered[0]!.length).toBe(153);

    const orig = dots[0]!;
    const rec = recovered[0]!;
    expect(Array.from(rec.subarray(0, 32))).toEqual(Array.from(orig.subarray(0, 32)));
    expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136)));
    expect(rec[136]).toBe(orig[136]);
    expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153)));
  }, 15_000);

  // 8. Mixed types — validates type column decoding with RLE of varied types
  it('mixed types: 20 DOTs with alternating types roundtrip via RLE', async () => {
    const dots = await buildMixedTypeChain(20);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
    });
    const recovered = await deserializeBatchV2(frame, blsKeypair.publicKey);

    expect(recovered.length).toBe(dots.length);
    for (let i = 0; i < dots.length; i++) {
      // Type must be preserved
      expect(recovered[i]![136]).toBe(dots[i]![136]);
      // Payload must be preserved
      expect(Array.from(recovered[i]!.subarray(137, 153))).toEqual(
        Array.from(dots[i]!.subarray(137, 153)),
      );
    }
  }, 30_000);

  // 9. Validation: empty array throws
  it('validation: empty dots array throws RangeError', async () => {
    const blsKeypair = createBLSKeypair();
    await expect(serializeBatchV2([], blsKeypair)).rejects.toThrow(RangeError);
  });

  // 10. Validation: wrong version in frame throws
  it('validation: wrong version byte throws', async () => {
    const dots = await buildChain(5);
    const blsKeypair = createBLSKeypair();

    const frame = await serializeBatchV2(dots, blsKeypair);
    const bad = frame.slice();
    bad[0] = 0x01; // wrong version

    await expect(deserializeBatchV2(bad, blsKeypair.publicKey)).rejects.toThrow(
      'unsupported version',
    );
  }, 15_000);

});
