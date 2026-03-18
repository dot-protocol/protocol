// DOT Protocol — Core Types
// Wire format: 153 bytes exactly. Version 1. Ed25519 + SHA-256.

export const DOT_SIZE = 153 as const;
export const PUBKEY_SIZE = 32 as const;
export const SIG_SIZE = 64 as const;
export const CHAIN_SIZE = 32 as const;
export const TS_SIZE = 8 as const;
export const TYPE_SIZE = 1 as const;
export const PAYLOAD_SIZE = 16 as const;
export const SIGNED_SIZE = 89 as const;

// Byte offsets in wire format
export const OFF = {
  PUBKEY: 0,
  SIG: 32,
  CHAIN: 96,
  TS: 128,
  TYPE: 136,
  PAYLOAD: 137,
} as const;

export enum DotType {
  PUBLIC    = 0x00,
  CIRCLE    = 0x01,
  PRIVATE   = 0x02,
  EPHEMERAL = 0x03,
}

export interface DOT {
  pubkey: Uint8Array;
  sig: Uint8Array;
  chain: Uint8Array;
  ts: number;
  type: DotType;
  payload: Uint8Array;
}

export interface CreateDOTInput {
  keypair: Keypair;
  payload?: string | Uint8Array;
  type?: DotType;
  previous?: Uint8Array | DOT;
  ts?: number;
}

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}
