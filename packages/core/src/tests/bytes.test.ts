import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT, toBytes, fromBytes } from '../index.js';
import { DOT_SIZE } from '../types.js';
import { toArrayBuffer } from '../bytes.js';
import { importPublicKey } from '../keypair.js';

describe('toBytes / fromBytes roundtrip', () => {
  it('roundtrip preserves all fields', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'roundtrip' });
    const bytes = toBytes(dot);
    const restored = fromBytes(bytes);
    expect(restored.pubkey).toEqual(dot.pubkey);
    expect(restored.sig).toEqual(dot.sig);
    expect(restored.chain).toEqual(dot.chain);
    expect(restored.ts).toBe(dot.ts);
    expect(restored.type).toBe(dot.type);
    expect(restored.payload).toEqual(dot.payload);
  });

  it('fromBytes throws on wrong size', () => {
    expect(() => fromBytes(new Uint8Array(100))).toThrow();
    expect(() => fromBytes(new Uint8Array(200))).toThrow();
  });

  it('toBytes always produces DOT_SIZE bytes', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp });
    expect(toBytes(dot).length).toBe(DOT_SIZE);
  });
});

describe('toArrayBuffer', () => {
  it('returns the same buffer when Uint8Array owns its entire ArrayBuffer', () => {
    // Covers the fast path (byteOffset === 0 && byteLength === buffer.byteLength)
    const arr = new Uint8Array([1, 2, 3, 4]);
    const result = toArrayBuffer(arr);
    expect(result).toBe(arr.buffer);
  });

  it('copies bytes when Uint8Array is a view into a larger ArrayBuffer', () => {
    // Covers lines 44-45: the arr.slice(0).buffer path
    // Create a larger buffer and take a subarray starting at offset 4
    const large = new Uint8Array(16).fill(0xAB);
    const sub = large.subarray(4, 12); // byteOffset=4, byteLength=8 ≠ buffer.byteLength(16)
    const result = toArrayBuffer(sub);
    // Must be a copy — not the same buffer reference
    expect(result).not.toBe(large.buffer);
    // Content must match the subarray's bytes
    expect(new Uint8Array(result)).toEqual(sub);
  });
});

describe('importPublicKey — non-contiguous buffer path', () => {
  it('imports a public key that is a view into a larger ArrayBuffer (byteOffset > 0)', async () => {
    // Covers keypair.ts line 68: the pubkey.slice(0).buffer path
    // when pubkey.byteOffset !== 0 or pubkey.byteLength !== pubkey.buffer.byteLength
    const kp = await createKeypair();
    // Create a larger buffer and embed the pubkey at offset 8
    const bigBuf = new Uint8Array(8 + 32);
    bigBuf.set(kp.publicKey, 8);
    // subarray with byteOffset = 8 — NOT equal to 0, so hits the else branch
    const pubkeyView = bigBuf.subarray(8, 40);
    expect(pubkeyView.byteOffset).toBe(8);
    // importPublicKey must succeed despite non-contiguous buffer
    const cryptoKey = await importPublicKey(pubkeyView);
    expect(cryptoKey).toBeTruthy();
  });
});
