import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT, toBytes, fromBytes } from '../index.js';
import { DOT_SIZE } from '../types.js';

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
