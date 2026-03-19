import { describe, it, expect } from 'vitest';
import {
  // from core
  createKeypair,
  createDOT,
  DotType,
  toBytes,
  fromBytes,
  verifyDOT,
  createBLSKeypair,
  // from compression
  serializeBatchV2,
  deserializeBatchV2,
  // from wrapper
  wrap,
  unwrap,
  createSession,
  dotId,
} from '../index.js';

describe('@dot-protocol/sdk — umbrella smoke tests', () => {
  it('all imports are defined', () => {
    expect(createKeypair).toBeDefined();
    expect(createDOT).toBeDefined();
    expect(DotType).toBeDefined();
    expect(toBytes).toBeDefined();
    expect(fromBytes).toBeDefined();
    expect(verifyDOT).toBeDefined();
    expect(createBLSKeypair).toBeDefined();
    expect(serializeBatchV2).toBeDefined();
    expect(deserializeBatchV2).toBeDefined();
    expect(wrap).toBeDefined();
    expect(unwrap).toBeDefined();
    expect(createSession).toBeDefined();
    expect(dotId).toBeDefined();
  });

  it('createDOT + verifyDOT works', async () => {
    const keypair = await createKeypair();
    const dot = await createDOT({ keypair, type: DotType.PUBLIC });
    const bytes = toBytes(dot);
    expect(bytes).toHaveLength(153);
    const valid = await verifyDOT(dot);
    expect(valid).toBe(true);
  });

  it('wrap + unwrap round-trip', async () => {
    const payload = new TextEncoder().encode('hello dot protocol');
    const session = await createSession();
    const chain = await wrap(payload, { session });
    // unwrap takes (frame, options) — pass frame bytes + blsPublicKey for verified decode
    const result = await unwrap(chain.frame, { blsPublicKey: chain.blsPublicKey });
    expect(result.verified).toBe(true);
    expect(result.data).toEqual(payload);
  });

  it('serializeBatchV2 + deserializeBatchV2 works', async () => {
    const keypair = await createKeypair();
    const blsKeypair = createBLSKeypair();
    const dot1 = await createDOT({ keypair, type: DotType.PUBLIC });
    const dot2 = await createDOT({ keypair, type: DotType.PUBLIC, previous: toBytes(dot1) });
    const dotBytes = [toBytes(dot1), toBytes(dot2)];

    const packed = await serializeBatchV2(dotBytes, blsKeypair);
    const unpacked = await deserializeBatchV2(packed, blsKeypair.publicKey);
    expect(unpacked).toHaveLength(2);

    // batch-v2 reconstructs chain hashes on decode — compare only the invariant fields:
    // pubkey [0..31], timestamp [128..135], type [136], payload [137..152]
    for (let i = 0; i < dotBytes.length; i++) {
      const orig = dotBytes[i]!;
      const rec = unpacked[i]!;
      expect(rec).toHaveLength(153);
      expect(Array.from(rec.subarray(0, 32))).toEqual(Array.from(orig.subarray(0, 32)));    // pubkey
      expect(Array.from(rec.subarray(128, 136))).toEqual(Array.from(orig.subarray(128, 136))); // timestamp
      expect(rec[136]).toBe(orig[136]);                                                       // type
      expect(Array.from(rec.subarray(137, 153))).toEqual(Array.from(orig.subarray(137, 153))); // payload
    }
  });

  it('dotId() returns an identity with publicKey and did', async () => {
    const identity = await dotId();
    expect(identity.publicKey).toBeInstanceOf(Uint8Array);
    expect(identity.publicKey).toHaveLength(32);
    expect(identity.did).toMatch(/^dot:/);
  });
});
