/**
 * DOT Engine — The Universe
 *
 * One singleton. One boot. Physics runs automatically.
 *
 *   import { DOT } from '@dot-protocol/engine';
 *   await DOT.boot({ offline: true });
 *   const bytes = await DOT.create({ WHAT: 'Hello, universe' }); // 153 bytes
 *
 * Physics that auto-apply on every DOT.create():
 *   - Ed25519 signing (device identity)
 *   - SHA-256 chain linking (append-only worldline)
 *   - LinearPredictor (compression stats)
 *   - Event emission (on('dot', cb))
 *
 * Relay (Phase 2): WebSocket to CHORUS relay, peer discovery.
 */

import { getOrCreateIdentity, resetIdentityCache } from './identity.js';
import { createDotPhysics } from './physics.js';
import { createChain } from './chain.js';
import type { DotIdentity, FullIdentity } from './identity.js';
import type { Chain } from './chain.js';
import type { Datom, PhysicsStats } from './physics.js';

export type { Datom, PhysicsStats };
export type { DotIdentity };
export type { Chain };

export interface EngineOptions {
  /** CHORUS relay WebSocket URL. Default: 'wss://dotdotdot.rocks' */
  relayUrl?: string;
  /** If true, skip relay connection entirely. Good for unit tests. */
  offline?: boolean;
}

export interface PeerInfo {
  did: string;
  publicKey: Uint8Array;
  lastSeen: number;
}

export interface EngineStats extends PhysicsStats {
  relayConnected: boolean;
  peersOnline: number;
}

type EventMap = {
  dot: [dot: Uint8Array, from: string];
  peer: [peer: PeerInfo];
  chain: [chain: Chain];
  ready: [];
};

export interface EngineAPI {
  /** Boot the engine. Creates identity, initialises chains, optionally connects relay. */
  boot(options?: EngineOptions): Promise<void>;

  /** This device's identity (null before boot). */
  readonly me: DotIdentity | null;

  /** Discovered peers seen on relay. */
  readonly nearby: Map<string, PeerInfo>;

  /** Active chains keyed by chain ID (= DID). */
  readonly chains: Map<string, Chain>;

  /**
   * Create a DOT. Physics auto-apply:
   *   sign → chain → predict → emit
   * Returns raw 153-byte Uint8Array.
   */
  create(datom: Datom): Promise<Uint8Array>;

  /** Get the active chain for own identity (or by recipient DID). */
  getChain(recipientDid?: string): Chain | undefined;

  /** Subscribe to engine events. */
  on<E extends keyof EventMap>(event: E, cb: (...args: EventMap[E]) => void): void;

  /** Emit an event (exposed for relay layer). */
  emit<E extends keyof EventMap>(event: E, ...args: EventMap[E]): void;

  /** Current stats. */
  stats(): EngineStats;

  /** Shut down: disconnect relay, reset all state. Safe to boot() again. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal state (closure-scoped singleton)
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

let _identity: FullIdentity | null = null;
let _physics: ReturnType<typeof createDotPhysics> | null = null;
let _chains: Map<string, Chain> = new Map();
let _nearby: Map<string, PeerInfo> = new Map();
let _listeners: Map<string, Handler[]> = new Map();
let _booted = false;
let _relayConnected = false;
let _relay: WebSocket | null = null;

function _emit<E extends keyof EventMap>(event: E, ...args: EventMap[E]): void {
  const handlers = _listeners.get(event);
  if (handlers) {
    for (const h of handlers) h(...(args as unknown[]));
  }
}

function _resetState(): void {
  _identity = null;
  _physics = null;
  _chains = new Map();
  _nearby = new Map();
  _listeners = new Map();
  _relayConnected = false;
  _relay = null;
  _booted = false;
  resetIdentityCache();
}

// ---------------------------------------------------------------------------
// Relay (Phase 1 — simple JSON over WebSocket)
// ---------------------------------------------------------------------------

function _connectRelay(url: string, myDid: string): void {
  try {
    const ws = new WebSocket(url);
    _relay = ws;

    ws.addEventListener('open', () => {
      _relayConnected = true;
      // Announce presence
      ws.send(JSON.stringify({ type: 'announce', from: myDid }));
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          from?: string;
          data?: number[];
          publicKey?: number[];
        };

        if (msg.type === 'dot' && msg.from && msg.data) {
          const dotBytes = new Uint8Array(msg.data);
          if (dotBytes.length === 153) {
            _emit('dot', dotBytes, msg.from);
          }
        }

        if (msg.type === 'peer' && msg.from && msg.publicKey) {
          const peer: PeerInfo = {
            did: msg.from,
            publicKey: new Uint8Array(msg.publicKey),
            lastSeen: Date.now(),
          };
          _nearby.set(peer.did, peer);
          _emit('peer', peer);
        }
      } catch {
        // Malformed relay message — ignore
      }
    });

    ws.addEventListener('close', () => {
      _relayConnected = false;
      _relay = null;
    });

    ws.addEventListener('error', () => {
      _relayConnected = false;
      _relay = null;
    });
  } catch {
    // WebSocket not available (e.g., test environment without global WebSocket)
    _relayConnected = false;
  }
}

function _disconnectRelay(): void {
  if (_relay) {
    try { _relay.close(); } catch { /* ignore */ }
    _relay = null;
  }
  _relayConnected = false;
}

