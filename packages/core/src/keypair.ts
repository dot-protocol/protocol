import type { Keypair } from './types.js';

// PKCS8 header for Ed25519 (RFC 8410) — 16-byte prefix + 32-byte seed = 48 bytes total
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

// SPKI header for Ed25519 — 12-byte prefix + 32-byte public key = 44 bytes total
const SPKI_PREFIX_LEN = 12;

function base64urlToBytes(b64url: string): Uint8Array {
  // Pad to multiple of 4, convert base64url -> base64 -> decode
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(b64url.length + (4 - b64url.length % 4) % 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function makePkcs8(seed: Uint8Array): ArrayBuffer {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed, PKCS8_PREFIX.length);
  return pkcs8.buffer as ArrayBuffer;
}

export async function createKeypair(seed?: Uint8Array): Promise<Keypair> {
  const { subtle } = globalThis.crypto;

  if (seed) {
    if (seed.length !== 32) throw new Error('Seed must be 32 bytes');
    const privKey = await subtle.importKey('pkcs8', makePkcs8(seed), { name: 'Ed25519' }, true, ['sign']);
    const jwk = await subtle.exportKey('jwk', privKey);
    if (!jwk.x) throw new Error('Failed to export JWK public key');
    const publicKey = base64urlToBytes(jwk.x);
    return { publicKey, privateKey: seed };
  }

  const { privateKey: privCryptoKey, publicKey: pubCryptoKey } =
    await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);

  const pkcs8Exported = new Uint8Array(await subtle.exportKey('pkcs8', privCryptoKey));
  const spkiExported = new Uint8Array(await subtle.exportKey('spki', pubCryptoKey));

  // Seed is the last 32 bytes of PKCS8 export
  const privateKey = pkcs8Exported.slice(PKCS8_PREFIX.length);
  // Public key is the last 32 bytes of SPKI export (after 12-byte header)
  const publicKey = spkiExported.slice(SPKI_PREFIX_LEN);

  return { publicKey, privateKey };
}

export async function importPrivateKey(seed: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'pkcs8', makePkcs8(seed), { name: 'Ed25519' }, false, ['sign']
  );
}

export async function importPublicKey(pubkey: Uint8Array): Promise<CryptoKey> {
  // Use 'raw' format — simpler, matches original JS implementation
  // Ensure we have a clean ArrayBuffer (slice creates a copy with its own ArrayBuffer)
  const raw = pubkey.byteOffset === 0 && pubkey.byteLength === pubkey.buffer.byteLength
    ? (pubkey.buffer as ArrayBuffer)
    : pubkey.slice(0).buffer as ArrayBuffer;
  return globalThis.crypto.subtle.importKey(
    'raw', raw, { name: 'Ed25519' }, false, ['verify']
  );
}
