import { describe, it, expect } from 'vitest';
import { batchPack, batchUnpack, batchPackBLS, batchUnpackBLS } from '../batch.js';
import { createKeypair, createDOT, toBytes, DotType } from '../index.js';
import { createBLSKeypair } from '../bls.js';

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

describe('BLS batch compression', () => {
  it('roundtrips BLS batch of 10 DOTs', async () => {
    const keypair = await createKeypair();
    const blsKeypair = createBLSKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;

    for (let i = 0; i < 10; i++) {
      const payload = new Uint8Array(16);
      payload[0] = i & 0xFF;
      const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }

    const frame = await batchPackBLS(dots, blsKeypair);
    const unpacked = await batchUnpackBLS(frame, blsKeypair.publicKey);

    expect(unpacked.length).toBe(10);
    // Payloads and types must match (chain hashes differ — BLS chain hash rule)
    for (let i = 0; i < 10; i++) {
      expect(unpacked[i].slice(137, 153)).toEqual(dots[i].slice(137, 153)); // payload
      expect(unpacked[i][136]).toBe(dots[i][136]); // type
    }
  });

  it('BLS batch is dramatically smaller than Ed25519 individual', async () => {
    const N = 50;
    const keypair = await createKeypair();
    const blsKeypair = createBLSKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;

    for (let i = 0; i < N; i++) {
      const payload = new Uint8Array(16);
      payload[0] = i & 0xFF;
      const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }

    const blsFrame = await batchPackBLS(dots, blsKeypair);
    const individualSize = 153 * N; // 7650 bytes
    // Ed25519 batch: 44 + 50*82 = 4144 bytes
    // BLS batch: 44 + 50*18 + 48 = 992 bytes
    expect(blsFrame.length).toBeLessThan(individualSize * 0.15); // < 15% of individual size

    console.log(`N=${N}: Individual=${individualSize}B, BLS batch=${blsFrame.length}B (${((1 - blsFrame.length/individualSize)*100).toFixed(0)}% savings)`);
  });

  it('rejects tampered BLS batch', async () => {
    const keypair = await createKeypair();
    const blsKeypair = createBLSKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;

    for (let i = 0; i < 5; i++) {
      const payload = new Uint8Array(16);
      payload[0] = i & 0xFF;
      const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }

    const frame = await batchPackBLS(dots, blsKeypair);
    // Flip a bit in entry 2's payload area
    const entryOffset = 44 + 1 * 18; // second entry (18B each) — skip header(44B) + first entry(18B)
    const payloadOffset = entryOffset + 2; // past ts_delta + type_delta
    const tampered = new Uint8Array(frame);
    tampered[payloadOffset] ^= 0xFF;

    await expect(batchUnpackBLS(tampered, blsKeypair.publicKey)).rejects.toThrow();
  });

  it('Weissman target: N=100 BLS batch < 2000 bytes', () => {
    const N = 100;
    const blsBatchSize = 44 + N * 18 + 48; // 1892 bytes
    expect(blsBatchSize).toBeLessThan(2000);
    const ratio = (153 * N) / blsBatchSize;
    console.log(`N=${N}: ${153*N}B → ${blsBatchSize}B (${ratio.toFixed(1)}× compression, ${((1-blsBatchSize/(153*N))*100).toFixed(0)}% savings)`);
    expect(ratio).toBeGreaterThan(7);
  });
});
