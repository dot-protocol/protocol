/// <reference lib="dom" />
/**
 * DOT Engine — CHORUS Relay Transport
 *
 * Wraps @dotprotocol/relay RelayClient with the RelayTransport interface.
 * Handles:
 *   - Ed25519 challenge-auth (required by CHORUS)
 *   - Subscribe to own DID channel on connect
 *   - Send 153-byte DOTs as 185-byte binary frames
 *   - onDot / onPeer callbacks
 *   - Auto-reconnect with exponential backoff (1s → 30s max)
 *   - Send queue: messages are held while disconnected, flushed on reconnect
 *
 * Works in browser (native WebSocket) and Node.js 21+ (globalThis.WebSocket).
 * For Node 18-20, the caller must polyfill globalThis.WebSocket.
 */

import { RelayClient, packFrame } from '@dotprotocol/relay';
import type { RelayStatus } from '@dotprotocol/relay';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RelayOptions {
  /** WebSocket URL, e.g. 'wss://dotdotdot.rocks' */
  url: string;
  /** 'dot:...' DID — used as default subscribe channel */
  myDid: string;
  /** Raw 32-byte Ed25519 private key for challenge-auth */
  privateKey: Uint8Array;
  /** Raw 32-byte Ed25519 public key */
  publicKey: Uint8Array;
}

export interface RelayTransport {
  /** Connect to the relay, authenticate, and subscribe to myDid channel. */
  connect(): Promise<void>;

  /**
   * Send a 153-byte DOT to a specific channel (usually recipient's DID).
   * Queued if not yet connected; flushed on reconnect.
   */
  send(dotBytes: Uint8Array, toChannel: string): Promise<void>;

  /**
   * Broadcast a 153-byte DOT to the own DID channel (myDid).
   * Queued if not yet connected; flushed on reconnect.
   */
  broadcast(dotBytes: Uint8Array): Promise<void>;

  /** Register callback for incoming 153-byte DOTs from other peers. */
  onDot(cb: (dot: Uint8Array, fromChannel: string) => void): void;

  /**
   * Register callback for peer-presence events.
   * CHORUS does not emit peer events in v0.1, but the hook is provided
   * for forward-compat and test injection.
   */
  onPeer(cb: (did: string, publicKey?: Uint8Array) => void): void;

  /** True when WebSocket is open and authenticated. */
  readonly connected: boolean;

  /** Tear down the connection permanently (no reconnect). */
  disconnect(): void;
}

// ---------------------------------------------------------------------------
// Internal queue entry
// ---------------------------------------------------------------------------

interface QueuedSend {
  dotBytes: Uint8Array;
  channel: string;
}

// ---------------------------------------------------------------------------
// createRelay
// ---------------------------------------------------------------------------

/**
 * Create a relay transport connected to CHORUS.
 *
 * Handles reconnection automatically. Works in browser and Node.js 21+.
 *
 * @example
 * const relay = createRelay({
 *   url: 'wss://dotdotdot.rocks',
 *   myDid: 'dot:abc123',
 *   privateKey: identity._privateKey,
 *   publicKey: identity.publicKey,
 * });
 * await relay.connect();
 * relay.onDot((dot, from) => console.log('got dot from', from));
 * await relay.broadcast(myDotBytes);
 */
