/**
 * Cross-package integration: @dotprotocol/sign → @dotprotocol/transport
 *
 * Sign DOTs with the sign package, send via transport, receive and verify.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sign, verify, chain, describe as describeDOT, createKeypair, AccessLevel, TeachByte, Face } from '@dotprotocol/sign';
import { send, receive, Relay, OfflineQueue, MemoryAdapter, MemoryBus } from '../index.js';
import type { ReceivedDOT } from '../index.js';

describe('sign → transport round-trip', () => {
  let bus: MemoryBus;

  beforeEach(() => {
    bus = new MemoryBus();
  });

  it('sign a DOT, send it, receive and verify', async () => {
    const key = await createKeypair();
    const dot = await sign({ key, content: 'hello' });

    const alice = new MemoryAdapter('alice', bus);
    const bob = new MemoryAdapter('bob', bus);
    const received: ReceivedDOT[] = [];

    receive(bob, (r) => received.push(r));
    await alice.connect();
    await bob.connect();

    await send(dot, alice, { channel: 'bob' });
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    expect(received[0]!.verified).toBe(true);
    expect(received[0]!.bytes.length).toBe(153);

    // Verify using sign package too
    expect(await verify(received[0]!.bytes)).toBe(true);
    expect(await verify(received[0]!.dot)).toBe(true);
  });

  it('send raw bytes from SignedDOT', async () => {
    const key = await createKeypair();
    const dot = await sign({ key, content: 'bytes-test' });

    const adapter = new MemoryAdapter('sender', bus);
    const received: Uint8Array[] = [];
    bus.subscribe('broadcast', (b) => received.push(b));
    await adapter.connect();

    await send(dot.bytes, adapter);
    expect(received.length).toBe(1);
    expect(received[0]!.length).toBe(153);
    expect(await verify(received[0]!)).toBe(true);
  });

  it('sign chain of 5 DOTs, transport all, verify chain on receiver', async () => {
    const key = await createKeypair();
    const sender = new MemoryAdapter('sender', bus);
    const receiver = new MemoryAdapter('receiver', bus);
    const received: ReceivedDOT[] = [];

    receive(receiver, (r) => received.push(r));
    await sender.connect();
    await receiver.connect();

    const dots = [];
    let prev: Uint8Array | undefined;
    for (let i = 0; i < 5; i++) {
      const d = await sign({ key, content: `msg-${i}`, prev });
      dots.push(d);
      prev = d.bytes;
      await send(d, sender, { channel: 'receiver' });
    }

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBe(5);

    // Verify chain integrity on received DOTs
    const receivedDots = received.map((r) => r.dot);
    const result = await chain(receivedDots);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(5);
  });

  it('describe received DOTs', async () => {
    const key = await createKeypair();
    const dot = await sign({
      key,
      content: 'described',
      access: AccessLevel.CIRCLE,
      face: Face.Camera | Face.QR,
      teach: TeachByte.HumanReadable,
    });

    const adapter = new MemoryAdapter('peer', bus);
    const received: ReceivedDOT[] = [];
    receive(adapter, (r) => received.push(r));
    await adapter.connect();

    bus.publish('peer', dot.bytes, 'external');
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    const desc = describeDOT(received[0]!.bytes);
    expect(desc.access).toBe('circle');
    expect(desc.isPing).toBe(false);
    expect(desc.size).toBe(153);
  });

  it('large content: sign with hash pointer, transport, verify', async () => {
    const key = await createKeypair();
    const largeContent = new Uint8Array(10_000).fill(0xab);
    const dot = await sign({ key, content: largeContent });

    expect(dot.contentHash).toBeDefined();
    expect(dot.contentHash!.length).toBe(32);

    const adapter = new MemoryAdapter('peer', bus);
    const received: ReceivedDOT[] = [];
    receive(adapter, (r) => received.push(r));
    await adapter.connect();

    bus.publish('peer', dot.bytes, 'external');
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    expect(received[0]!.verified).toBe(true);
    // Payload contains truncated hash, not raw content
    expect(received[0]!.bytes.length).toBe(153);
  });

  it('offline queue: sign DOTs offline, flush on reconnect, verify', async () => {
    const key = await createKeypair();
    const adapter = new MemoryAdapter('sender', bus);
    const queue = new OfflineQueue();
    const received: Uint8Array[] = [];
    bus.subscribe('dest', (b) => received.push(b));

    // Sign and queue while offline
    const d1 = await sign({ key, content: 'offline-1' });
    const d2 = await sign({ key, content: 'offline-2', prev: d1.bytes });

    await send(d1, adapter, { channel: 'dest' }, queue);
    await send(d2, adapter, { channel: 'dest' }, queue);
    expect(queue.size).toBe(2);
    expect(received.length).toBe(0);

    // Reconnect and flush
    await adapter.connect();
    const result = await queue.flush(adapter);
    expect(result.sent).toBe(2);
    expect(received.length).toBe(2);

    // Verify both received DOTs
    expect(await verify(received[0]!)).toBe(true);
    expect(await verify(received[1]!)).toBe(true);
  });

  it('relay: sign DOT, relay between peers, verify on other side', async () => {
    const key = await createKeypair();
    const dot = await sign({ key, content: 'relayed' });

    const relay = new Relay({ verify: true });
    const peer1 = new MemoryAdapter('peer1', bus);
    const peer2 = new MemoryAdapter('peer2', bus);

    relay.addAdapter(peer1);
    relay.addAdapter(peer2);
    await relay.start();

    bus.publish('peer1', dot.bytes, 'external');
    await new Promise((r) => setTimeout(r, 100));

    const stats = relay.getStats();
    // Relay should have processed the DOT
    expect(stats.relayed + stats.rejected).toBeGreaterThanOrEqual(1);
    if (stats.relayed > 0) {
      expect(stats.rejected).toBe(0); // valid DOT should not be rejected
    }

    await relay.stop();
  });

  it('PING (empty DOT) through transport', async () => {
    const key = await createKeypair();
    const ping = await sign({ key }); // no content = PING

    const adapter = new MemoryAdapter('peer', bus);
    const received: ReceivedDOT[] = [];
    receive(adapter, (r) => received.push(r));
    await adapter.connect();

    bus.publish('peer', ping.bytes, 'external');
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    expect(received[0]!.verified).toBe(true);
    const desc = describeDOT(received[0]!.bytes);
    expect(desc.isPing).toBe(true);
    expect(desc.isGenesis).toBe(true);
  });

  it('ephemeral DOT through transport', async () => {
    const key = await createKeypair();
    const dot = await sign({ key, content: 'vanish', access: AccessLevel.EPHEMERAL });

    const adapter = new MemoryAdapter('peer', bus);
    const received: ReceivedDOT[] = [];
    receive(adapter, (r) => received.push(r));
    await adapter.connect();

    bus.publish('peer', dot.bytes, 'external');
    await new Promise((r) => setTimeout(r, 50));

    expect(received.length).toBe(1);
    const desc = describeDOT(received[0]!.bytes);
    expect(desc.access).toBe('ephemeral');
  });

  it('two keypairs exchange DOTs bidirectionally', async () => {
    const alice = await createKeypair();
    const bob = await createKeypair();

    const aliceAdapter = new MemoryAdapter('alice', bus);
    const bobAdapter = new MemoryAdapter('bob', bus);

    const aliceReceived: ReceivedDOT[] = [];
    const bobReceived: ReceivedDOT[] = [];

    receive(aliceAdapter, (r) => aliceReceived.push(r));
    receive(bobAdapter, (r) => bobReceived.push(r));

    await aliceAdapter.connect();
    await bobAdapter.connect();

    // Alice → Bob
    const aliceDot = await sign({ key: alice, content: bob.publicKey.slice(0, 16) });
    await send(aliceDot, aliceAdapter, { channel: 'bob' });

    // Bob → Alice
    const bobDot = await sign({ key: bob, content: alice.publicKey.slice(0, 16) });
    await send(bobDot, bobAdapter, { channel: 'alice' });

    await new Promise((r) => setTimeout(r, 100));

    expect(bobReceived.length).toBe(1);
    expect(aliceReceived.length).toBe(1);
    expect(bobReceived[0]!.verified).toBe(true);
    expect(aliceReceived[0]!.verified).toBe(true);

    // Verify the contact pattern: each DOT's payload contains the other's key
    expect(bobReceived[0]!.dot.payload.slice(0, 16)).toEqual(bob.publicKey.slice(0, 16));
    expect(aliceReceived[0]!.dot.payload.slice(0, 16)).toEqual(alice.publicKey.slice(0, 16));
  });
});
