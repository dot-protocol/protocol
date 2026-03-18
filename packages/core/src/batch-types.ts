/**
 * Batch frame types for DOT stream compression.
 *
 * A batch contains N DOTs from the same identity in chain order.
 * Redundant fields (pubkey, chain hashes, timestamps) are compressed.
 */

export const BATCH_VERSION_ED25519 = 0x01;
export const BATCH_VERSION_BLS = 0x02;
export const BATCH_HEADER_SIZE = 43; // 1 + 2 + 32 + 8
export const TS_DELTA_ESCAPE = 0xFF;

export interface BatchHeader {
  version: number;       // 0x01 or 0x02
  count: number;         // number of DOTs
  pubkey: Uint8Array;    // 32 bytes — shared identity
  baseTimestamp: bigint;  // first DOT's timestamp in Unix ms
  baseType: number;      // first DOT's type byte
}

export interface BatchEntry {
  signature?: Uint8Array; // 64 bytes (Ed25519) — omitted in BLS mode
  tsDelta: number;        // ms delta from previous DOT (0-255, or escape + uint32)
  typeDelta: number;      // 0x00 = same as base, else new type byte
  payload: Uint8Array;    // 16 bytes
}

export interface BatchFrame {
  header: BatchHeader;
  entries: BatchEntry[];
  aggregateSignature?: Uint8Array; // 48 bytes (BLS mode only)
}

/**
 * Size of one entry in Ed25519 batch mode
 */
export const ED25519_ENTRY_SIZE = 64 + 1 + 1 + 16; // 82 bytes

/**
 * Size of one entry in BLS batch mode (no individual sig)
 */
export const BLS_ENTRY_SIZE = 1 + 1 + 16; // 18 bytes

/**
 * BLS aggregate signature size
 */
export const BLS_AGG_SIG_SIZE = 48;
