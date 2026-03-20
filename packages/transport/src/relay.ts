/**
 * @dotprotocol/transport — Relay
 *
 * Stateless relay: passes DOTs without understanding, storing, or tracking them.
 * Nostr model: dumb relays, smart clients.
 */

import { verifyDOT, fromBytes, DOT_SIZE } from '@dotprotocol/core';
import type { RelayOptions, RelayStats, TransportAdapter } from './types.js';

export class Relay {
  private opts: Required<RelayOptions>;
  private stats: RelayStats;
  private adapters: TransportAdapter[] = [];
  private unsubscribes: Array<() => void> = [];
  private startTime: number = 0;
  private rateBucket: number = 0;
  private rateLast: number = 0;

  constructor(opts?: RelayOptions) {
    this.opts = {
      verify: opts?.verify ?? true,
      read: opts?.read ?? false,
      maxRate: opts?.maxRate ?? 0,
    };
    this.stats = { relayed: 0, rejected: 0, peers: 0, uptime: 0 };
  }

  /** Add a transport adapter to the relay */
  addAdapter(adapter: TransportAdapter): void {
    this.adapters.push(adapter);
    this.stats.peers++;

    const unsub = adapter.onReceive((bytes, source) => {
      void this.handleIncoming(bytes, source);
    });
    this.unsubscribes.push(unsub);
  }

  /** Start relaying */
  async start(): Promise<void> {
    this.startTime = Date.now();
    for (const adapter of this.adapters) {
      await adapter.connect();
    }
  }

  /** Stop relaying */
  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    for (const adapter of this.adapters) {
      await adapter.disconnect();
    }
  }

  /** Get relay statistics */
  getStats(): RelayStats {
    return {
      ...this.stats,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  private async handleIncoming(bytes: Uint8Array, source: string): Promise<void> {
    // Rate limiting
    if (this.opts.maxRate > 0) {
      const now = Date.now();
      if (now - this.rateLast >= 1000) {
        this.rateBucket = 0;
        this.rateLast = now;
      }
      if (this.rateBucket >= this.opts.maxRate) {
        this.stats.rejected++;
        return;
      }
      this.rateBucket++;
    }

    // Size check
    if (bytes.length !== DOT_SIZE) {
      this.stats.rejected++;
      return;
    }

    // Verify if configured
    if (this.opts.verify) {
      try {
        const dot = fromBytes(bytes);
        const valid = await verifyDOT(dot);
        if (!valid) {
          this.stats.rejected++;
          return;
        }
      } catch {
        this.stats.rejected++;
        return;
      }
    }

    // Relay to all other adapters (don't echo back to source)
    for (const adapter of this.adapters) {
      if (adapter.state === 'connected') {
        try {
          await adapter.send(bytes, source);
        } catch {
          // Best-effort delivery
        }
      }
    }

    this.stats.relayed++;
  }
}
