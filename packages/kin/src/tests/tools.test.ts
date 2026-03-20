/**
 * @dotprotocol/kin — MCP tool smoke tests
 *
 * Tests the tool handlers directly (not through the MCP protocol layer)
 * by importing the engine and exercising the same logic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DOT } from 'dot-protocol';

// Boot once for all tests
beforeAll(async () => {
  await DOT.boot({ offline: true });
});

afterAll(async () => {
  await DOT.shutdown();
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('identity', () => {
  it('boot creates a valid DID', () => {
    expect(DOT.me).not.toBeNull();
    expect(DOT.me!.did).toMatch(/^dot:[A-Za-z0-9_-]{43}$/);
  });

  it('public key is 32 bytes', () => {
    expect(DOT.me!.publicKey).toHaveLength(32);
  });

  it('DID encodes the public key', () => {
    const did = DOT.me!.did;
    const b64url = did.replace('dot:', '');
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
    const binary = atob(padded);
    const recovered = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) recovered[i] = binary.charCodeAt(i);
    expect(recovered).toEqual(DOT.me!.publicKey);
  });
});

// ---------------------------------------------------------------------------
// dot_create equivalent
// ---------------------------------------------------------------------------

describe('dot_create', () => {
  it('creates a 153-byte DOT', async () => {
    const bytes = await DOT.create({ WHAT: 'Hello, universe' });
    expect(bytes).toHaveLength(153);
  });

  it('chain grows with each DOT', async () => {
    const before = DOT.getChain()?.length ?? 0;
    await DOT.create({ WHAT: 'test' });
    const after = DOT.getChain()?.length ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it('empty WHAT creates a PING (153 bytes)', async () => {
    const bytes = await DOT.create({ WHAT: '' });
    expect(bytes).toHaveLength(153);
  });

  it('public key in DOT matches identity', async () => {
    const bytes = await DOT.create({ WHAT: 'keyed' });
    const pubKeyInDot = bytes.slice(0, 32);
    expect(pubKeyInDot).toEqual(DOT.me!.publicKey);
  });

  it('timestamp is recent', async () => {
    const bytes = await DOT.create({});
    const tsMs = Number(
      new DataView(bytes.buffer, bytes.byteOffset + 128, 8).getBigUint64(0, false)
    );
    expect(tsMs).toBeGreaterThan(Date.now() - 5000);
    expect(tsMs).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

// ---------------------------------------------------------------------------
// dot_seal equivalent
// ---------------------------------------------------------------------------

describe('dot_seal', () => {
  it('seal returns 48 bytes (BLS12-381 G1)', async () => {
    await DOT.create({ WHAT: 'seal test' });
    const seal = await DOT.seal(1);
    expect(seal).toHaveLength(48);
  });

  it('seal verifies correctly', async () => {
    await DOT.create({ WHAT: 'verify me' });
    const seal = await DOT.seal(1);
    const valid = await DOT.verifySeal(seal, 1);
    expect(valid).toBe(true);
  });

  it('tampered seal fails verification', async () => {
    await DOT.create({ WHAT: 'tamper test' });
    const seal = await DOT.seal(1);
    const tampered = new Uint8Array(seal);
    tampered[0] ^= 0xff; // flip bits
    const valid = await DOT.verifySeal(tampered, 1);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dot_stats equivalent
// ---------------------------------------------------------------------------

describe('dot_stats', () => {
  it('returns engine stats', () => {
    const stats = DOT.stats();
    expect(stats.totalDots).toBeGreaterThan(0);
    expect(stats.compressionRatio).toBeGreaterThanOrEqual(1);
    expect(typeof stats.relayConnected).toBe('boolean');
    expect(stats.relayConnected).toBe(false); // offline mode
  });
});

// ---------------------------------------------------------------------------
// dot_health equivalent
// ---------------------------------------------------------------------------

describe('dot_health', () => {
  it('returns health report', () => {
    const report = DOT.health();
    expect(['healthy', 'degraded', 'critical']).toContain(report.status);
    expect(report.uptimeMs).toBeGreaterThan(0);
    expect(Array.isArray(report.issues)).toBe(true);
    expect(Array.isArray(report.healingActions)).toBe(true);
  });

  it('offline mode is healthy (not degraded)', () => {
    const report = DOT.health();
    // Booted with offline:true — relay disconnect is expected, not a fault
    expect(report.status).toBe('healthy');
  });
});

// ---------------------------------------------------------------------------
// dot_verify equivalent
// ---------------------------------------------------------------------------

describe('dot_verify', () => {
  it('verifies own DOTs', async () => {
    const dotBytes = await DOT.create({ WHAT: 'verify this' });

    // Extract fields
    const publicKeyBytes = dotBytes.slice(0, 32);
    const signature = dotBytes.slice(32, 96);
    const signedData = new Uint8Array(153 - 64);
    signedData.set(dotBytes.slice(0, 32));
    signedData.set(dotBytes.slice(96), 32);

    const spkiPrefix = new Uint8Array([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const spki = new Uint8Array(spkiPrefix.length + 32);
    spki.set(spkiPrefix);
    spki.set(publicKeyBytes, spkiPrefix.length);

    const key = await crypto.subtle.importKey(
      'spki', spki.buffer as ArrayBuffer,
      { name: 'Ed25519' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'Ed25519', key,
      signature.buffer as ArrayBuffer,
      signedData.buffer as ArrayBuffer
    );
    expect(valid).toBe(true);
  });

  it('detects tampered payload', async () => {
    const dotBytes = await DOT.create({ WHAT: 'tamper me' });
    const tampered = new Uint8Array(dotBytes);
    tampered[140] ^= 0xff; // corrupt payload

    const publicKeyBytes = tampered.slice(0, 32);
    const signature = tampered.slice(32, 96);
    const signedData = new Uint8Array(153 - 64);
    signedData.set(tampered.slice(0, 32));
    signedData.set(tampered.slice(96), 32);

    const spkiPrefix = new Uint8Array([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const spki = new Uint8Array(spkiPrefix.length + 32);
    spki.set(spkiPrefix);
    spki.set(publicKeyBytes, spkiPrefix.length);

    const key = await crypto.subtle.importKey(
      'spki', spki.buffer as ArrayBuffer,
      { name: 'Ed25519' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'Ed25519', key,
      signature.buffer as ArrayBuffer,
      signedData.buffer as ArrayBuffer
    );
    expect(valid).toBe(false);
  });
});
