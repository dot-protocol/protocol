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

  it('sendFrame sends packed frame when connected (covers lines 95-97)', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    expect(client.getStatus()).toBe('connected');
    const dotBytes = new Uint8Array(DOT_SIZE).fill(0xAA);
    const result = client.sendFrame('my-circle', dotBytes);

    expect(result).toBe(true);
    // Last sent item should be an ArrayBuffer (the packed frame)
    const lastSent = mockWS.sent[mockWS.sent.length - 1];
    expect(lastSent instanceof ArrayBuffer).toBe(true);
    expect((lastSent as ArrayBuffer).byteLength).toBe(FRAME_SIZE);
  }));

  it('unsubscribe sends unsubscribe message when connected (covers lines 86-88)', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    // Subscribe first
    client.subscribe('my-circle');
    // Then unsubscribe — should send unsubscribe message
    client.unsubscribe('my-circle');

    const unsubMsg = mockWS.sent.find(s => typeof s === 'string' && s.includes('"unsubscribe"'));
    expect(unsubMsg).toBeDefined();
    const parsed = JSON.parse(unsubMsg as string);
    expect(parsed.type).toBe('unsubscribe');
    expect(parsed.circleId).toBe('my-circle');
  }));

  it('ping interval fires and sends ping (covers lines 138-140)', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    // Use a very short ping interval so the timer fires during the test
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 50 });

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    expect(client.getStatus()).toBe('connected');

    // Wait for the ping interval to fire (> 50ms)
    await new Promise(r => setTimeout(r, 120));

    const pingMsg = mockWS.sent.find(s => typeof s === 'string' && s.includes('"ping"'));
    expect(pingMsg).toBeDefined();
    const parsed = JSON.parse(pingMsg as string);
    expect(parsed.type).toBe('ping');

    client.disconnect();
  }));

  it('onclose clears ping timer and disconnects (covers lines 149-151)', withMockWS(async (mockWS) => {
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

    // Simulate server closing the connection
    mockWS.close();
    await new Promise(r => setTimeout(r, 10));

    expect(client.getStatus()).toBe('disconnected');
    expect(statuses).toContain('disconnected');
  }));

  it('reconnects after disconnect when reconnect=true (covers lines 151-153)', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    // Short reconnect delay so the test doesn't take long
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: true, reconnectDelayMs: 50, pingIntervalMs: 999999 });

    const statuses: string[] = [];
    client.onStatus(s => statuses.push(s));

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    // Simulate server closing — should trigger reconnect
    mockWS.close();
    await new Promise(r => setTimeout(r, 10));

    expect(statuses).toContain('disconnected');

    // After reconnect delay, _open() is called again → status goes to 'connecting'
    await new Promise(r => setTimeout(r, 100));
    expect(statuses).toContain('connecting');

    client.disconnect();
  }));

  it('onStatus unsubscribe removes handler', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    let callCount = 0;
    const unsubscribe = client.onStatus(() => callCount++);
    unsubscribe();

    client.connect(kp);
    mockWS.open();

    // Status changed but handler was removed — count should stay 0
    expect(callCount).toBe(0);
  }));

  it('ignores incoming binary frame with wrong size', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    let frameCount = 0;
    client.onFrame(() => frameCount++);

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    // Send a binary frame that is NOT FRAME_SIZE bytes — should be silently ignored
    const wrongFrame = new ArrayBuffer(100);
    mockWS.receiveBinary(wrongFrame);
    await new Promise(r => setTimeout(r, 10));

    expect(frameCount).toBe(0);
  }));

  it('ignores malformed JSON text messages', withMockWS(async (mockWS) => {
    const { createKeypair } = await import('@dot-protocol/core');
    const kp = await createKeypair();
    const client = new RelayClient({ url: 'ws://localhost:8765', reconnect: false, pingIntervalMs: 999999 });

    client.connect(kp);
    mockWS.open();
    mockWS.receive({ type: 'authenticated', pubHex: 'abc' });
    await new Promise(r => setTimeout(r, 10));

    // Send malformed JSON — should not crash
    mockWS.onmessage?.({ data: 'this is not json {{{' });
    await new Promise(r => setTimeout(r, 10));

    expect(client.getStatus()).toBe('connected');
  }));
});
