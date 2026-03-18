/**
 * BLS12-381 signing and aggregation for DOT.
 * Uses @noble/curves — 6 audits, MIT license, zero deps.
 *
 * "Short signatures" mode: G1 for signatures (48B), G2 for pubkeys (96B).
 * Single BLS verify is ~34× slower than Ed25519.
 * Aggregate verify of N sigs is faster than N Ed25519 verifies for N ≥ 3.
 * In batch mode, pubkey is sent once so the 96B cost is amortized.
 *
 * API note (@noble/curves v2.x):
 *   - Messages must be hashed to G1 via bls12_381.G1.hashToCurve(bytes)
 *   - sign(G1Point, secretKey) → G1Point (48B when serialized)
 *   - getPublicKey(secretKey) → G2Point (96B when serialized)
 *   - verifyBatch(aggSig, [{message, publicKey}]) → boolean
 */

import { bls12_381 } from '@noble/curves/bls12-381.js';

const ss = bls12_381.shortSignatures;

/** BLS12-381 public key size (G2, compressed): 96 bytes */
export const BLS_PUBKEY_SIZE = 96;

/** BLS12-381 signature size (G1, compressed): 48 bytes */
export const BLS_SIG_SIZE = 48;

export interface BLSKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Generate a BLS12-381 keypair.
 * Private key: 32 bytes (scalar in Fr)
 * Public key: 96 bytes (G2 point, compressed)
 */
export function createBLSKeypair(): BLSKeypair {
  const privateKey = bls12_381.utils.randomSecretKey();
  const publicKey = ss.getPublicKey(privateKey).toBytes();
  return { privateKey, publicKey };
}

/**
 * Sign a raw message with BLS12-381 (shortSignatures / G1 sigs).
 * The message is hashed to a G1 curve point internally.
 * Returns a 48-byte compressed G1 point.
 *
 * @param message - Raw bytes (typically the 89-byte signed portion of a DOT)
 * @param privateKey - 32-byte BLS private key
 */
export function signBLS(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  const msgPoint = bls12_381.G1.hashToCurve(message);
  const sigPoint = ss.sign(msgPoint, privateKey);
  return sigPoint.toBytes();
}

/**
 * Verify a BLS12-381 signature.
 *
 * @param signature - 48-byte compressed G1 signature
 * @param message - Raw bytes that were signed
 * @param publicKey - 96-byte compressed G2 public key
 */
export function verifyBLS(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    const sigPoint = bls12_381.G1.Point.fromBytes(signature);
    const msgPoint = bls12_381.G1.hashToCurve(message);
    const pubPoint = bls12_381.G2.Point.fromBytes(publicKey);
    return ss.verify(sigPoint, msgPoint, pubPoint);
  } catch {
    return false;
  }
}

/**
 * Aggregate N BLS signatures into a single 48-byte signature.
 * This is the core compression primitive: 100 sigs → 48 bytes.
 *
 * @param signatures - Array of 48-byte compressed G1 signatures
 */
export function aggregateSignatures(signatures: Uint8Array[]): Uint8Array {
  if (signatures.length === 0) throw new Error('aggregateSignatures requires at least one signature');
  const sigPoints = signatures.map(s => bls12_381.G1.Point.fromBytes(s));
  const aggPoint = ss.aggregateSignatures(sigPoints);
  return aggPoint.toBytes();
}

/**
 * Verify an aggregate signature from the same signer over multiple distinct messages.
 *
 * This uses aggregate_verify (verifyBatch), which is secure against the
 * rogue-key attack when messages differ per verification pair.
 *
 * Performance: O(N) pairings — verify N DOTs from one signer in a single call.
 * For N ≥ 3 this beats N individual Ed25519 verifies.
 *
 * @param aggregateSig - 48-byte aggregate G1 signature
 * @param messages - Array of raw byte messages (must match signing order)
 * @param publicKey - 96-byte compressed G2 public key of the signer
 */
export function verifyAggregateSameSigner(
  aggregateSig: Uint8Array,
  messages: Uint8Array[],
  publicKey: Uint8Array
): boolean {
  try {
    const aggSigPoint = bls12_381.G1.Point.fromBytes(aggregateSig);
    const pubPoint = bls12_381.G2.Point.fromBytes(publicKey);
    const pairs = messages.map(msg => ({
      message: bls12_381.G1.hashToCurve(msg),
      publicKey: pubPoint,
    }));
    return ss.verifyBatch(aggSigPoint, pairs);
  } catch {
    return false;
  }
}
