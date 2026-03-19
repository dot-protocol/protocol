/**
 * DOT ECDH encryption helpers.
 *
 * Ed25519 keys → X25519 keys → ECDH shared secret → ChaCha20 stream cipher.
 * The shared secret + chain position → deterministic keystream → XOR with payload.
 * 16-byte payload field is encrypted in-place. Lossless.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { chacha20 } from '@noble/ciphers/chacha.js';

/**
 * Convert an Ed25519 public key (32B) to an X25519 public key (32B).
 * Uses the birational equivalence between Edwards and Montgomery curves.
 */
export function edToX25519Pub(edPub: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(edPub);
}

/**
 * Convert an Ed25519 private key seed (32B) to an X25519 private key (32B).
 */
export function edToX25519Priv(edPriv: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomerySecret(edPriv);
}

/**
 * ECDH: derive a 32-byte shared secret from our Ed25519 private key
 * and their Ed25519 public key (both converted to X25519).
 */
export function ecdh(myEdPriv: Uint8Array, theirEdPub: Uint8Array): Uint8Array {
  const myX = edToX25519Priv(myEdPriv);
  const theirX = edToX25519Pub(theirEdPub);
  return x25519.getSharedSecret(myX, theirX);
}

/**
 * Encrypt a payload (≤16B) using ChaCha20 stream cipher.
 * Nonce = chainPos as 12-byte little-endian bigint.
 * Output is always 16 bytes (zero-padded input XORed with keystream).
 */
export function encryptPayload(
  plaintext: Uint8Array,
  sharedSecret: Uint8Array,
  chainPos: bigint,
): Uint8Array {
  const padded = new Uint8Array(16);
  padded.set(plaintext.slice(0, 16));
  const nonce = posToNonce(chainPos);
  return chacha20(sharedSecret, nonce, padded);
}

/**
 * Decrypt a 16-byte encrypted payload using ChaCha20 (symmetric).
 */
export function decryptPayload(
  ciphertext: Uint8Array,
  sharedSecret: Uint8Array,
  chainPos: bigint,
): Uint8Array {
  const nonce = posToNonce(chainPos);
  return chacha20(sharedSecret, nonce, ciphertext);
}

function posToNonce(pos: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  // Store low 64 bits as little-endian
  const low = pos & 0xFFFFFFFFn;
  const high = (pos >> 32n) & 0xFFFFFFFFn;
  view.setUint32(0, Number(low), true);
  view.setUint32(4, Number(high), true);
  return nonce;
}