// ---------------------------------------------------------------------------
// The DOT singleton
// ---------------------------------------------------------------------------

export const DOT: EngineAPI = {
  get me(): DotIdentity | null {
    return _identity;
  },

  get nearby(): Map<string, PeerInfo> {
    return _nearby;
  },

  get chains(): Map<string, Chain> {
    return _chains;
  },

  async boot(options?: EngineOptions): Promise<void> {
    // Re-boot: clean up first
    if (_booted) {
      _disconnectRelay();
      _resetState();
    }

    _identity = await getOrCreateIdentity();
    _physics = createDotPhysics(_identity);
    _chains = new Map();
    _nearby = new Map();
    _listeners = new Map();
    _booted = true;

    // Mirror physics chains into engine chains via proxy approach:
    // The engine wraps physics and keeps its own chain map in sync.
    // On every create(), we sync from physics.getChain() below.

    if (!options?.offline) {
      const relayUrl = options?.relayUrl ?? 'wss://dotdotdot.rocks';
      _connectRelay(relayUrl, _identity.did);
    }

    _emit('ready');
  },

  async create(datom: Datom): Promise<Uint8Array> {
    if (!_physics || !_identity) {
      throw new Error('Engine not booted. Call DOT.boot() first.');
    }

    const dotBytes = await _physics.create(datom);

    // Sync chain into engine's public chains map
    const chainId = _identity.did;
    _chains.set(chainId, _physics.getChain(chainId));

    // Broadcast to relay (non-blocking)
    if (_relay && _relayConnected && _relay.readyState === 1) {
      try {
        _relay.send(JSON.stringify({
          type: 'dot',
          from: _identity.did,
          data: Array.from(dotBytes),
        }));
      } catch { /* relay send failure is non-fatal */ }
    }

    // Emit locally
    _emit('dot', dotBytes, _identity.did);

    return dotBytes;
  },

  getChain(recipientDid?: string): Chain | undefined {
    if (!_identity) return undefined;
    const chainId = recipientDid ?? _identity.did;
    if (!_chains.has(chainId)) {
      _chains.set(chainId, createChain(chainId));
    }
    return _chains.get(chainId);
  },

  on<E extends keyof EventMap>(event: E, cb: (...args: EventMap[E]) => void): void {
    if (!_listeners.has(event)) _listeners.set(event, []);
    _listeners.get(event)!.push(cb as Handler);
  },

  emit<E extends keyof EventMap>(event: E, ...args: EventMap[E]): void {
    _emit(event, ...args);
  },

  stats(): EngineStats {
    const physicsStats = _physics?.stats() ?? {
      totalDots: 0,
      totalRawBytes: 0,
      totalChains: 0,
      predictorAccuracy: 0,
      compressionRatio: 1,
    };
    return {
      ...physicsStats,
      relayConnected: _relayConnected,
      peersOnline: _nearby.size,
    };
  },

  async shutdown(): Promise<void> {
    _disconnectRelay();
    _resetState();
  },
};
