import { describe, it, expect } from 'vitest';
import {
  createBLSKeypair,
  signBLS,
  verifyBLS,
  aggregateSignatures,
  verifyAggregateSameSigner,
  BLS_PUBKEY_SIZE,
  BLS_SIG_SIZE,
} from '../bls.js';

describe('BLS12-381', () => {
  it('generates keypair with correct sizes', () => {
    const kp = createBLSKeypair();
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicKey.length).toBe(BLS_PUBKEY_SIZE); // 96
  });

  it('signs and verifies a message', () => {
    const kp = createBLSKeypair();
    const msg = new Uint8Array(89);
    crypto.getRandomValues(msg);
    const sig = signBLS(msg, kp.privateKey);
    expect(sig.length).toBe(BLS_SIG_SIZE); // 48
    expect(verifyBLS(sig, msg, kp.publicKey)).toBe(true);
  });

  it('rejects wrong message', () => {
    const kp = createBLSKeypair();
    const msg = new Uint8Array(89);
    const wrong = new Uint8Array(89);
    crypto.getRandomValues(msg);
    crypto.getRandomValues(wrong);
    const sig = signBLS(msg, kp.privateKey);
    expect(verifyBLS(sig, wrong, kp.publicKey)).toBe(false);
  });

  it('rejects wrong key', () => {
    const kp1 = createBLSKeypair();
    const kp2 = createBLSKeypair();
    const msg = new Uint8Array(89);
    crypto.getRandomValues(msg);
    const sig = signBLS(msg, kp1.privateKey);
    expect(verifyBLS(sig, msg, kp2.publicKey)).toBe(false);
  });

  it('aggregates N signatures into 48 bytes', () => {
    const kp = createBLSKeypair();
    const sigs: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      const msg = new Uint8Array(89);
      crypto.getRandomValues(msg);
      sigs.push(signBLS(msg, kp.privateKey));
    }
    const agg = aggregateSignatures(sigs);
    expect(agg.length).toBe(BLS_SIG_SIZE); // 48 — same size regardless of N
  });

  it('verifies aggregate (same signer, different messages)', () => {
    const kp = createBLSKeypair();
    const messages: Uint8Array[] = [];
    const sigs: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      const msg = new Uint8Array(89);
      crypto.getRandomValues(msg);
      messages.push(msg);
      sigs.push(signBLS(msg, kp.privateKey));
    }
    const agg = aggregateSignatures(sigs);
    expect(verifyAggregateSameSigner(agg, messages, kp.publicKey)).toBe(true);
  });

  it('rejects tampered message in aggregate', () => {
    const kp = createBLSKeypair();
    const messages: Uint8Array[] = [];
    const sigs: Uint8Array[] = [];
    for (let i = 0; i < 5; i++) {
      const msg = new Uint8Array(89);
      crypto.getRandomValues(msg);
      messages.push(msg);
      sigs.push(signBLS(msg, kp.privateKey));
    }
    const agg = aggregateSignatures(sigs);
    // tamper one message (non-null assertion: array has 5 elements, index 2 exists)
    const target = messages[2] as Uint8Array;
    new DataView(target.buffer).setUint8(target.byteOffset, (new DataView(target.buffer).getUint8(target.byteOffset)) ^ 0xFF);
    expect(verifyAggregateSameSigner(agg, messages, kp.publicKey)).toBe(false);
  });

  it('aggregateSignatures throws for empty array', () => {
    // Covers bls.ts line 86: "aggregateSignatures requires at least one signature"
    expect(() => aggregateSignatures([])).toThrow('at least one');
  });

  it('verifyBLS returns false for an all-zero (invalid) signature bytes', () => {
    // Covers lines 75-76: the catch { return false } in verifyBLS
    // fromBytes on an invalid G1 point throws, which is caught and returns false
    const kp = createBLSKeypair();
    const msg = new Uint8Array(32).fill(1);
    const invalidSig = new Uint8Array(BLS_SIG_SIZE); // all zeros — not a valid G1 point
    expect(verifyBLS(invalidSig, msg, kp.publicKey)).toBe(false);
  });

  it('verifyAggregateSameSigner returns false for invalid aggregate signature bytes', () => {
    // Covers lines 119-120: the catch { return false } in verifyAggregateSameSigner
    // fromBytes on an all-zero array throws inside verifyAggregateSameSigner, caught -> false
    const kp = createBLSKeypair();
    const messages = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    const invalidAgg = new Uint8Array(BLS_SIG_SIZE); // all zeros — not a valid G1 point
    expect(verifyAggregateSameSigner(invalidAgg, messages, kp.publicKey)).toBe(false);
  });

  it('aggregate is 133× smaller than N Ed25519 sigs at N=100', () => {
    const N = 100;
    const ed25519Total = N * 64;
    const blsTotal = BLS_SIG_SIZE;
    expect(blsTotal / ed25519Total).toBeLessThan(0.01); // BLS agg < 1% of Ed25519
    console.log(
      `N=${N}: Ed25519=${ed25519Total}B, BLS agg=${blsTotal}B, ratio=${(ed25519Total / blsTotal).toFixed(0)}×`
    );
  });
});
