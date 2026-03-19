/**
 * DOT Engine — Identity
 *
 * Get or create the device's DOT identity. Uses WebCrypto Ed25519 everywhere
 * (Node 18+ has globalThis.crypto.subtle). Falls back to @dot-protocol/core
 * createKeypair() if Ed25519 generateKey is unavailable.
 *
 * Identity is created ONCE and reused. Clearing storage = new identity.
 */

import { createKeypair } from '@dot-protocol/core';

const STORAGE_KEY = 'dot:identity';

export interface DotIdentity {
  publicKey: Uint8Array;
  /** "dot:" + base64url(publicKey) */
  did: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export type FullIdentity = DotIdentity & { _privateKey: Uint8Array };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// PKCS8 prefix for Ed25519 seed (RFC 8410)
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_PREFIX_LEN = 12;

function makePkcs8(seed: Uint8Array): ArrayBuffer {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed, PKCS8_PREFIX.length);
  return pkcs8.buffer as ArrayBuffer;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
    return u8.buffer as ArrayBuffer;
  }
  return u8.slice(0).buffer as ArrayBuffer;
}

function makeDid(publicKey: Uint8Array): string {
  return 'dot:' + bytesToBase64url(publicKey);
}

// ---------------------------------------------------------------------------
// WebCrypto path
// ---------------------------------------------------------------------------

async function generateWebCryptoIdentity(): Promise<FullIdentity | null> {
  try {
    const { subtle } = globalThis.crypto;
    const keyPair = await subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    );

    const pkcs8Bytes = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey));
    const spkiBytes = new Uint8Array(await subtle.exportKey('spki', keyPair.publicKey));

    const privateKey = pkcs8Bytes.slice(PKCS8_PREFIX.length);
    const publicKey = spkiBytes.slice(SPKI_PREFIX_LEN);

    return buildIdentity(privateKey, publicKey);
  } catch {
    return null;
  }
}

async function buildIdentity(privateKey: Uint8Array, publicKey: Uint8Array): Promise<FullIdentity> {
  const { subtle } = globalThis.crypto;
  const privCryptoKey = await subtle.importKey(
    'pkcs8',
    makePkcs8(privateKey),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  const identity: FullIdentity = {
    publicKey,
    did: makeDid(publicKey),
    _privateKey: privateKey,
    async sign(data: Uint8Array): Promise<Uint8Array> {
      return new Uint8Array(
        await subtle.sign('Ed25519', privCryptoKey, toArrayBuffer(data)),
      );
    },
  };
  return identity;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

interface PersistedIdentity {
  pub: string;  // base64url
  priv: string; // base64url
}

function saveIdentity(privateKey: Uint8Array, publicKey: Uint8Array): void {
  try {
    const data: PersistedIdentity = {
      pub: bytesToBase64url(publicKey),
      priv: bytesToBase64url(privateKey),
    };
    const str = JSON.stringify(data);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, str);
    }
  } catch {
    // Storage unavailable — identity is ephemeral
  }
}

function loadIdentity(): { privateKey: Uint8Array; publicKey: Uint8Array } | null {
  try {
    let str: string | null = null;
    if (typeof localStorage !== 'undefined') {
      str = localStorage.getItem(STORAGE_KEY);
    }
    if (!str) return null;
    const data = JSON.parse(str) as PersistedIdentity;
    return {
      privateKey: base64urlToBytes(data.priv),
      publicKey: base64urlToBytes(data.pub),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _cached: FullIdentity | null = null;

/**
 * Get or create the device's DOT identity.
 *
 * Uses WebCrypto Ed25519, persisted to localStorage (browser) or in-memory
 * (Node.js, where localStorage is absent). Calling again returns the same
 * identity unless reset() was called.
 */
export async function getOrCreateIdentity(): Promise<FullIdentity> {
  if (_cached) return _cached;

  // Try loading from storage
  const saved = loadIdentity();
  if (saved) {
    _cached = await buildIdentity(saved.privateKey, saved.publicKey);
    return _cached;
  }

  // Try WebCrypto generateKey
  const webCryptoId = await generateWebCryptoIdentity();
  if (webCryptoId) {
    saveIdentity(webCryptoId._privateKey, webCryptoId.publicKey);
    _cached = webCryptoId;
    return _cached;
  }

  // Fallback: @dot-protocol/core createKeypair (uses @noble/curves)
  const kp = await createKeypair();
  _cached = await buildIdentity(kp.privateKey, kp.publicKey);
  saveIdentity(kp.privateKey, kp.publicKey);
  return _cached;
}

/**
 * Reset the cached identity. Next call to getOrCreateIdentity() creates fresh.
 * Used by engine shutdown between tests.
 */
export function resetIdentityCache(): void {
  _cached = null;
}
