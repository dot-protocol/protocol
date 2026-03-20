import { describe, it, expect } from 'vitest';
import { sign, verify, chain, describe as describeDOT, Face, AccessLevel, TeachByte, createKeypair } from '../index.js';
import { DOT_SIZE, PAYLOAD_SIZE } from '@dotprotocol/core';

describe('sign()', () => {
  it('creates a valid PING (empty DOT) by default', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(result.bytes.length).toBe(DOT_SIZE);
    expect(result.dot.payload.every((b) => b === 0)).toBe(true);
    expect(await verify(result)).toBe(true);
  });

  it('signs with string content <= 16 bytes (stored directly)', async () => {
    const key = await createKeypair();
    const result = await sign({ key, content: 'hello' });
    const helloBytes = new TextEncoder().encode('hello');
    expect(result.dot.payload.slice(0, 5)).toEqual(helloBytes);
    expect(result.contentHash).toBeUndefined();
    expect(await verify(result)).toBe(true);
  });

  it('signs with Uint8Array content <= 16 bytes', async () => {
    const key = await createKeypair();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await sign({ key, content: data });
    expect(result.dot.payload.slice(0, 5)).toEqual(data);
    expect(await verify(result)).toBe(true);
  });

  it('signs with exactly 16 bytes content (stored directly)', async () => {
    const key = await createKeypair();
    const data = new Uint8Array(PAYLOAD_SIZE).fill(0xab);
    const result = await sign({ key, content: data });
    expect(result.dot.payload).toEqual(data);
    expect(result.contentHash).toBeUndefined();
  });

  it('signs with content > 16 bytes (stores truncated hash)', async () => {
    const key = await createKeypair();
    const data = new Uint8Array(1024).fill(0x42);
    const result = await sign({ key, content: data });
    // Payload should be truncated SHA-256 hash, not the raw content
    expect(result.dot.payload).not.toEqual(data.slice(0, PAYLOAD_SIZE));
    expect(result.contentHash).toBeDefined();
    expect(result.contentHash!.length).toBe(32); // full SHA-256
    expect(await verify(result)).toBe(true);
  });

  it('signs with large content (100KB)', async () => {
    const key = await createKeypair();
    const data = new Uint8Array(100_000).fill(0xff);
    const result = await sign({ key, content: data });
    expect(result.bytes.length).toBe(DOT_SIZE);
    expect(result.contentHash).toBeDefined();
    expect(await verify(result)).toBe(true);
  });

  it('sets access level correctly', async () => {
    const key = await createKeypair();
    const result = await sign({ key, access: AccessLevel.PRIVATE });
    expect(result.dot.type).toBe(AccessLevel.PRIVATE);
  });

  it('sets face mask correctly', async () => {
    const key = await createKeypair();
    const face = Face.Camera | Face.Transformer;
    const result = await sign({ key, face });
    expect(result.face).toBe(face);
    expect(result.dot.faceMask).toBe(face);
  });

  it('sets TEACH byte', async () => {
    const key = await createKeypair();
    const result = await sign({ key, teach: TeachByte.SelfDescribing });
    expect(result.teach).toBe(TeachByte.SelfDescribing);
  });

  it('sets transform ID', async () => {
    const key = await createKeypair();
    const result = await sign({ key, transform: 'time-capsule' });
    expect(result.transform).toBe('time-capsule');
  });

  it('produces deterministic output with fixed timestamp', async () => {
    const key = await createKeypair(new Uint8Array(32).fill(1));
    const ts = 1741564800000;
    const r1 = await sign({ key, ts });
    const r2 = await sign({ key, ts });
    expect(r1.bytes).toEqual(r2.bytes);
    expect(r1.hash).toEqual(r2.hash);
  });

  it('genesis DOT has zero chain hash', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(result.dot.chain.every((b) => b === 0)).toBe(true);
  });

  it('chained DOT has non-zero chain hash', async () => {
    const key = await createKeypair();
    const genesis = await sign({ key });
    const chained = await sign({ key, prev: genesis.hash });
    // prev is a SHA-256 hash of wire bytes, used as previous for chain linking
    // The DOT's chain field should be SHA-256(previous DOT bytes)
    // Since we pass genesis.hash as prev (which is treated as raw bytes),
    // chain field = SHA-256(genesis.hash) — non-zero
    expect(chained.dot.chain.every((b) => b === 0)).toBe(false);
  });

  it('sets ephemeral access level', async () => {
    const key = await createKeypair();
    const result = await sign({ key, access: AccessLevel.EPHEMERAL });
    expect(result.dot.type).toBe(0x03);
  });

  it('hash is exactly 32 bytes', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(result.hash.length).toBe(32);
  });

  it('different content produces different payloads', async () => {
    const key = await createKeypair();
    const ts = Date.now();
    const r1 = await sign({ key, content: 'hello', ts });
    const r2 = await sign({ key, content: 'world', ts });
    expect(r1.dot.payload).not.toEqual(r2.dot.payload);
  });

  it('face defaults to 0 when not provided', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(result.face).toBe(0);
  });

  it('teach defaults to None when not provided', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(result.teach).toBe(TeachByte.None);
  });

  it('signs with all options combined', async () => {
    const key = await createKeypair();
    const genesis = await sign({ key });
    const result = await sign({
      key,
      content: 'full test',
      face: Face.File | Face.Writer,
      access: AccessLevel.CIRCLE,
      teach: TeachByte.HumanReadable,
      transform: 'signer-approval',
      prev: genesis.hash,
    });
    expect(await verify(result)).toBe(true);
    expect(result.face).toBe(Face.File | Face.Writer);
    expect(result.teach).toBe(TeachByte.HumanReadable);
    expect(result.transform).toBe('signer-approval');
    expect(result.dot.type).toBe(AccessLevel.CIRCLE);
  });
});

