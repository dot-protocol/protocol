/**
 * @dotprotocol/transport — Types
 *
 * DOT Transport Protocol (DTP). No handshake. No session. No TLS.
 * DOTs as the message unit. Any transport underneath.
 */

import type { DOT, Keypair } from '@dotprotocol/core';

/** Supported transport backends */
export type TransportType = 'memory' | 'websocket' | 'custom';

/** Transport state */
export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** A verified incoming DOT with metadata */
export interface ReceivedDOT {
  /** The verified DOT */
  dot: DOT;
  /** Wire bytes (153 bytes) */
  bytes: Uint8Array;
  /** Which transport it arrived on */
  transport: TransportType;
  /** Receive timestamp (local clock) */
  receivedAt: number;
  /** Whether signature was verified */
  verified: boolean;
}

/** Configuration for send() */
export interface SendOptions {
  /** Target recipient public key */
  recipientKey?: Uint8Array;
  /** Transport to use (defaults to first available) */
  transport?: TransportType;
  /** Channel/circle ID for relay routing */
  channel?: string;
  /** Custom transport adapter */
  adapter?: TransportAdapter;
}

/** Configuration for receive() */
export interface ReceiveOptions {
  /** Auto-verify signature on receive (default: true) */
  autoVerify?: boolean;
  /** Filter by sender public key */
  filterKey?: Uint8Array;
  /** Filter by channel */
  filterChannel?: string;
}

/** Configuration for relay() */
export interface RelayOptions {
  /** Verify signature before relaying (default: true) */
  verify?: boolean;
  /** Relay can read content (default: false — dumb pipe) */
  read?: boolean;
  /** Max DOTs per second to relay (rate limiting) */
  maxRate?: number;
}

/** Relay statistics */
export interface RelayStats {
  /** Total DOTs relayed */
  relayed: number;
  /** DOTs rejected (failed verification) */
  rejected: number;
  /** Connected peers */
  peers: number;
  /** Uptime in ms */
  uptime: number;
}

/** Transport adapter interface — implement for custom transports */
export interface TransportAdapter {
  /** Unique transport type name */
  readonly type: TransportType;
  /** Current state */
  readonly state: TransportState;
  /** Send raw DOT bytes to a destination */
  send(bytes: Uint8Array, destination: string): Promise<void>;
  /** Register a handler for incoming DOT bytes */
  onReceive(handler: (bytes: Uint8Array, source: string) => void): () => void;
  /** Connect/start the transport */
  connect(): Promise<void>;
  /** Disconnect/stop the transport */
  disconnect(): Promise<void>;
}

/** Offline queue entry */
export interface QueuedDOT {
  bytes: Uint8Array;
  destination: string;
  channel?: string;
  queuedAt: number;
  retries: number;
}
