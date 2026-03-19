import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes } from '../index.js';
import type { DOT } from '../types.js';

describe('verifyDOT', () => {
  it('returns true for valid DOT', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    expect(await verifyDOT(dot)).toBe(true);
  });

  it('returns false when signature is tampered', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    const dotBytes = toBytes(dot);
    // Flip a byte in the signature region (bytes 32..95)
    dotBytes.set([dotBytes[40]! ^ 0xff], 40);
    const tamperedDOT = fromBytes(dotBytes);
    expect(await verifyDOT(tamperedDOT)).toBe(false);
  });

  it('returns false when payload is tampered', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    const dotBytes = toBytes(dot);
    // Flip a byte in the payload region (bytes 137..152)
    dotBytes.set([dotBytes[140]! ^ 0xff], 140);
    const tamperedDOT = fromBytes(dotBytes);
    expect(await verifyDOT(tamperedDOT)).toBe(false);
  });
});

describe('verifyDOT — error paths', () => {
  it('returns false for a DOT with an all-zero (invalid) public key', async () => {
    // Construct a DOT struct with a zeroed pubkey — importPublicKey will still accept it
    // but the signature won't verify, exercising the catch path indirectly.
    // The reliable way: give it a valid DOT but swap pubkey to a different keypair's key.
    const kp1 = await createKeypair();
    const kp2 = await createKeypair();
    const dot = await createDOT({ keypair: kp1, payload: 'test' });
    // Manually construct a DOT with mismatched pubkey — sig is from kp1, pubkey is kp2
    const spoofed: DOT = {
      pubkey: kp2.publicKey,
      sig: dot.sig,
      chain: dot.chain,
      ts: dot.ts,
      type: dot.type,
      payload: dot.payload,
    };
    expect(await verifyDOT(spoofed)).toBe(false);
  });

  it('returns false when DOT has wrong-length public key bytes (triggers catch)', async () => {
    // An invalid pubkey length causes importPublicKey to throw inside verifyDOT,
    // which hits the catch { return false } at lines 15-16.
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    // Replace pubkey with a wrong-length array — Web Crypto importKey('raw') throws for Ed25519
    // because it expects exactly 32 bytes
    const badPubkey = new Uint8Array(10); // wrong length — throws in importPublicKey
    const badDot: DOT = { ...dot, pubkey: badPubkey };
    expect(await verifyDOT(badDot)).toBe(false);
  });
});

describe('checkChain', () => {
  it('validates a chain of DOTs', async () => {
    const kp = await createKeypair();
    const d1 = await createDOT({ keypair: kp });
    const d2 = await createDOT({ keypair: kp, previous: toBytes(d1) });
    const d3 = await createDOT({ keypair: kp, previous: toBytes(d2) });
    const result = await checkChain([d1, d2, d3]);
    expect(result.valid).toBe(true);
  });

  it('detects broken chain link', async () => {
    const kp = await createKeypair();
    const d1 = await createDOT({ keypair: kp });
    const d2 = await createDOT({ keypair: kp });
    const result = await checkChain([d1, d2]);
    expect(result.valid).toBe(false);
  });

  it('empty chain is valid', async () => {
    const result = await checkChain([]);
    expect(result.valid).toBe(true);
  });

  it('returns brokenAt index when a DOT in the chain has tampered signature', async () => {
    // Covers lines 27-28: the `Invalid signature at index i` path inside checkChain
    const kp = await createKeypair();
    const d1 = await createDOT({ keypair: kp });
    const d2 = await createDOT({ keypair: kp, previous: toBytes(d1) });

    // Tamper d2 by constructing it with a wrong pubkey so verifyDOT returns false
    const kp2 = await createKeypair();
    const d2Tampered: DOT = { ...d2, pubkey: kp2.publicKey };

    const result = await checkChain([d1, d2Tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toContain('Invalid signature');
    }
  });
});
