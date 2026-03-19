import { describe, it, expect } from 'vitest';
import {
  edToX25519Pub,
  ecdh,
  encryptPayload,
  decryptPayload,
} from '../crypto.js';
import { createKeypair } from '@dot-protocol/core';

describe('DOT ECDH crypto', () => {
  it('converts Ed25519 pubkey to X25519', async () => {
    const keypair = await createKeypair();
    const x25519 = edToX25519Pub(keypair.publicKey);
    expect(x25519).toHaveLength(32);
  });

  it('ECDH produces same shared secret both ways', async () => {
    const alice = await createKeypair();
    const bob = await createKeypair();
    const secretAB = ecdh(alice.privateKey, bob.publicKey);
    const secretBA = ecdh(bob.privateKey, alice.publicKey);
    expect(Array.from(secretAB)).toEqual(Array.from(secretBA));
  });

  it('encrypt+decrypt round-trip (≤16B)', async () => {
    const alice = await createKeypair();
    const bob = await createKeypair();
    const shared = ecdh(alice.privateKey, bob.publicKey);
    const plaintext = new TextEncoder().encode('hello');
    const ct = encryptPayload(plaintext, shared, 0n);
    const pt = decryptPayload(ct, shared, 0n);
    expect(new TextDecoder().decode(pt).replace(/\0/g, '')).toBe('hello');
  });

  it('encrypt+decrypt round-trip (16B boundary)', async () => {
    const alice = await createKeypair();
    const bob = await createKeypair();
    const shared = ecdh(alice.privateKey, bob.publicKey);
    const plaintext = new Uint8Array(16).fill(0xAB);
    const ct = encryptPayload(plaintext, shared, 42n);
    const pt = decryptPayload(ct, shared, 42n);
    expect(Array.from(pt)).toEqual(Array.from(plaintext));
  });

  it('different nonce (chain pos) produces different ciphertext', () => {
    const shared = new Uint8Array(32).fill(7);
    const plain = new Uint8Array(16).fill(1);
    const ct0 = encryptPayload(plain, shared, 0n);
    const ct1 = encryptPayload(plain, shared, 1n);
    expect(Array.from(ct0)).not.toEqual(Array.from(ct1));
  });

  it('ECDH integration: alice encrypts for bob, bob decrypts', async () => {
    const alice = await createKeypair();
    const bob = await createKeypair();
    const msg = new TextEncoder().encode('secret');
    const sharedAB = ecdh(alice.privateKey, bob.publicKey);
    const ct = encryptPayload(msg, sharedAB, 0n);
    const sharedBA = ecdh(bob.privateKey, alice.publicKey);
    const pt = decryptPayload(ct, sharedBA, 0n);
    expect(new TextDecoder().decode(pt).replace(/\0/g, '')).toBe('secret');
  });
});
