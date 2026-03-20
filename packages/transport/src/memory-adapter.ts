/**
 * @dotprotocol/transport — In-memory transport adapter
 *
 * For testing and local communication between DOT endpoints.
 * Uses an EventTarget-based bus to deliver DOTs.
 */

import type { TransportAdapter, TransportState, TransportType } from './types.js';

type ReceiveHandler = (bytes: Uint8Array, source: string) => void;

/** Shared in-memory bus for test/local communication */
export class MemoryBus {
  private listeners = new Map<string, Set<ReceiveHandler>>();

  subscribe(address: string, handler: ReceiveHandler): () => void {
    if (!this.listeners.has(address)) {
      this.listeners.set(address, new Set());
    }
    this.listeners.get(address)!.add(handler);
    return () => {
      this.listeners.get(address)?.delete(handler);
    };
  }

  publish(address: string, bytes: Uint8Array, source: string): void {
    const handlers = this.listeners.get(address);
    if (handlers) {
      for (const handler of handlers) {
        handler(bytes, source);
      }
    }
  }

  /** Broadcast to all addresses */
  broadcast(bytes: Uint8Array, source: string): void {
    for (const [, handlers] of this.listeners) {
      for (const handler of handlers) {
        handler(bytes, source);
      }
    }
  }

  /** Number of subscribed addresses */
  get addressCount(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Default shared bus instance */
export const defaultBus = new MemoryBus();

/** In-memory transport adapter */
export class MemoryAdapter implements TransportAdapter {
  readonly type: TransportType = 'memory';
  private _state: TransportState = 'disconnected';
  private handlers: ReceiveHandler[] = [];
  private unsubscribes: Array<() => void> = [];
  private bus: MemoryBus;
  private address: string;

  constructor(address: string, bus?: MemoryBus) {
    this.address = address;
    this.bus = bus ?? defaultBus;
  }

  get state(): TransportState {
    return this._state;
  }

  async send(bytes: Uint8Array, destination: string): Promise<void> {
    if (this._state !== 'connected') {
      throw new Error('Transport not connected');
    }
    this.bus.publish(destination, bytes, this.address);
  }

  onReceive(handler: ReceiveHandler): () => void {
    this.handlers.push(handler);
    if (this._state === 'connected') {
      const unsub = this.bus.subscribe(this.address, handler);
      this.unsubscribes.push(unsub);
    }
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    this._state = 'connected';
    // Subscribe all registered handlers
    for (const handler of this.handlers) {
      const unsub = this.bus.subscribe(this.address, handler);
      this.unsubscribes.push(unsub);
    }
  }

  async disconnect(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    this._state = 'disconnected';
  }
}
