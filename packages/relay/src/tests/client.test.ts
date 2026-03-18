import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelayClient } from '../client.js';
import { FRAME_SIZE, DOT_SIZE, packFrame } from '../types.js';

// Mock WebSocket for testing the client state machine
class MockWS {
  readyState = 1; // OPEN
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = 'arraybuffer';

  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }

  // Helper: simulate receiving a JSON message from server
  receive(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  // Helper: simulate receiving binary frame
  receiveBinary(buf: ArrayBuffer) { this.onmessage?.({ data: buf }); }
  // Helper: trigger open
  open() { this.readyState = 1; this.onopen?.(); }
}

// Patch globalThis.WebSocket with MockWS
function withMockWS(fn: (mockWS: MockWS) => void | Promise<void>) {
  return async () => {
    const mockWS = new MockWS();
    const OrigWS = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = function() { return mockWS; };
    try {
      await fn(mockWS);
    } finally {
      (globalThis as Record<string, unknown>).WebSocket = OrigWS;
    }
  };
}

describe('RelayClient state machine', () => {
  it('starts disconnected', () => {
    const client = new RelayClient({ url: 'ws://localhost:8765' });
    expect(client.getStatus()).toBe('disconnected');
  });

  it('transitions to connecting then authenticating on connect', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false });

    const statuses: string[] = [];
    client.onStatus(s => statuses.push(s));
    client.connect(kp);
    mockWS.open();

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('authenticating');
  }));

  it('sends auth response to challenge', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false });

    client.connect(kp);
    mockWS.open();

    const nonce = '0'.repeat(64); // 32 zero bytes as hex
    mockWS.receive({ type: 'challenge', nonce });

    // Give async auth a tick to complete
    await new Promise(r => setTimeout(r, 50));

    const authMsg = mockWS.sent.find(s => typeof s === 'string' && s.includes('"auth"'));
    expect(authMsg).toBeDefined();
    const parsed = JSON.parse(authMsg as string);
    expect(parsed.type).toBe('auth');
    expect(parsed.pubHex).toBe(Array.from(kp.publicKey).map((b: number) => b.toString(16).padStart(2, '0')).join(''));
  }));

  it('transitions to connected after authenticated message', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    const statuses: string[] = [];
    client.onStatus(s => statuses.push(s));
    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    expect(client.getStatus()).toBe('connected');
  }));

  it('sendFrame returns false when not connected', () => {
    const client = new RelayClient({ url: 'ws://localhost:8765' });
    const dotBytes = new Uint8Array(DOT_SIZE).fill(1);
    expect(client.sendFrame('test-circle', dotBytes)).toBe(false);
  });

  it('calls frame handler on incoming binary frame', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    const received: Array<{ circleId: string; dotBytes: Uint8Array }> = [];
    client.onFrame((circleId, dotBytes) => received.push({ circleId, dotBytes }));

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    const dotBytes = new Uint8Array(DOT_SIZE).fill(0x42);
    const frame = packFrame('test-circle', dotBytes);
    mockWS.receiveBinary(frame.buffer as ArrayBuffer);

    expect(received).toHaveLength(1);
    expect(received[0]!.circleId).toBe('test-circle');
    expect(received[0]!.dotBytes).toEqual(dotBytes);
  }));

  it('subscribe sends subscribe message when connected', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    client.subscribe('my-circle');
    const subMsg = mockWS.sent.find(s => typeof s === 'string' && s.includes('"subscribe"'));
    expect(subMsg).toBeDefined();
  }));

  it('pre-connect subscribe is replayed after authentication', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    // Subscribe BEFORE connecting
    client.subscribe('early-bird-circle');

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    // Should have sent the subscribe after authentication
    const subMsg = mockWS.sent.find(s => typeof s === 'string' && s.includes('early-bird-circle'));
    expect(subMsg).toBeDefined();
  }));

  it('onFrame unsubscribe function removes handler', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    let callCount = 0;
    const unsubscribe = client.onFrame(() => callCount++);

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    const dotBytes = new Uint8Array(DOT_SIZE).fill(0x42);
    const frame = packFrame('c', dotBytes);
    mockWS.receiveBinary(frame.buffer as ArrayBuffer);
    expect(callCount).toBe(1);

    // Remove the handler
    unsubscribe();
    mockWS.receiveBinary(frame.buffer as ArrayBuffer);
    expect(callCount).toBe(1); // Should not increase
  }));
});
