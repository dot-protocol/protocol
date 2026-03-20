/**
 * @dotprotocol/transport — Offline queue
 *
 * DOTs queue locally when transport is disconnected, sync on reconnect.
 */

import type { QueuedDOT, TransportAdapter } from './types.js';

export class OfflineQueue {
  private queue: QueuedDOT[] = [];
  private maxSize: number;
  private maxRetries: number;

  constructor(opts?: { maxSize?: number; maxRetries?: number }) {
    this.maxSize = opts?.maxSize ?? 10_000;
    this.maxRetries = opts?.maxRetries ?? 5;
  }

  /** Add a DOT to the queue */
  enqueue(bytes: Uint8Array, destination: string, channel?: string): void {
    if (this.queue.length >= this.maxSize) {
      // Drop oldest entry
      this.queue.shift();
    }
    this.queue.push({
      bytes: new Uint8Array(bytes),
      destination,
      channel,
      queuedAt: Date.now(),
      retries: 0,
    });
  }

  /** Flush all queued DOTs through the adapter */
  async flush(adapter: TransportAdapter): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const remaining: QueuedDOT[] = [];

    for (const entry of this.queue) {
      try {
        await adapter.send(entry.bytes, entry.destination);
        sent++;
      } catch {
        entry.retries++;
        if (entry.retries < this.maxRetries) {
          remaining.push(entry);
        }
        failed++;
      }
    }

    this.queue = remaining;
    return { sent, failed };
  }

  /** Number of queued DOTs */
  get size(): number {
    return this.queue.length;
  }

  /** Peek at queued entries (read-only) */
  peek(): ReadonlyArray<Readonly<QueuedDOT>> {
    return this.queue;
  }

  /** Clear the queue */
  clear(): void {
    this.queue = [];
  }
}
