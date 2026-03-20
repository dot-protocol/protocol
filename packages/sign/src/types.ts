/**
 * @dotprotocol/sign — Types
 *
 * Universal DOT signing types. Content is opaque bytes. Face tells type.
 * TEACH tells how to read. Size is unbounded.
 */

import type { DOT, Keypair } from '@dotprotocol/core';
import { DotType, DOTFace } from '@dotprotocol/core';

export { DotType as AccessLevel };
export { DOTFace as Face };

/** TEACH byte values — self-describing DOTs */
export enum TeachByte {
  None = 0x00,
  SelfDescribing = 0x01,
  SchemaRef = 0x02,
  HumanReadable = 0x03,
  MachineReadable = 0x04,
}

/** Input to the sign() function */
export interface SignInput {
  /** Opaque content — any bytes, any size. If >16B, a SHA-256 truncated hash is stored in the DOT payload. */
  content?: Uint8Array | string;
  /** Face bitfield describing what this DOT observes */
  face?: number;
  /** Ed25519 keypair */
  key: Keypair;
  /** SHA-256 hash of the previous DOT in this chain (or undefined for genesis) */
  prev?: Uint8Array;
  /** Access level (translucency): public, circle, private, ephemeral */
  access?: DotType;
  /** TEACH byte — how to read this DOT */
  teach?: TeachByte;
  /** Named transform to apply (must be registered in TransformRegistry) */
  transform?: string;
  /** Explicit timestamp in unix ms (defaults to Date.now()) */
  ts?: number;
}

/** A signed DOT with optional extended metadata */
export interface SignedDOT {
  /** The core 153-byte DOT */
  dot: DOT;
  /** Wire bytes (153 bytes) */
  bytes: Uint8Array;
  /** SHA-256 hash of the wire bytes */
  hash: Uint8Array;
  /** Face bitfield (if provided) */
  face: number;
  /** TEACH byte */
  teach: TeachByte;
  /** Transform ID (if applied) */
  transform?: string;
  /** Original content (if provided and <=16B, stored directly; if >16B, only hash pointer in payload) */
  contentHash?: Uint8Array;
}

/** Result from chain() */
export interface ChainResult {
  valid: boolean;
  length: number;
  brokenAt?: number;
  reason?: string;
}

/** Human-readable description of a DOT */
export interface DOTDescription {
  /** Public key hex */
  key: string;
  /** Chain hash hex */
  chain: string;
  /** Timestamp ISO string */
  time: string;
  /** Timestamp unix ms */
  ts: number;
  /** Access level name */
  access: string;
  /** Payload hex */
  payload: string;
  /** Active face names */
  faces: string[];
  /** TEACH byte name */
  teach: string;
  /** Whether this is a genesis DOT */
  isGenesis: boolean;
  /** Whether payload is all zeros (PING) */
  isPing: boolean;
  /** Wire size in bytes */
  size: number;
}
