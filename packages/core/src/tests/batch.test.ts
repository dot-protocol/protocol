import { describe, it, expect } from 'vitest';
import { batchPack, batchUnpack } from '../batch.js';
import { createKeypair, createDOT, toBytes, DotType } from '../index.js';

describe('batch compression', () => {
  it('roundtrips a batch of 5 DOTs', async () => {
    const keypair = await createKeypair();
    const dots: Uint8Array[] = [];

    // Build a chain: each DOT uses `previous` pointing to prior DOT bytes
    const dot0 = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    dots.push(dot0);
    const dot1 = toBytes(await createDOT({ keypair, payload: new Uint8Array([1,...new Array(15).fill(0)]), type: DotType.PUBLIC, previous: dot0 }));
    dots.push(dot1);
    const dot2 = toBytes(await createDOT({ keypair, payload: new Uint8Array([2,...new Array(15).fill(0)]), type: DotType.PUBLIC, previous: dot1 }));
    dots.push(dot2);
    const dot3 = toBytes(await createDOT({ keypair, payload: new Uint8Array([3,...new Array(15).fill(0)]), type: DotType.PUBLIC, previous: dot2 }));
    dots.push(dot3);
    const dot4 = toBytes(await createDOT({ keypair, payload: new Uint8Array([4,...new Array(15).fill(0)]), type: DotType.PUBLIC, previous: dot3 }));
    dots.push(dot4);

    const frame = batchPack(dots);
    const unpacked = await batchUnpack(frame);

    expect(unpacked.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(unpacked[i]).toEqual(dots[i]);
    }
  });

  it('batch frame is smaller than individual DOTs', async () => {
    const keypair = await createKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;

    for (let i = 0; i < 20; i++) {
      const payload = new Uint8Array(16);
      payload[0] = i & 0xFF;
      const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }

    const frame = batchPack(dots);
    const individualSize = 153 * 20;
    expect(frame.length).toBeLessThan(individualSize);
    console.log(`Individual: ${individualSize}B, Batch: ${frame.length}B, Savings: ${((1 - frame.length/individualSize) * 100).toFixed(1)}%`);
  });

  it('rejects batch with mixed pubkeys', async () => {
    const kp1 = await createKeypair();
    const kp2 = await createKeypair();
    const dot1 = toBytes(await createDOT({ keypair: kp1, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const dot2 = toBytes(await createDOT({ keypair: kp2, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    expect(() => batchPack([dot1, dot2])).toThrow();
  });

  it('handles timestamp deltas > 255ms (escape encoding)', async () => {
    const keypair = await createKeypair();
    const baseTs = Date.now();
    // Force a 400ms gap via ts override — deterministic, no setTimeout
    const dot1 = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC, ts: baseTs }));
    const dot2 = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC, previous: dot1, ts: baseTs + 400 }));

    const frame = batchPack([dot1, dot2]);

    // Verify escape byte 0xFF is present in the second entry's ts_delta slot.
    // Header: 44B. Entry 0: sig(64) + tsDelta(1) + typeDelta(1) + payload(16) = 82B.
    // Entry 1 starts at 44+82=126. Sig is 64B, so ts_delta byte is at 126+64=190.
    expect(frame[190]).toBe(0xFF); // escape sentinel

    const unpacked = await batchUnpack(frame);
    expect(unpacked.length).toBe(2);
    expect(unpacked[0]).toEqual(dot1);
    expect(unpacked[1]).toEqual(dot2);
  });

  it('handles mixed type bytes', async () => {
    const keypair = await createKeypair();
    const types = [DotType.PUBLIC, DotType.CIRCLE, DotType.PRIVATE, DotType.PUBLIC, DotType.EPHEMERAL];
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;

    for (const type of types) {
      const dot = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }

    const frame = batchPack(dots);
    const unpacked = await batchUnpack(frame);
    expect(unpacked.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(unpacked[i]).toEqual(dots[i]);
    }
  });

  it('works with batch of 1 (degenerate case)', async () => {
    const keypair = await createKeypair();
    const dot = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const frame = batchPack([dot]);
    const unpacked = await batchUnpack(frame);
    expect(unpacked[0]).toEqual(dot);
  });

  it('preserves all 153 bytes exactly', async () => {
    const keypair = await createKeypair();
    const payload = new Uint8Array(16);
    crypto.getRandomValues(payload);
    const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PRIVATE }));
    const frame = batchPack([dot]);
    const [unpacked] = await batchUnpack(frame);
    for (let i = 0; i < 153; i++) {
      expect(unpacked[i]).toBe(dot[i]);
    }
  });

  it('rejects empty array', () => {
    expect(() => batchPack([])).toThrow();
  });

  it('rejects truncated frame in batchUnpack', async () => {
    const keypair = await createKeypair();
    const dot = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const frame = batchPack([dot]);
    // Truncate to half — should throw, not return garbage
    const truncated = frame.slice(0, Math.floor(frame.length / 2));
    await expect(batchUnpack(truncated)).rejects.toThrow();
  });
});
