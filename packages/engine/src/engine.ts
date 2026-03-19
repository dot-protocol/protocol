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
import { createBatchCompressor } from './compress.js';
import { createWatchdog } from './watchdog.js';
import { computeStatus, computeTrend } from './health.js';
import { signBLS, aggregateSignatures, verifyAggregateSameSigner } from '@dot-protocol/core';
import { bls12_381 as blsCurve } from '@noble/curves/bls12-381.js';
import type { DotIdentity, FullIdentity } from './identity.js';
import type { Chain } from './chain.js';
import type { Datom, PhysicsStats } from './physics.js';
import type { RelayTransport } from './relay.js';
import type { HealthReport } from './health.js';
import type { Watchdog } from './watchdog.js';

export type { Datom, PhysicsStats };
export type { DotIdentity };
export type { Chain };
export type { RelayTransport };
export type { HealthReport };

export interface EngineOptions {
  /** CHORUS relay WebSocket URL. Default: 'wss://dotdotdot.rocks' */
  relayUrl?: string;
  /** If true, skip relay connection entirely. Good for unit tests. */
  offline?: boolean;
  /** Auto-seal every N DOTs. 0 = manual only (default). */
  sealEvery?: number;
}

export interface PeerInfo {
  did: string;
  publicKey: Uint8Array;
  lastSeen: number;
}

export interface EngineStats extends PhysicsStats {
  relayConnected: boolean;
  peersOnline: number;
  sealCount: number;
}

type EventMap = {
  dot: [dot: Uint8Array, from: string];
  peer: [peer: PeerInfo];
  chain: [chain: Chain];
  ready: [];
  health: [report: HealthReport];
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

  /**
   * BLS batch seal: aggregate-sign the last N DOTs using BLS12-381.
   * Returns a 48-byte compressed G1 aggregate signature.
   * Returns an empty Uint8Array if n=0 or no DOTs exist.
   *
   * @param n - Number of most recent DOTs to seal. Defaults to all.
   */
  seal(n?: number): Promise<Uint8Array>;

  /**
   * Verify a BLS aggregate seal produced by seal().
   * Re-derives the BLS key from the current identity and uses
   * verifyAggregateSameSigner over the same set of DOT bytes.
   *
   * @param sealBytes - 48-byte aggregate G1 signature returned by seal()
   * @param n - Number of DOTs that were sealed. Defaults to all in chain.
   * @returns true if the seal is valid, false otherwise
   */
  verifySeal(sealBytes: Uint8Array, n?: number): Promise<boolean>;

  /** Current stats. */
  stats(): EngineStats;

  /** Current health report — self-awareness in real time. */
  health(): HealthReport;

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
let _compressor = createBatchCompressor();
let _sealEvery = 0;
let _dotsSinceLastSeal = 0;
let _blsPrivKey: Uint8Array | null = null;
let _sealCount = 0;
let _watchdog: Watchdog | null = null;
let _bootTime = 0;
let _lastHealthStatus: import('./health.js').HealthStatus = 'healthy';
let _offlineMode = false;  // true when booted with offline:true — relay disconnect is expected

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
  _compressor = createBatchCompressor();
  _sealEvery = 0;
  _dotsSinceLastSeal = 0;
  _blsPrivKey = null;
  _sealCount = 0;
  if (_watchdog) {
    _watchdog.stop();
    _watchdog = null;
  }
  _bootTime = 0;
  _lastHealthStatus = 'healthy';
  _offlineMode = false;
  resetIdentityCache();
}

/**
 * Derive a deterministic BLS private key from the Ed25519 identity private key.
 * Uses SHA-256(privateKey || "bls-seal") to produce a stable 32-byte BLS scalar.
 */
async function _getOrCreateBlsKey(privateKey: Uint8Array): Promise<Uint8Array> {
  if (_blsPrivKey) return _blsPrivKey;
  const label = new TextEncoder().encode('bls-seal');
  const input = new Uint8Array(privateKey.length + label.length);
  input.set(privateKey);
  input.set(label, privateKey.length);
  const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer);
  _blsPrivKey = new Uint8Array(hashBuf);
  return _blsPrivKey;
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
    _watchdog?.recordRelay(true);
  } catch {
    // Relay unavailable — continue offline
    _relayConnected = false;
    _watchdog?.recordRelay(false);
  }
}

