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
import { createRelay } from './relay.js';
import { ecdh, decryptPayload } from './crypto.js';
import type { DotIdentity, FullIdentity } from './identity.js';
import type { Chain } from './chain.js';
import type { Datom, PhysicsStats } from './physics.js';
import type { RelayTransport } from './relay.js';

export type { Datom, PhysicsStats };
export type { DotIdentity };
export type { Chain };
export type { RelayTransport };

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

  /**
   * Decrypt a DOT's payload using ECDH with the sender's public key.
   * Returns the 16-byte plaintext payload, or null if identity not initialized.
   *
   * @param dotBytes - Raw 153-byte DOT
   * @param senderPublicKey - The sender's Ed25519 public key (32 bytes)
   * @param chainPos - Position of this DOT in the chain (for nonce derivation)
   */
  decryptDot(dotBytes: Uint8Array, senderPublicKey: Uint8Array, chainPos?: bigint): Uint8Array | null;

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
let _relay: RelayTransport | null = null;

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
// Relay (CHORUS relay transport via createRelay)
// ---------------------------------------------------------------------------

async function _connectRelay(url: string, identity: FullIdentity): Promise<void> {
  try {
    const transport = createRelay({
      url,
      myDid: identity.did,
      privateKey: identity._privateKey,
      publicKey: identity.publicKey,
    });

    transport.onDot((dotBytes, fromChannel) => {
      if (dotBytes.length === 153) {
        _emit('dot', dotBytes, fromChannel);
      }
    });

    transport.onPeer((did, publicKey) => {
      const peer: PeerInfo = {
        did,
        publicKey: publicKey ?? new Uint8Array(32),
        lastSeen: Date.now(),
      };
      _nearby.set(peer.did, peer);
      _emit('peer', peer);
    });

    await transport.connect();
    _relay = transport;
    _relayConnected = true;
  } catch {
    // Relay unavailable — continue offline
    _relayConnected = false;
  }
}

function _disconnectRelay(): void {
  if (_relay) {
    try { _relay.disconnect(); } catch { /* ignore */ }
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
      await _connectRelay(relayUrl, _identity);
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
    if (_relay && _relay.connected) {
      _relay.broadcast(dotBytes).catch(() => { /* relay send failure is non-fatal */ });
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

  decryptDot(dotBytes: Uint8Array, senderPublicKey: Uint8Array, chainPos: bigint = 0n): Uint8Array | null {
    if (!_identity) return null;
    const shared = ecdh(_identity._privateKey, senderPublicKey);
    const encryptedPayload = dotBytes.slice(137, 153);
    return decryptPayload(encryptedPayload, shared, chainPos);
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
      relayConnected: _relay?.connected ?? false,
      peersOnline: _nearby.size,
    };
  },

  async shutdown(): Promise<void> {
    _disconnectRelay();
    _resetState();
  },
};