export function createRelay(options: RelayOptions): RelayTransport {
  const { url, myDid, privateKey, publicKey } = options;

  // Derive channel key from myDid: strip 'dot:' prefix, use the rest as circleId.
  // The CHORUS server treats circleId as opaque UTF-8 (max 32 bytes, null-padded).
  const myChannel = myDid.startsWith('dot:') ? myDid.slice(4) : myDid;

  // ── Internal state ─────────────────────────────────────────────────────────

  let _client: RelayClient | null = null;
  let _connected = false;
  let _destroyed = false;

  // Exponential backoff
  let _retryDelay = 1_000;
  const MAX_RETRY = 30_000;
  let _retryTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending send queue (held while not connected)
  const _sendQueue: QueuedSend[] = [];

  // Callbacks
  const _dotHandlers: Array<(dot: Uint8Array, fromChannel: string) => void> = [];
  const _peerHandlers: Array<(did: string, publicKey?: Uint8Array) => void> = [];

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _setConnected(v: boolean): void {
    _connected = v;
  }

  function _flushQueue(client: RelayClient): void {
    while (_sendQueue.length > 0) {
      const item = _sendQueue.shift();
      if (!item) break;
      client.sendFrame(item.channel, item.dotBytes);
    }
  }

  async function _open(): Promise<void> {
    if (_destroyed) return;

    const client = new RelayClient({ url, reconnect: false });
    _client = client;

    // Listen for incoming binary frames
    client.onFrame((circleId, dotBytes) => {
      for (const h of _dotHandlers) h(dotBytes, circleId);
    });

    // Track status transitions
    client.onStatus((status: RelayStatus) => {
      if (status === 'connected') {
        _setConnected(true);
        _retryDelay = 1_000; // reset backoff on success
        // Subscribe to own channel
        client.subscribe(myChannel);
        // Flush any queued sends
        _flushQueue(client);
      } else if (status === 'disconnected') {
        _setConnected(false);
        if (!_destroyed) {
          _scheduleReconnect();
        }
      }
    });

    // Connect with keypair — RelayClient handles challenge-auth internally
    client.connect({ privateKey, publicKey });
  }

  function _scheduleReconnect(): void {
    if (_destroyed || _retryTimer !== null) return;
    _retryTimer = setTimeout(() => {
      _retryTimer = null;
      _open().catch(() => {
        // _open itself sets up another retry via onStatus('disconnected')
      });
    }, _retryDelay);
    _retryDelay = Math.min(_retryDelay * 2, MAX_RETRY);
  }

  // ── Connect ─────────────────────────────────────────────────────────────────

  /**
   * Connect and wait until the relay is authenticated and subscribed.
   * Resolves as soon as status reaches 'connected'.
   * Rejects if connection fails on the first attempt.
   */
  async function connect(): Promise<void> {
    if (_destroyed) throw new Error('RelayTransport has been disconnected');
    if (_connected) return;

    return new Promise<void>((resolve, reject) => {
      const client = new RelayClient({ url, reconnect: false });
      _client = client;

      let settled = false;

      client.onFrame((circleId, dotBytes) => {
        for (const h of _dotHandlers) h(dotBytes, circleId);
      });

      client.onStatus((status: RelayStatus) => {
        if (status === 'connected' && !settled) {
          settled = true;
          _setConnected(true);
          _retryDelay = 1_000;
          client.subscribe(myChannel);
          _flushQueue(client);
          resolve();

          // After resolving, re-attach a status handler to handle future disconnects
          client.onStatus((s: RelayStatus) => {
            if (s === 'disconnected') {
              _setConnected(false);
              if (!_destroyed) _scheduleReconnect();
            }
          });
        } else if (status === 'disconnected' && !settled) {
          settled = true;
          reject(new Error('RelayTransport: initial connection failed'));
        }
      });

      client.connect({ privateKey, publicKey });
    });
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async function send(dotBytes: Uint8Array, toChannel: string): Promise<void> {
    if (dotBytes.length !== 153) {
      throw new RangeError(`send: expected 153-byte DOT, got ${dotBytes.length}`);
    }
    if (_connected && _client) {
      _client.sendFrame(toChannel, dotBytes);
    } else {
      _sendQueue.push({ dotBytes: new Uint8Array(dotBytes), channel: toChannel });
    }
  }

  async function broadcast(dotBytes: Uint8Array): Promise<void> {
    return send(dotBytes, myChannel);
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────

  function onDot(cb: (dot: Uint8Array, fromChannel: string) => void): void {
    _dotHandlers.push(cb);
  }

  function onPeer(cb: (did: string, publicKey?: Uint8Array) => void): void {
    _peerHandlers.push(cb);
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────

  function disconnect(): void {
    _destroyed = true;
    if (_retryTimer !== null) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    _client?.disconnect();
    _client = null;
    _setConnected(false);
  }

  // ── Return transport ────────────────────────────────────────────────────────

  return {
    connect,
    send,
    broadcast,
    onDot,
    onPeer,
    disconnect,
    get connected() { return _connected; },
  };
}

// ---------------------------------------------------------------------------
// Re-export relay primitives for consumers who need raw frame packing
// ---------------------------------------------------------------------------
export { packFrame };
export type { RelayStatus };
