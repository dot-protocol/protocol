import { DOT, DOT as DOT$1, DOTFace, DotType, DotType as DotType$1, Keypair, Keypair as Keypair$1, createKeypair } from "@dotprotocol/core";

//#region src/types.d.ts

/** TEACH byte values — self-describing DOTs */
declare enum TeachByte {
  None = 0,
  SelfDescribing = 1,
  SchemaRef = 2,
  HumanReadable = 3,
  MachineReadable = 4,
}
/** Input to the sign() function */
interface SignInput {
  /** Opaque content — any bytes, any size. If >16B, a SHA-256 truncated hash is stored in the DOT payload. */
  content?: Uint8Array | string;
  /** Face bitfield describing what this DOT observes */
  face?: number;
  /** Ed25519 keypair */
  key: Keypair$1;
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
interface SignedDOT {
  /** The core 153-byte DOT */
  dot: DOT$1;
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
interface ChainResult {
  valid: boolean;
  length: number;
  brokenAt?: number;
  reason?: string;
}
/** Human-readable description of a DOT */
interface DOTDescription {
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
//# sourceMappingURL=types.d.ts.map
//#endregion
//#region src/sign.d.ts
declare function sign(input: SignInput): Promise<SignedDOT>;
//# sourceMappingURL=sign.d.ts.map
//#endregion
//#region src/verify.d.ts
/** Verify a SignedDOT, a DOT object, or raw 153 bytes */
declare function verify(input: SignedDOT | DOT$1 | Uint8Array): Promise<boolean>;
//# sourceMappingURL=verify.d.ts.map
//#endregion
//#region src/chain.d.ts
/** Verify chain integrity for an array of DOTs (any supported format) */
declare function chain(dots: Array<SignedDOT | DOT$1 | Uint8Array>): Promise<ChainResult>;
//# sourceMappingURL=chain.d.ts.map
//#endregion
//#region src/describe.d.ts
/** Produce a human-readable description of a DOT */
declare function describe(input: SignedDOT | DOT$1 | Uint8Array): DOTDescription;
//# sourceMappingURL=describe.d.ts.map
//#endregion
//#region src/hash.d.ts
/**
 * @dotprotocol/sign — Hashing utilities
 *
 * SHA-256 content hashing and truncation for DOT payloads.
 */
/** Compute full SHA-256 hash of content */
declare function contentHash(content: Uint8Array): Promise<Uint8Array>;
/** Compute truncated SHA-256 hash (first 16 bytes) for DOT payload */
declare function truncatedHash(content: Uint8Array): Promise<Uint8Array>;
//# sourceMappingURL=hash.d.ts.map

//#endregion
export { DotType as AccessLevel, type ChainResult, type DOT, type DOTDescription, DotType$1 as DotType, DOTFace as Face, type Keypair, type SignInput, type SignedDOT, TeachByte, chain, contentHash, createKeypair, describe, sign, truncatedHash, verify };
//# sourceMappingURL=index-WomNeRBC.d.ts.map