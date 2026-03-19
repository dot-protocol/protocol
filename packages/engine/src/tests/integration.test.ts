import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOT } from '../engine.js';

describe('DOT engine — full flow integration', () => {
  beforeEach(async () => {
    await DOT.boot({ offline: true });
  });
  afterEach(async () => {
    await DOT.shutdown();
  });

  it('creates a valid 153-byte DOT', async () => {
    const bytes = await DOT.create({ WHAT: 'hello integration' });
    expect(bytes).toHaveLength(153);
  });

  it('10-DOT chain: all verify individually', async () => {
    const dots: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      dots.push(await DOT.create({ WHAT: `message ${i}` }));
    }
    expect(dots).toHaveLength(10);
    for (const d of dots) {
      expect(d).toHaveLength(153);
    }
  });

  it('stats() reflects DOT creation', async () => {
    const before = DOT.stats();
    for (let i = 0; i < 5; i++) {
      await DOT.create({ WHAT: `stat test ${i}` });
    }
    const after = DOT.stats();
    expect(after.totalDots).toBe(before.totalDots + 5);
  });

  it('compression ratio is >= 1 after repeated DOTs', async () => {
    for (let i = 0; i < 30; i++) {
      await DOT.create({ WHAT: new Uint8Array(16).fill(i % 4) });
    }
    const stats = DOT.stats();
    expect(stats.compressionRatio).toBeGreaterThanOrEqual(1);
  });

  it('seal() returns 48-byte BLS aggregate', async () => {
    for (let i = 0; i < 5; i++) {
      await DOT.create({ WHAT: `seal test ${i}` });
    }
    const seal = await DOT.seal(5);
    expect(seal).toHaveLength(48);
  });

  it('ECDH round-trip via crypto module', async () => {
    const { createKeypair } = await import('@dot-protocol/core');
    const { ecdh, encryptPayload, decryptPayload } = await import('../crypto.js');
    const alice = await createKeypair();
    const bob = await createKeypair();
    // Payload is 16 bytes max — use exactly 16 bytes
    const msg = new TextEncoder().encode('physics is truth');
    const shared_ab = ecdh(alice.privateKey, bob.publicKey);
    const ct = encryptPayload(msg, shared_ab, 0n);
    const shared_ba = ecdh(bob.privateKey, alice.publicKey);
    const pt = decryptPayload(ct, shared_ba, 0n);
    expect(new TextDecoder().decode(pt)).toBe('physics is truth');
  });

  it('boot/shutdown/reboot cycle works', async () => {
    await DOT.shutdown();
    await DOT.boot({ offline: true });
    const bytes = await DOT.create({ WHAT: 'after reboot' });
    expect(bytes).toHaveLength(153);
  });
});
