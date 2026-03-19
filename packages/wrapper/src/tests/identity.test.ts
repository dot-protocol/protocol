import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { dotId } from '../identity.js';

// ─── Setup ─────────────────────────────────────────────────────────────────────

let testPath: string;

beforeEach(() => {
  testPath = join(tmpdir(), `dot-id-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  if (existsSync(testPath)) rmSync(testPath, { recursive: true });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('dot.id() — identity creation', () => {
  it('creates identity with 32-byte public key', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    expect(identity.publicKey).toBeInstanceOf(Uint8Array);
    expect(identity.publicKey.length).toBe(32);
  });

  it('DID format starts with "dot:"', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    expect(identity.did).toMatch(/^dot:[A-Za-z0-9_-]+$/);
  });

  it('puf is null', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    expect(identity.puf).toBeNull();
  });

  it('export() returns a non-empty base64url string', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    const exported = identity.export();
    expect(typeof exported).toBe('string');
    expect(exported.length).toBeGreaterThan(0);
    // base64url: no +, no /, no =
    expect(exported).not.toContain('+');
    expect(exported).not.toContain('/');
    expect(exported).not.toContain('=');
  });
});

describe('dot.id() — sign and verify', () => {
  it('sign and verify round-trip succeeds', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    const data = new TextEncoder().encode('hello dot protocol');
    const sig = await identity.sign(data);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    const valid = await identity.verify(data, sig);
    expect(valid).toBe(true);
  });

  it('verify with wrong public key returns false', async () => {
    const pathA = join(testPath, 'a.key');
    const pathB = join(testPath, 'b.key');
    const identityA = await dotId({ storagePath: pathA });
    const identityB = await dotId({ storagePath: pathB });

    const data = new TextEncoder().encode('cross-identity verify test');
    const sig = await identityA.sign(data);

    // Verify with B's public key — should fail
    const valid = await identityA.verify(data, sig, identityB.publicKey);
    expect(valid).toBe(false);
  });

  it('sign empty bytes succeeds', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    const empty = new Uint8Array(0);
    const sig = await identity.sign(empty);
    expect(sig.length).toBe(64);
    const valid = await identity.verify(empty, sig);
    expect(valid).toBe(true);
  });

  it('sign large bytes (10KB) succeeds', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    const large = new Uint8Array(10 * 1024);
    for (let i = 0; i < large.length; i++) large[i] = i % 251;
    const sig = await identity.sign(large);
    expect(sig.length).toBe(64);
    const valid = await identity.verify(large, sig);
    expect(valid).toBe(true);
  });

  it('verify tampered data returns false', async () => {
    const identity = await dotId({ storagePath: join(testPath, 'identity.key') });
    const data = new TextEncoder().encode('original message');
    const tampered = new TextEncoder().encode('tampered message');
    const sig = await identity.sign(data);
    const valid = await identity.verify(tampered, sig);
    expect(valid).toBe(false);
  });
});

describe('dot.id() — persistence', () => {
  it('two calls with same path return same public key', async () => {
    const keyPath = join(testPath, 'identity.key');
    const id1 = await dotId({ storagePath: keyPath, passphrase: 'test-passphrase' });
    const id2 = await dotId({ storagePath: keyPath, passphrase: 'test-passphrase' });

    expect(Buffer.from(id1.publicKey).toString('hex'))
      .toBe(Buffer.from(id2.publicKey).toString('hex'));
    expect(id1.did).toBe(id2.did);
  });

  it('loaded identity can verify signatures from original identity', async () => {
    const keyPath = join(testPath, 'identity.key');
    const id1 = await dotId({ storagePath: keyPath, passphrase: 'stable-pass' });

    const data = new TextEncoder().encode('signed by id1');
    const sig = await id1.sign(data);

    // Reload identity from disk
    const id2 = await dotId({ storagePath: keyPath, passphrase: 'stable-pass' });
    const valid = await id2.verify(data, sig);
    expect(valid).toBe(true);
  });
});

describe('dot.id() — forceNew', () => {
  it('forceNew creates a different key each time', async () => {
    const keyPath = join(testPath, 'identity.key');
    const id1 = await dotId({ storagePath: keyPath, passphrase: 'pass', forceNew: false });
    const id2 = await dotId({ storagePath: keyPath, passphrase: 'pass', forceNew: true });

    // Extremely unlikely to be equal (2^256 space)
    expect(Buffer.from(id1.publicKey).toString('hex'))
      .not.toBe(Buffer.from(id2.publicKey).toString('hex'));
  });
});

describe('dot.id() — custom passphrase', () => {
  it('loads correctly with explicit passphrase', async () => {
    const keyPath = join(testPath, 'identity.key');
    const id1 = await dotId({ storagePath: keyPath, passphrase: 'my-custom-phrase-42' });
    const id2 = await dotId({ storagePath: keyPath, passphrase: 'my-custom-phrase-42' });
    expect(id1.did).toBe(id2.did);
  });

  it('rejects decryption with wrong passphrase', async () => {
    const keyPath = join(testPath, 'identity.key');
    await dotId({ storagePath: keyPath, passphrase: 'correct-passphrase' });
    await expect(
      dotId({ storagePath: keyPath, passphrase: 'wrong-passphrase' }),
    ).rejects.toThrow();
  });
});
