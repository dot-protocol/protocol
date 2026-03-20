/**
 * @dotprotocol/sign — Universal DOT Observation Signing
 *
 * sign(), verify(), chain(), describe()
 *
 * Content is opaque bytes. Face tells type. TEACH tells how to read.
 * Ed25519 for signing. SHA-256 for hashing. No alternatives.
 */

export { sign } from './sign.js';
export { verify } from './verify.js';
export { chain } from './chain.js';
export { describe } from './describe.js';
export { contentHash, truncatedHash } from './hash.js';

export { Face, AccessLevel, TeachByte } from './types.js';
export type { SignInput, SignedDOT, ChainResult, DOTDescription } from './types.js';

// Re-export core types for convenience
export type { DOT, Keypair } from '@dotprotocol/core';
export { createKeypair, DotType } from '@dotprotocol/core';