describe('verify()', () => {
  it('verifies a SignedDOT', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(await verify(result)).toBe(true);
  });

  it('verifies a raw DOT object', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(await verify(result.dot)).toBe(true);
  });

  it('verifies raw 153 bytes', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(await verify(result.bytes)).toBe(true);
  });

  it('rejects tampered bytes', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    const tampered = new Uint8Array(result.bytes);
    tampered[140] ^= 0xff; // flip a payload byte
    expect(await verify(tampered)).toBe(false);
  });

  it('rejects DOT with wrong signature', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    const tamperedDot = { ...result.dot, sig: new Uint8Array(64).fill(0) };
    expect(await verify(tamperedDot)).toBe(false);
  });

  it('rejects DOT with wrong public key', async () => {
    const key = await createKeypair();
    const key2 = await createKeypair();
    const result = await sign({ key });
    const tamperedDot = { ...result.dot, pubkey: key2.publicKey };
    expect(await verify(tamperedDot)).toBe(false);
  });
});

describe('chain()', () => {
  it('validates empty chain', async () => {
    const result = await chain([]);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(0);
  });

  it('validates single DOT chain', async () => {
    const key = await createKeypair();
    const d = await sign({ key });
    const result = await chain([d]);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(1);
  });

  it('validates multi-DOT chain using SignedDOT', async () => {
    const key = await createKeypair();
    const d1 = await sign({ key });
    const d2 = await sign({ key, prev: d1.bytes });
    const d3 = await sign({ key, prev: d2.bytes });
    const result = await chain([d1, d2, d3]);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(3);
  });

  it('validates chain using raw bytes', async () => {
    const key = await createKeypair();
    const d1 = await sign({ key });
    const d2 = await sign({ key, prev: d1.bytes });
    const result = await chain([d1.bytes, d2.bytes]);
    expect(result.valid).toBe(true);
  });

  it('validates chain using DOT objects', async () => {
    const key = await createKeypair();
    const d1 = await sign({ key });
    const d2 = await sign({ key, prev: d1.bytes });
    const result = await chain([d1.dot, d2.dot]);
    expect(result.valid).toBe(true);
  });

  it('detects broken chain', async () => {
    const key = await createKeypair();
    const d1 = await sign({ key });
    const d2 = await sign({ key }); // not chained to d1
    const result = await chain([d1, d2]);
    // d2 is a genesis DOT (zero chain), so chain check should detect broken link
    // Actually d2 has zero chain hash which won't match SHA-256 of d1
    if (d2.dot.chain.every((b) => b === 0)) {
      // Two genesis DOTs — second should fail chain check
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    }
  });

  it('detects tampered DOT in chain', async () => {
    const key = await createKeypair();
    const d1 = await sign({ key });
    const d2 = await sign({ key, prev: d1.bytes });
    // Tamper with d1's signature
    const tampered = { ...d1.dot, sig: new Uint8Array(64).fill(0) };
    const result = await chain([tampered, d2.dot]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('validates 10-DOT chain', async () => {
    const key = await createKeypair();
    const dots = [];
    let prev: Uint8Array | undefined;
    for (let i = 0; i < 10; i++) {
      const d = await sign({ key, prev, content: `dot-${i}` });
      dots.push(d);
      prev = d.bytes;
    }
    const result = await chain(dots);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(10);
  });

  it('validates mixed format chain', async () => {
    const key = await createKeypair();
    const d1 = await sign({ key });
    const d2 = await sign({ key, prev: d1.bytes });
    const d3 = await sign({ key, prev: d2.bytes });
    // Mix: SignedDOT, raw bytes, DOT object
    const result = await chain([d1, d2.bytes, d3.dot]);
    expect(result.valid).toBe(true);
  });
});

describe('describe()', () => {
  it('describes a PING DOT', async () => {
    const key = await createKeypair();
    const d = await sign({ key });
    const desc = describeDOT(d);
    expect(desc.isPing).toBe(true);
    expect(desc.isGenesis).toBe(true);
    expect(desc.access).toBe('public');
    expect(desc.size).toBe(DOT_SIZE);
    expect(desc.key.length).toBe(64); // 32 bytes hex
    expect(desc.time).toBeTruthy();
  });

  it('describes a DOT with faces', async () => {
    const key = await createKeypair();
    const d = await sign({ key, face: Face.Camera | Face.Transformer });
    const desc = describeDOT(d);
    expect(desc.faces).toContain('Camera');
    expect(desc.faces).toContain('Transformer');
  });

  it('describes a DOT with TEACH byte', async () => {
    const key = await createKeypair();
    const d = await sign({ key, teach: TeachByte.SelfDescribing });
    const desc = describeDOT(d);
    expect(desc.teach).toBe('self-describing');
  });

  it('describes a chained DOT', async () => {
    const key = await createKeypair();
    const genesis = await sign({ key });
    const chained = await sign({ key, prev: genesis.bytes });
    const desc = describeDOT(chained);
    expect(desc.isGenesis).toBe(false);
  });

  it('describes a DOT with content', async () => {
    const key = await createKeypair();
    const d = await sign({ key, content: 'hello' });
    const desc = describeDOT(d);
    expect(desc.isPing).toBe(false);
  });

  it('describes raw bytes', async () => {
    const key = await createKeypair();
    const d = await sign({ key });
    const desc = describeDOT(d.bytes);
    expect(desc.isPing).toBe(true);
    expect(desc.size).toBe(DOT_SIZE);
  });

  it('describes a DOT object directly', async () => {
    const key = await createKeypair();
    const d = await sign({ key, face: Face.File });
    const desc = describeDOT(d.dot);
    expect(desc.faces).toContain('File');
  });

  it('describes private access level', async () => {
    const key = await createKeypair();
    const d = await sign({ key, access: AccessLevel.PRIVATE });
    const desc = describeDOT(d);
    expect(desc.access).toBe('private');
  });

  it('describes ephemeral access level', async () => {
    const key = await createKeypair();
    const d = await sign({ key, access: AccessLevel.EPHEMERAL });
    const desc = describeDOT(d);
    expect(desc.access).toBe('ephemeral');
  });

  it('describes circle access level', async () => {
    const key = await createKeypair();
    const d = await sign({ key, access: AccessLevel.CIRCLE });
    const desc = describeDOT(d);
    expect(desc.access).toBe('circle');
  });

  it('has correct timestamp', async () => {
    const key = await createKeypair();
    const ts = 1741564800000;
    const d = await sign({ key, ts });
    const desc = describeDOT(d);
    expect(desc.ts).toBe(ts);
    expect(desc.time).toBe(new Date(ts).toISOString());
  });
});

describe('content hashing', () => {
  it('same content produces same hash', async () => {
    const key = await createKeypair();
    const data = new Uint8Array(1024).fill(0x42);
    const ts = Date.now();
    const r1 = await sign({ key, content: data, ts });
    const r2 = await sign({ key, content: data, ts });
    expect(r1.dot.payload).toEqual(r2.dot.payload);
    expect(r1.contentHash).toEqual(r2.contentHash);
  });

  it('different content produces different hash', async () => {
    const key = await createKeypair();
    const ts = Date.now();
    const r1 = await sign({ key, content: new Uint8Array(100).fill(1), ts });
    const r2 = await sign({ key, content: new Uint8Array(100).fill(2), ts });
    expect(r1.dot.payload).not.toEqual(r2.dot.payload);
  });

  it('1-byte content stored directly', async () => {
    const key = await createKeypair();
    const data = new Uint8Array([0x42]);
    const result = await sign({ key, content: data });
    expect(result.dot.payload[0]).toBe(0x42);
    expect(result.contentHash).toBeUndefined();
  });

  it('17-byte content produces hash pointer', async () => {
    const key = await createKeypair();
    const data = new Uint8Array(17).fill(0xab);
    const result = await sign({ key, content: data });
    expect(result.contentHash).toBeDefined();
    expect(result.contentHash!.length).toBe(32);
  });
});

describe('round-trip', () => {
  it('sign → toBytes → fromBytes → verify', async () => {
    const key = await createKeypair();
    const result = await sign({ key, content: 'round-trip' });
    expect(await verify(result.bytes)).toBe(true);
  });

  it('sign → chain of 5 → verify chain', async () => {
    const key = await createKeypair();
    const dots = [];
    let prev: Uint8Array | undefined;
    for (let i = 0; i < 5; i++) {
      const d = await sign({ key, prev, content: `step-${i}` });
      dots.push(d);
      prev = d.bytes;
    }
    const result = await chain(dots);
    expect(result.valid).toBe(true);
    // Verify each DOT individually too
    for (const d of dots) {
      expect(await verify(d)).toBe(true);
    }
  });

  it('different keypairs produce different signatures', async () => {
    const key1 = await createKeypair();
    const key2 = await createKeypair();
    const ts = Date.now();
    const r1 = await sign({ key: key1, ts });
    const r2 = await sign({ key: key2, ts });
    expect(r1.dot.sig).not.toEqual(r2.dot.sig);
  });
});
