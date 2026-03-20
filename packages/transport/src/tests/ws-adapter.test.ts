/**
 * @dotprotocol/transport — WebSocket adapter tests
 *
 * Tests state management, configuration, and error handling.
 * Uses a mock WebSocket since we can't start a real server in unit tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketAdapter } from '../ws-adapter.js';

// Mock WebSocket for Node.js test environment
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  readyState = 0; // CONNECTING
  sent: Uint8Array[] = [];
  closed = false;
  url: string;
  protocols?: string[];

  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
    // Auto-open on next tick
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 0);
  }

  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }

  // Helpers for tests
  simulateMessage(data: ArrayBuffer) {
    this.onmessage?.({ data });
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateError() {
    this.onerror?.();
  }
}

describe('WebSocketAdapter', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
  });

  it('starts disconnected', () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    expect(adapter.state).toBe('disconnected');
    expect(adapter.type).toBe('websocket');
  });

  it('connects and transitions to connected state', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    await adapter.connect();
    expect(adapter.state).toBe('connected');
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('disconnects cleanly', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    await adapter.connect();
    await adapter.disconnect();
    expect(adapter.state).toBe('disconnected');
    expect(MockWebSocket.instances[0]!.closed).toBe(true);
  });

  it('sends 153-byte DOT frames', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    await adapter.connect();

    const dot = new Uint8Array(153).fill(0x42);
    await adapter.send(dot, 'dest');

    expect(MockWebSocket.instances[0]!.sent.length).toBe(1);
    expect(MockWebSocket.instances[0]!.sent[0]!.length).toBe(153);
  });

  it('rejects non-153-byte sends', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    await adapter.connect();

    await expect(adapter.send(new Uint8Array(100), 'dest'))
      .rejects.toThrow('DOT must be 153 bytes');
  });

  it('throws when sending while disconnected', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    await expect(adapter.send(new Uint8Array(153), 'dest'))
      .rejects.toThrow('WebSocket not connected');
  });

  it('receives 153-byte binary frames', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    const received: Uint8Array[] = [];
    adapter.onReceive((bytes) => received.push(bytes));

    await adapter.connect();
    const ws = MockWebSocket.instances[0]!;

    const dot = new Uint8Array(153).fill(0xab);
    ws.simulateMessage(dot.buffer);

    expect(received.length).toBe(1);
    expect(received[0]!.length).toBe(153);
  });

  it('ignores non-153-byte frames', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    const received: Uint8Array[] = [];
    adapter.onReceive((bytes) => received.push(bytes));

    await adapter.connect();
    const ws = MockWebSocket.instances[0]!;

    ws.simulateMessage(new Uint8Array(100).buffer);
    ws.simulateMessage(new Uint8Array(200).buffer);

    expect(received.length).toBe(0);
  });

  it('onReceive returns unsubscribe function', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    let count = 0;
    const unsub = adapter.onReceive(() => count++);

    await adapter.connect();
    const ws = MockWebSocket.instances[0]!;

    ws.simulateMessage(new Uint8Array(153).buffer);
    expect(count).toBe(1);

    unsub();
    ws.simulateMessage(new Uint8Array(153).buffer);
    expect(count).toBe(1);
  });

  it('passes peerId as WebSocket subprotocol', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example', peerId: 'my-peer' });
    await adapter.connect();
    expect(MockWebSocket.instances[0]!.protocols).toEqual(['my-peer']);
  });

  it('no-op on double connect', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    await adapter.connect();
    await adapter.connect(); // should not create a second WebSocket
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('handles connection failure', async () => {
    // Override MockWebSocket to fail
    (globalThis as any).WebSocket = class FailSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: any = null;
      binaryType = 'arraybuffer';
      constructor() {
        setTimeout(() => this.onerror?.(), 0);
      }
      close() {}
    };

    const adapter = new WebSocketAdapter({ url: 'wss://bad.example', reconnect: false });
    await expect(adapter.connect()).rejects.toThrow('WebSocket connection failed');
    expect(adapter.state).toBe('error');
  });

  it('reconnect disabled prevents auto-reconnect', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example', reconnect: false });
    await adapter.connect();
    const ws = MockWebSocket.instances[0]!;

    ws.simulateClose();
    expect(adapter.state).toBe('disconnected');

    // Wait a bit — should NOT try to reconnect
    await new Promise((r) => setTimeout(r, 100));
    expect(MockWebSocket.instances.length).toBe(1); // no new connection attempts
  });

  it('disconnect cancels reconnect', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example', reconnect: true, reconnectDelay: 50 });
    await adapter.connect();
    const ws = MockWebSocket.instances[0]!;

    // Simulate unexpected close — would trigger reconnect
    ws.simulateClose();

    // Immediately disconnect intentionally
    await adapter.disconnect();

    // Wait longer than reconnect delay
    await new Promise((r) => setTimeout(r, 200));
    // Should not have tried to reconnect after intentional disconnect
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('supports multiple receive handlers', async () => {
    const adapter = new WebSocketAdapter({ url: 'wss://test.example' });
    let count1 = 0;
    let count2 = 0;
    adapter.onReceive(() => count1++);
    adapter.onReceive(() => count2++);

    await adapter.connect();
    MockWebSocket.instances[0]!.simulateMessage(new Uint8Array(153).buffer);

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});
