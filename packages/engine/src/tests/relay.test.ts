/**
 * relay.test.ts — unit tests for CHORUS relay transport
 *
 * Strategy: mock globalThis.WebSocket so RelayClient never hits the network.
 * The MockWS class simulates the CHORUS challenge-auth handshake and lets
 * tests inject server messages and inspect what the client sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRelay } from '../relay.js';
import { packFrame } from '@dot-protocol/relay';

// ---------------------------------------------------------------------------
// WebSocket Mock
// ---------------------------------------------------------------------------

// CHORUS protocol: server sends challenge → client sends auth → server sends authenticated
// Then client can subscribe / send binary frames.

const WS_OPEN = 1;
const WS_CLOSED = 3;

class MockWS {
  static instances: MockWS[] = [];
  static lastInstance: MockWS | null = null;

  url: string;
  readyState: number = WS_OPEN;
  binaryType: string = 'arraybuffer';

  // Event handlers (set by RelayClient)
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  // Spy: captures everything the client sent
  sent: Array<string | ArrayBuffer> = [];

  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
    MockWS.lastInstance = this;

    // Fire onopen asynchronously, then simulate CHORUS challenge
    Promise.resolve().then(() => {
      this.onopen?.();
      // Send challenge automatically (CHORUS always does this on connect)
      this._serverSend({ type: 'challenge', nonce: 'aabbccdd'.repeat(8) });
    });
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);

    // Auto-respond to auth message with 'authenticated'
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data) as Record<string, unknown>;
        if (msg['type'] === 'auth') {
          // Simulate successful auth
          Promise.resolve().then(() => {
            this._serverSend({ type: 'authenticated', pubHex: msg['pubHex'] });
          });
        }
      } catch { /* ignore */ }
    }
  }

  close(): void {
    this.readyState = WS_CLOSED;
    this.onclose?.();
  }

  /** Simulate a server → client text message */
  _serverSend(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Simulate a server → client binary frame (185 bytes) */
  _serverSendBinary(frame: Uint8Array): void {
    this.onmessage?.({ data: frame.buffer as ArrayBuffer });
  }

  /** Simulate server-side error / close */
  _serverClose(): void {
    this.readyState = WS_CLOSED;
    this.onclose?.();
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_PRIVATE_KEY = new Uint8Array(32).fill(1);
const TEST_PUBLIC_KEY  = new Uint8Array(32).fill(2);
const TEST_DID         = 'dot:' + Buffer.from(TEST_PUBLIC_KEY).toString('base64url');
const TEST_CHANNEL     = TEST_DID.slice(4); // strip 'dot:'

/** Make a deterministic 153-byte fake DOT */
function makeDot(fill = 0xab): Uint8Array {
  return new Uint8Array(153).fill(fill);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWS.instances = [];
  MockWS.lastInstance = null;
  // Install mock WebSocket globally
  (globalThis as Record<string, unknown>)['WebSocket'] = MockWS;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRelay', () => {

  // 1. createRelay() — creates without error
  it('creates without error', () => {
    expect(() => createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    })).not.toThrow();
  });

  // 2. connect() — opens WebSocket to the correct URL
  it('connect() opens WebSocket to the correct URL', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();
    expect(MockWS.lastInstance?.url).toBe('wss://dotdotdot.rocks');
    relay.disconnect();
  });

  // 3. connect() — sends subscription message with myDid channel after auth
  it('connect() subscribes to myDid channel after authentication', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const ws = MockWS.lastInstance!;
    const jsonMsgs = ws.sent
      .filter(m => typeof m === 'string')
      .map(m => JSON.parse(m as string) as Record<string, unknown>);

    const subMsg = jsonMsgs.find(m => m['type'] === 'subscribe');
    expect(subMsg).toBeDefined();
    expect(subMsg!['circleId']).toBe(TEST_CHANNEL);
    relay.disconnect();
  });

  // 4. connected property — false before connect, true after
  it('connected is false before connect and true after', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    expect(relay.connected).toBe(false);
    await relay.connect();
    expect(relay.connected).toBe(true);
    relay.disconnect();
  });

  // 5. broadcast() — sends a binary frame with correct structure
  it('broadcast() sends a 185-byte binary frame after connect', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const dot = makeDot(0xcc);
    await relay.broadcast(dot);

    const ws = MockWS.lastInstance!;
    const binMsgs = ws.sent.filter(m => m instanceof ArrayBuffer) as ArrayBuffer[];
    expect(binMsgs.length).toBeGreaterThan(0);

    const lastFrame = new Uint8Array(binMsgs[binMsgs.length - 1]!);
    expect(lastFrame.length).toBe(185);

    // Last 153 bytes should be the DOT
    const dotPart = lastFrame.slice(32);
    expect(dotPart).toEqual(dot);

    relay.disconnect();
  });

  // 6. send() — sends to a specific channel
  it('send() targets the specified channel in the frame', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const targetChannel = 'abc123targetcircle';
    const dot = makeDot(0xdd);
    await relay.send(dot, targetChannel);

    const ws = MockWS.lastInstance!;
    const binMsgs = ws.sent.filter(m => m instanceof ArrayBuffer) as ArrayBuffer[];
    expect(binMsgs.length).toBeGreaterThan(0);

    // Decode the circleId from the frame header (32 bytes, null-padded UTF-8)
    const frame = new Uint8Array(binMsgs[binMsgs.length - 1]!);
    const cidBytes = frame.slice(0, 32);
    const nullIdx = cidBytes.indexOf(0);
    const cid = new TextDecoder().decode(nullIdx === -1 ? cidBytes : cidBytes.slice(0, nullIdx));
    expect(cid).toBe(targetChannel);

    relay.disconnect();
  });

  // 7. onDot() — fires when server sends a binary frame
  it('onDot() fires when server sends a 185-byte frame', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const received: Array<{ dot: Uint8Array; channel: string }> = [];
    relay.onDot((dot, fromChannel) => received.push({ dot, channel: fromChannel }));

    const dot = makeDot(0xee);
    // packFrame encodes circleId into a 32-byte slot (null-padded, truncated at 32 chars).
    // TEST_CHANNEL is a 43-char base64url string; only the first 32 bytes survive round-trip.
    const frame = packFrame(TEST_CHANNEL, dot);
    MockWS.lastInstance!._serverSendBinary(frame);

    expect(received.length).toBe(1);
    expect(received[0]!.dot).toEqual(dot);
    // Channel is truncated to 32 bytes on wire — just confirm it starts with the same prefix
    expect(TEST_CHANNEL.startsWith(received[0]!.channel)).toBe(true);

    relay.disconnect();
  });

  // 8. onPeer() — callback is registered and callable
  it('onPeer() registers a callback without error', () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    const cb = vi.fn();
    expect(() => relay.onPeer(cb)).not.toThrow();
  });

  // 9. disconnect() — closes the WebSocket
  it('disconnect() closes the underlying WebSocket', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const ws = MockWS.lastInstance!;
    expect(ws.readyState).toBe(WS_OPEN);

    relay.disconnect();
    expect(ws.readyState).toBe(WS_CLOSED);
  });

  // 10. connected is false after disconnect()
  it('connected is false after disconnect()', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();
    expect(relay.connected).toBe(true);

    relay.disconnect();
    expect(relay.connected).toBe(false);
  });

  // 11. send() queues messages while disconnected, flushes on reconnect
  it('queues sends while disconnected and flushes on reconnect', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });

    // Not connected yet — send should queue
    const dot = makeDot(0xff);
    await relay.send(dot, TEST_CHANNEL); // queued

    expect(relay.connected).toBe(false);

    // Now connect — queue should flush
    await relay.connect();

    const ws = MockWS.lastInstance!;
    const binMsgs = ws.sent.filter(m => m instanceof ArrayBuffer) as ArrayBuffer[];
    expect(binMsgs.length).toBeGreaterThan(0);

    // Verify the queued dot arrived
    const frame = new Uint8Array(binMsgs[binMsgs.length - 1]!);
    expect(frame.slice(32)).toEqual(dot);

    relay.disconnect();
  });

  // 12. send() rejects non-153-byte input
  it('send() throws RangeError for non-153-byte DOT', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    await expect(relay.send(new Uint8Array(10), TEST_CHANNEL)).rejects.toThrow(RangeError);
    relay.disconnect();
  });

  // 13. multiple onDot handlers all fire
  it('multiple onDot handlers all fire', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const calls: string[] = [];
    relay.onDot(() => calls.push('a'));
    relay.onDot(() => calls.push('b'));

    const frame = packFrame(TEST_CHANNEL, makeDot());
    MockWS.lastInstance!._serverSendBinary(frame);

    expect(calls).toEqual(['a', 'b']);
    relay.disconnect();
  });

  // 14. auth message sent to relay (challenge-auth flow)
  it('sends auth message in response to challenge', async () => {
    const relay = createRelay({
      url: 'wss://dotdotdot.rocks',
      myDid: TEST_DID,
      privateKey: TEST_PRIVATE_KEY,
      publicKey: TEST_PUBLIC_KEY,
    });
    await relay.connect();

    const ws = MockWS.lastInstance!;
    const jsonMsgs = ws.sent
      .filter(m => typeof m === 'string')
      .map(m => JSON.parse(m as string) as Record<string, unknown>);

    const authMsg = jsonMsgs.find(m => m['type'] === 'auth');
    expect(authMsg).toBeDefined();
    expect(typeof authMsg!['pubHex']).toBe('string');
    expect(typeof authMsg!['sig']).toBe('string');

    relay.disconnect();
  });
});