function _disconnectRelay(): void {
  if (_relay) {
    try { _relay.disconnect(); } catch { /* ignore */ }
    _relay = null;
  }
  _relayConnected = false;
  _watchdog?.recordRelay(false);
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
    _sealEvery = options?.sealEvery ?? 0;
    _dotsSinceLastSeal = 0;
    _booted = true;
    _bootTime = Date.now();
    _offlineMode = options?.offline ?? false;

    // Create and wire watchdog
    _watchdog = createWatchdog({
      sealEveryDots: _sealEvery > 0 ? _sealEvery : 100,
    });

    _watchdog.onPredictorReset = () => {
      // Reset physics predictor by rebuilding the physics layer
      if (_identity) {
        _physics = createDotPhysics(_identity);
      }
    };

    _watchdog.onRelayShouldReconnect = () => {
      if (_identity && !_relayConnected) {
        const relayUrl = options?.relayUrl ?? 'wss://dotdotdot.rocks';
        _connectRelay(relayUrl, _identity).catch(() => { /* non-fatal */ });
      }
    };

    _watchdog.onSealNeeded = () => {
      void DOT.seal(_dotsSinceLastSeal > 0 ? _dotsSinceLastSeal : undefined);
    };

    _watchdog.onChainRepair = (_fromPos: number) => {
      // Chain repair: reset to last good state (rebuild physics from scratch)
      if (_identity) {
        _physics = createDotPhysics(_identity);
        _chains = new Map();
      }
    };

    _watchdog.start();

    // Mirror physics chains into engine chains via proxy approach:
    // The engine wraps physics and keeps its own chain map in sync.
    // On every create(), we sync from physics.getChain() below.

    if (!options?.offline) {
      const relayUrl = options?.relayUrl ?? 'wss://dotdotdot.rocks';
      await _connectRelay(relayUrl, _identity);
    }

    // Record initial relay state
    _watchdog.recordRelay(_relayConnected);

    _emit('ready');
  },

  async create(datom: Datom): Promise<Uint8Array> {
    if (!_physics || !_identity) {
      throw new Error('Engine not booted. Call DOT.boot() first.');
    }

    const dotBytes = await _physics.create(datom);

    // Feed into compressor for stats tracking
    _compressor.feed(dotBytes);

    // Auto-seal if configured
    _dotsSinceLastSeal++;
    if (_sealEvery > 0 && _dotsSinceLastSeal >= _sealEvery) {
      _dotsSinceLastSeal = 0;
      // Fire-and-forget auto-seal (non-blocking)
      void DOT.seal(_sealEvery);
    }

    // Sync chain into engine's public chains map
    const chainId = _identity.did;
    const updatedChain = _physics.getChain(chainId);
    _chains.set(chainId, updatedChain);

    // Notify watchdog
    const physStats = _physics.stats();
    _watchdog?.recordDot(physStats.predictorAccuracy);
    _watchdog?.recordChain(true, updatedChain.length ?? updatedChain.entries.length);

    // Check if health status changed — emit 'health' event if so
    const currentReport = DOT.health();
    if (currentReport.status !== _lastHealthStatus) {
      _lastHealthStatus = currentReport.status;
      _emit('health', currentReport);
    }

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

  async seal(n?: number): Promise<Uint8Array> {
    if (!_identity) return new Uint8Array(0);

    const chain = _chains.get(_identity.did);
    const entries = chain?.entries ?? [];

    // Handle zero-DOT case
    const count = n ?? entries.length;
    if (count === 0 || entries.length === 0) return new Uint8Array(0);

    const dots = entries.slice(-count).map(e => e.dot);
    const blsPrivKey = await _getOrCreateBlsKey(_identity._privateKey);

    // Sign each DOT (use first 32 bytes as message for BLS)
    const signatures = dots.map(dot => signBLS(dot.slice(0, 32), blsPrivKey));

    // Aggregate into single 48-byte G1 signature
    const result = aggregateSignatures(signatures);
    _sealCount++;

    // Notify watchdog of seal
    const chainPos = entries.length;
    _watchdog?.recordSeal(chainPos);

    return result;
  },

  async verifySeal(sealBytes: Uint8Array, n?: number): Promise<boolean> {
    if (!_identity) return false;
    if (!sealBytes || sealBytes.length === 0) return false;

    const chain = _chains.get(_identity.did);
    const entries = chain?.entries ?? [];

    const count = n ?? entries.length;
    if (count === 0 || entries.length === 0) return false;

    const dots = entries.slice(-count).map(e => e.dot);
    const blsPrivKey = await _getOrCreateBlsKey(_identity._privateKey);

    // Re-derive the BLS public key the same way seal() used the private key
    const blsPubKey = blsCurve.shortSignatures.getPublicKey(blsPrivKey).toBytes();

    // Each DOT was signed over its first 32 bytes — build the same message array
    const messages = dots.map(dot => dot.slice(0, 32));

    return verifyAggregateSameSigner(sealBytes, messages, blsPubKey);
  },

  stats(): EngineStats {
    const physicsStats = _physics?.stats() ?? {
      totalDots: 0,
      totalRawBytes: 0,
      totalChains: 0,
      predictorAccuracy: 0,
      compressionRatio: 1,
    };

    // Get compression stats from the last 100 dots in the active chain
    let compressionRatio = physicsStats.compressionRatio;
    let predictorAccuracy = physicsStats.predictorAccuracy;
    if (_identity) {
      const chain = _chains.get(_identity.did);
      if (chain && chain.entries.length > 0) {
        const last100 = chain.entries.slice(-100).map(e => e.dot);
        const compStats = _compressor.measure(last100);
        compressionRatio = compStats.ratio;
        predictorAccuracy = compStats.predictorAccuracy;
      }
    }

    return {
      ...physicsStats,
      compressionRatio,
      predictorAccuracy,
      relayConnected: _relay?.connected ?? false,
      peersOnline: _nearby.size,
      sealCount: _sealCount,
    };
  },

  health(): HealthReport {
    const wdState = _watchdog?.getState();
    const physStats = _physics?.stats() ?? {
      totalDots: 0,
      totalRawBytes: 0,
      totalChains: 0,
      predictorAccuracy: 0,
      compressionRatio: 1,
    };

    const chainEntries = _identity ? (_chains.get(_identity.did)?.entries ?? []) : [];
    const chainLength = chainEntries.length;
    const chainValid = wdState?.chainValid ?? true;

    // Predictor history for trend
    const predHistory = wdState?.predictorHistory ?? [];
    const predAccuracy = physStats.predictorAccuracy;

    // Compression trend from last 20 vs previous 20 (approximation)
    const compressionRatio = physStats.compressionRatio;

    // Relay state
    const relayConnected = _relay?.connected ?? false;

    // Seal tracking from watchdog internal state via getState
    // We track sealAgeDots separately in engine via _dotsSinceLastSeal
    const sealAgeDots = _dotsSinceLastSeal;
    // lastSealAt: chain pos of last seal — we only know if watchdog recorded it
    // Use _sealCount as proxy for "has ever sealed"
    const lastSealAt = _sealCount > 0 ? Math.max(0, chainLength - sealAgeDots) : -1;

    const issues: string[] = [];
    if (!relayConnected) issues.push(`Relay disconnected${wdState ? ` (${wdState.relayReconnects} reconnect attempts)` : ''}`);
    if (!chainValid) issues.push('Chain integrity check failed');
    if (predAccuracy < 0.3 && physStats.totalDots >= 10) {
      issues.push(`Predictor accuracy low: ${(predAccuracy * 100).toFixed(1)}%`);
    }

    const threshold = 0.3;
    // In offline mode, relay disconnection is expected — treat as connected for health purposes
    const effectiveRelayConnected = _offlineMode ? true : relayConnected;
    // Only penalize predictor accuracy if enough DOTs exist to be meaningful (>10)
    const effectivePredAccuracy = physStats.totalDots < 10 ? 1.0 : predAccuracy;
    const status = computeStatus(effectiveRelayConnected, chainValid, effectivePredAccuracy, threshold);

    // Update last known status
    _lastHealthStatus = status;

    return {
      status,
      relay: {
        connected: relayConnected,
        latencyMs: relayConnected ? 0 : -1,
        reconnectAttempts: wdState?.relayReconnects ?? 0,
        bufferedDots: wdState?.relayBuffered ?? 0,
      },
      chain: {
        length: chainLength,
        valid: chainValid,
        lastSealAt,
        sealAgeDots,
      },
      predictor: {
        accuracy: predAccuracy,
        trend: computeTrend(predHistory),
        resets: wdState?.predictorResets ?? 0,
      },
      identity: {
        exists: _identity !== null,
        persisted: _identity !== null, // identity is always persisted after boot
        recoveries: wdState?.identityRecoveries ?? 0,
      },
      compression: {
        ratio: compressionRatio,
        trend: 'stable', // compression trend requires history we don't track yet
      },
      uptimeMs: _bootTime > 0 ? Date.now() - _bootTime : 0,
      issues,
      healingActions: wdState?.healingActions ?? [],
    };
  },

  async shutdown(): Promise<void> {
    _disconnectRelay();
    _resetState();
  },
};
