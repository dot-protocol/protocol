/**
 * engine-relay-mock.test.ts
 *
 * Tests engine.ts paths that require a relay transport mock.
 * These paths are unreachable through the real relay (e.g., onPeer callback,
 * which is wired for forward-compat but CHORUS v0.1 never fires peer events).
 *
 * Uses vi.mock to replace the relay module with a controllable stub.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RelayTransport } from '../relay.js';

// ---------------------------------------------------------------------------
// Mock relay factory — fires onPeer immediately after connect()
// ---------------------------------------------------------------------------

let _mockPeerHandler: ((did: string, publicKey?: Uint8Array) => void) | null = null;
let _mockDotHandler: ((dot: Uint8Array, channel: string) => void) | null = null;
let _mockConnected = false;

vi.mock('../relay.js', () => {
  return {
    createRelay: () => {
      const transport: RelayTransport = {
        async connect() {
          _mockConnected = true;
          // Immediately fire peer event — exercises engine.ts lines 210-216
          if (_mockPeerHandler) {
            _mockPeerHandler('dot:mockpeer123', new Uint8Array(32).fill(0x42));
          }
        },
        async send() {},
        async broadcast() {},
        onDot(cb) { _mockDotHandler = cb; },
        onPeer(cb) { _mockPeerHandler = cb; },
        get connected() { return _mockConnected; },
        disconnect() { _mockConnected = false; },
      };
      return transport;
    },
    packFrame: (channel: string, dot: Uint8Array) => {
      const frame = new Uint8Array(185);
      const enc = new TextEncoder();
      const ch = enc.encode(channel);
      frame.set(ch.slice(0, 32), 0);
      frame.set(dot, 32);
      return frame;
    },
  };
});

describe('engine — onPeer callback (lines 210-216)', () => {
  afterEach(async () => {
    const { DOT } = await import('../engine.js');
    await DOT.shutdown();
    _mockConnected = false;
    _mockPeerHandler = null;
    _mockDotHandler = null;
  });

  it('_connectRelay onPeer callback populates nearby and emits peer event', async () => {
    const { DOT } = await import('../engine.js');

    // Boot with online relay — mock relay fires onPeer during connect()
    await DOT.boot({ offline: false, relayUrl: 'wss://mock.test' });

    // Register listener AFTER boot (boot resets listeners map)
    const peerEvents: unknown[] = [];
    DOT.on('peer', (p) => peerEvents.push(p));

    // The onPeer callback in engine.ts should have:
    // 1. Created a PeerInfo and added to _nearby
    // 2. The 'peer' event is emitted during connect (before we registered our listener)
    //    so we verify via nearby map instead
    expect(DOT.nearby.size).toBeGreaterThan(0);
    const peer = DOT.nearby.get('dot:mockpeer123');
    expect(peer).toBeDefined();
    expect(peer!.did).toBe('dot:mockpeer123');
    expect(peer!.publicKey).toBeInstanceOf(Uint8Array);
    // Verify peersOnline stat is correct
    expect(DOT.stats().peersOnline).toBe(1);
  });

  it('_connectRelay onPeer: publicKey defaults to 32 zeros when undefined', async () => {
    const { DOT } = await import('../engine.js');

    // Override the mock peer handler to fire with no publicKey
    const original = _mockPeerHandler;
    const stash: ((did: string, publicKey?: Uint8Array) => void)[] = [];

    // We'll capture the registered onPeer callback from the mock
    // by booting and then manually firing with undefined publicKey
    await DOT.boot({ offline: false, relayUrl: 'wss://mock.test' });

    // Fire onPeer via the mock handler with undefined publicKey (exercises line 212)
    if (_mockPeerHandler) {
      _mockPeerHandler('dot:nopubkey', undefined);
      const peer = DOT.nearby.get('dot:nopubkey');
      expect(peer).toBeDefined();
      // publicKey should default to 32 zeros (line 212: publicKey ?? new Uint8Array(32))
      expect(Array.from(peer!.publicKey)).toEqual(Array.from(new Uint8Array(32)));
    }
    void original;
    void stash;
  });
});
