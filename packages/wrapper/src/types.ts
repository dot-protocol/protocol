// @dot-protocol/wrapper — types

import type { BLSKeypair } from '@dot-protocol/core';
export { DotType } from '@dot-protocol/core';
import { DotType } from '@dot-protocol/core';

// ─── Protocol ─────────────────────────────────────────────────────────────────

/** Supported protocol types for wrap/unwrap */
export type Protocol = 'https' | 'websocket' | 'json' | 'raw';

/** Protocol byte IDs (stored in first byte of prefixed payload) */
export const PROTOCOL_ID: Record<Protocol, number> = {
  raw: 0,
  json: 1,
  https: 2,
  websocket: 3,
};

/** Reverse map: byte → Protocol */
export const PROTOCOL_FROM_ID: Record<number, Protocol> = {
  0: 'raw',
  1: 'json',
  2: 'https',
  3: 'websocket',
};

// ─── WrappedChain ─────────────────────────────────────────────────────────────

/** The wire format returned by wrap() */
export interface WrappedChain {
  /** Protocol this chain represents */
  protocol: Protocol;
  /** Compressed batch frame (batch-v2 format) — what you transmit */
  frame: Uint8Array;
  /** Raw DOT bytes (uncompressed, for inspection/verification) */
  dots: Uint8Array[];
  /** Number of payload chunks (= number of DOTs) */
  chunkCount: number;
  /** Total original payload bytes */
  originalBytes: number;
  /** Compressed frame bytes */
  compressedBytes: number;
  /** Compression ratio: originalBytes / compressedBytes */
  compressionRatio: number;
  /** BLS public key (96B G2 point) — pass to unwrap() for verification */
  blsPublicKey: Uint8Array;
  /** BLS aggregate signature over all DOTs */
  batchSeal: Uint8Array;
}

// ─── UnwrappedPayload ─────────────────────────────────────────────────────────

/** Result of unwrap() */
export interface UnwrappedPayload {
  /** Original protocol */
  protocol: Protocol;
  /** Reconstructed original bytes */
  data: Uint8Array;
  /** Whether BLS signature was externally verified (true only when blsPublicKey provided) */
  verified: boolean;
  /** Number of DOTs in the chain */
  dotCount: number;
  /** Compression stats */
  compressionRatio: number;
}

// ─── WrapOptions ─────────────────────────────────────────────────────────────

/** Options for wrap() */
export interface WrapOptions {
  /** Protocol hint (default: 'raw') */
  protocol?: Protocol;
  /** Pre-existing session for stateful wrapping (maintains predictor context). If omitted, creates a fresh one-shot keypair. */
  session?: WrapSession;
  /** DotType for all DOTs in this chain (default: PUBLIC) */
  type?: DotType;
  /** If true, use timestamp-delta encoding in batch (default: true) */
  timestampDelta?: boolean;
  /** If true, use RLE for payload types (default: true) */
  payloadTypeRLE?: boolean;
}

// ─── UnwrapOptions ────────────────────────────────────────────────────────────

/** Options for unwrap() */
export interface UnwrapOptions {
  /**
   * BLS public key (96B G2) for external verification.
   * If provided and verification passes, result.verified = true.
   * If omitted, BLS check is skipped and result.verified = false.
   */
  blsPublicKey?: Uint8Array;
}

// ─── BridgeOptions / BridgeHandle ─────────────────────────────────────────────

/** Options for bridge() */
export interface BridgeOptions {
  /** Port to listen on (default: 8100) */
  port?: number;
  /** Hostname to bind (default: '127.0.0.1') */
  host?: string;
  /** Target base URL to forward requests to (e.g., 'https://api.example.com') */
  forward?: string;
  /** Max request body size in bytes (default: 10MB) */
  maxBodySize?: number;
  /** BLS public key for verifying incoming DOT chains (optional) */
  blsPublicKey?: Uint8Array;
  /** Session for wrapping responses (optional — creates fresh if omitted) */
  session?: WrapSession;
}

/** Handle returned by bridge() */
export interface BridgeHandle {
  /** Actual port the bridge is listening on */
  readonly port: number;
  /** Stop the bridge */
  close(): Promise<void>;
  /** Number of requests proxied so far */
  readonly requestCount: number;
}

// ─── WrapSession ─────────────────────────────────────────────────────────────

/** Stateful session — maintains chain and predictor context across multiple wrap() calls */
export interface WrapSession {
  /** Ed25519 keypair for DOT creation */
  keypair: { publicKey: Uint8Array; privateKey: Uint8Array };
  /** BLS keypair for batch sealing */
  blsKeypair: BLSKeypair;
  /** Accumulated DOT byte arrays from previous wrap() calls */
  dots: Uint8Array[];
  /** Last DOT bytes (for chain linking into next wrap call) */
  lastDot?: Uint8Array;
  /** Base timestamp for this session (ms) */
  baseTimestamp: bigint;
}
