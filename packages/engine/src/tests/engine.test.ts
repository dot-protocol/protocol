import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOT } from '../engine.js';

describe('DOT engine', () => {
  beforeEach(async () => {
    await DOT.boot({ offline: true });
  });

  afterEach(async () => {
    await DOT.shutdown();
  });

  it('boots and creates identity', () => {
    expect(DOT.me).not.toBeNull();
    expect(DOT.me!.publicKey).toHaveLength(32);
    expect(DOT.me!.did).toMatch(/^dot:/);
  });

  it('DOT.create() returns 153-byte DOT', async () => {
    const dot = await DOT.create({ WHAT: 'Hello, universe' });
    expect(dot).toHaveLength(153);
  });

  it('created DOT is signed (verifiable)', async () => {
    const { verifyDOT, fromBytes } = await import('@dotprotocol/core');
    const dot = await DOT.create({ WHAT: 'test' });
    const parsed = fromBytes(dot);
    expect(await verifyDOT(parsed)).toBe(true);
  });

  it('chain grows with each DOT', async () => {
    await DOT.create({ WHAT: 'msg1' });
    await DOT.create({ WHAT: 'msg2' });
    const chain = DOT.chains.get(DOT.me!.did);
    expect(chain?.length).toBeGreaterThanOrEqual(2);
  });

  it('chain is properly linked (second DOT has correct chain hash)', async () => {
    const { fromBytes } = await import('@dotprotocol/core');
    const dot1 = await DOT.create({ WHAT: 'first' });
    const dot2 = await DOT.create({ WHAT: 'second' });

    // chain field of dot2 should be SHA-256(dot1)
    const toArrayBuffer = (u8: Uint8Array): ArrayBuffer =>
      u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
        ? (u8.buffer as ArrayBuffer)
        : u8.slice(0).buffer as ArrayBuffer;

    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(dot1)));
    const dot2Parsed = fromBytes(dot2);
    expect(Array.from(dot2Parsed.chain)).toEqual(Array.from(hash));
  });

  it('DOT.stats() returns meaningful data after creating DOTs', async () => {
    await DOT.create({ WHAT: 'a' });
    await DOT.create({ WHAT: 'b' });
    const s = DOT.stats();
    expect(s.totalDots).toBeGreaterThanOrEqual(2);
    expect(s.totalRawBytes).toBeGreaterThanOrEqual(2 * 153);
  });

  it('large WHAT gets hashed to 16B (DOT still 153 bytes)', async () => {
    const largePayload = 'x'.repeat(1000);
    const dot = await DOT.create({ WHAT: largePayload });
    expect(dot).toHaveLength(153);
  });

  it('events fire on DOT creation', async () => {
    return new Promise<void>((resolve) => {
      DOT.on('dot', (receivedDot) => {
        expect((receivedDot as Uint8Array)).toHaveLength(153);
        resolve();
      });
      void DOT.create({ WHAT: 'event test' });
    });
  });

  it('genesis DOT has 32 zero bytes in chain field', async () => {
    const { fromBytes } = await import('@dotprotocol/core');
    const dot = await DOT.create({ WHAT: 'genesis' });
    const parsed = fromBytes(dot);
    expect([...parsed.chain].every(b => b === 0)).toBe(true);
  });

  it('stats.relayConnected is false in offline mode', () => {
    expect(DOT.stats().relayConnected).toBe(false);
  });

  it('can create a PING (no payload)', async () => {
    const dot = await DOT.create({});
    expect(dot).toHaveLength(153);
    const { fromBytes } = await import('@dotprotocol/core');
    const parsed = fromBytes(dot);
    expect([...parsed.payload].every(b => b === 0)).toBe(true);
  });

  it('multiple boots reset state cleanly', async () => {
    await DOT.create({ WHAT: 'before reset' });
    const did1 = DOT.me!.did;

    // shutdown and re-boot creates fresh identity
    await DOT.shutdown();
    await DOT.boot({ offline: true });

    // A new identity will have the same or different DID — but chains reset
    const chain = DOT.chains.get(DOT.me!.did);
    expect(chain?.length ?? 0).toBe(0);
    void did1; // silence unused var warning
  });

  it('DOT.seal() returns a 48-byte BLS aggregate signature', async () => {
    for (let i = 0; i < 5; i++) await DOT.create({ WHAT: `msg${i}` });
    const seal = await DOT.seal(5);
    expect(seal).toHaveLength(48);
  });

  it('DOT.seal(0) returns empty seal for no DOTs', async () => {
    const seal = await DOT.seal(0);
    expect(seal).toBeInstanceOf(Uint8Array);
  });

  it('verifySeal() returns true for a valid seal', async () => {
    for (let i = 0; i < 5; i++) await DOT.create({ WHAT: `vseal${i}` });
    const seal = await DOT.seal(5);
    const valid = await DOT.verifySeal(seal, 5);
    expect(valid).toBe(true);
  });

  it('verifySeal() returns false for tampered seal', async () => {
    for (let i = 0; i < 3; i++) await DOT.create({ WHAT: `tamper${i}` });
    const seal = await DOT.seal(3);
    const tampered = new Uint8Array(seal);
    tampered[0] ^= 0xFF;
    const valid = await DOT.verifySeal(tampered, 3);
    expect(valid).toBe(false);
  });

  it('stats() tracks seal count', async () => {
    for (let i = 0; i < 5; i++) await DOT.create({ WHAT: `sc${i}` });
    await DOT.seal(5);
    const stats = DOT.stats();
    expect(stats.sealCount).toBeGreaterThanOrEqual(1);
  });
});
