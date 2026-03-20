// @dotprotocol/wrapper — dot.id() hardware-bound identity
//
// Generates an Ed25519 keypair, encrypts the private key with AES-256-GCM
// (key derived via PBKDF2 from a passphrase), and stores it on disk.
// The private key is held in a closure and never returned directly.

import { createHash, createCipheriv, createDecipheriv, randomBytes, pbkdf2 } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';

// ─── PKCS8 / SPKI constants (matches core/src/keypair.ts) ─────────────────────

const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_PREFIX_LEN = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function makePkcs8(seed: Uint8Array): ArrayBuffer {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed, PKCS8_PREFIX.length);
  return pkcs8.buffer as ArrayBuffer;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    pbkdf2(passphrase, salt, 100_000, 32, 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// ─── Stored key file format ────────────────────────────────────────────────────

interface StoredKey {
  version: 1;
  salt: string;       // hex 32B
  iv: string;         // hex 12B
  ciphertext: string; // hex — AES-256-GCM encrypted 32B private key seed
  tag: string;        // hex 16B GCM authentication tag
  publicKey: string;  // hex 32B
}

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A DOT identity bound to this device.
 * Private key never leaves the secure storage.
 */
export interface DotIdentity {
  /** Ed25519 public key (32B) */
  publicKey: Uint8Array;
  /** DOT ID string — base64url-encoded public key, prefixed "dot:" */
  did: string;
  /**
   * Sign data with the private key.
   * @param data - Bytes to sign
   * @returns 64-byte Ed25519 signature
   */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /**
   * Verify a signature from any DOT identity.
   * @param data - Original bytes
   * @param signature - 64-byte Ed25519 signature
   * @param publicKey - Signer's public key (defaults to this identity's key)
   */
  verify(data: Uint8Array, signature: Uint8Array, publicKey?: Uint8Array): Promise<boolean>;
  /**
   * Export the public key as a Base64URL string.
   */
  export(): string;
  /**
   * PUF fingerprint if hardware supports it (always null in this implementation).
   * Future: tie to TPM or Secure Enclave.
   */
  puf: null;
}

export interface IdentityOptions {
  /**
   * Storage path for the encrypted key file (Node.js only).
   * Default: ~/.dot-protocol/identity.key
   */
  storagePath?: string;
  /**
   * Passphrase for encrypting the key at rest.
   * Default: uses a machine-unique derivation (hostname + username).
   * For production, pass an explicit passphrase from the user.
   */
  passphrase?: string;
  /**
   * If true, create a new identity even if one already exists.
   * Default: false (reuse existing)
   */
  forceNew?: boolean;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Get or create a DOT identity bound to this device.
 *
 * First call: generates an Ed25519 keypair, encrypts it with AES-256-GCM,
 * stores it at the storage path.
 * Subsequent calls: loads and decrypts the existing keypair.
 *
 * The private key is held in memory only as long as the DotIdentity object
 * is referenced. It is never returned directly.
 *
 * @example
 * const identity = await dotId();
 * console.log(identity.did); // "dot:abc123..."
 * const sig = await identity.sign(new TextEncoder().encode('hello'));
 * const valid = await identity.verify(new TextEncoder().encode('hello'), sig);
 * // valid === true
 *
 * @example
 * // Use a specific passphrase for portability
 * const identity = await dotId({ passphrase: 'my-secret-phrase' });
 */
export async function dotId(options?: IdentityOptions): Promise<DotIdentity> {
  const storagePath = options?.storagePath
    ?? join(homedir(), '.dot-protocol', 'identity.key');

  const passphrase = options?.passphrase
    ?? createHash('sha256')
        .update(hostname())
        .update(process.env['USER'] ?? 'default')
        .digest('hex')
        .slice(0, 32);

  const forceNew = options?.forceNew ?? false;

  let privateKeySeed: Uint8Array;
  let publicKeyBytes: Uint8Array;

  if (!forceNew && existsSync(storagePath)) {
    // Load and decrypt existing key
    const stored: StoredKey = JSON.parse(readFileSync(storagePath, 'utf8')) as StoredKey;
    if (stored.version !== 1) {
      throw new Error(`dot.id: unsupported key file version ${stored.version}`);
    }

    const salt = Buffer.from(stored.salt, 'hex');
    const iv = Buffer.from(stored.iv, 'hex');
    const ciphertext = Buffer.from(stored.ciphertext, 'hex');
    const tag = Buffer.from(stored.tag, 'hex');

    const aesKey = await deriveKey(passphrase, salt);

    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    privateKeySeed = new Uint8Array(decrypted);
    publicKeyBytes = Buffer.from(stored.publicKey, 'hex');
  } else {
    // Generate new keypair using Web Crypto (consistent with core/src/keypair.ts)
    const { subtle } = globalThis.crypto;
    const { privateKey: privCryptoKey, publicKey: pubCryptoKey } =
      await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);

    const pkcs8Exported = new Uint8Array(await subtle.exportKey('pkcs8', privCryptoKey));
    const spkiExported = new Uint8Array(await subtle.exportKey('spki', pubCryptoKey));

    // Seed is the last 32 bytes of PKCS8 export (matches core/src/keypair.ts)
    privateKeySeed = pkcs8Exported.slice(PKCS8_PREFIX.length);
    publicKeyBytes = spkiExported.slice(SPKI_PREFIX_LEN);

    // Encrypt and persist
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const aesKey = await deriveKey(passphrase, salt);

    const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKeySeed)),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const stored: StoredKey = {
      version: 1,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      tag: tag.toString('hex'),
      publicKey: Buffer.from(publicKeyBytes).toString('hex'),
    };

    // Ensure directory exists
    const dir = dirname(storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(storagePath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }

  // Import the signing key for Web Crypto (private key held in closure)
  const { subtle } = globalThis.crypto;
  const signingKey = await subtle.importKey(
    'pkcs8',
    makePkcs8(privateKeySeed),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  // Zero out seed after importing into CryptoKey object
  // (CryptoKey is the non-extractable holder going forward)
  privateKeySeed.fill(0);

  // Always use a clean Uint8Array (not a Buffer pool view) for consistent ArrayBuffer ownership
  const pubKeySnapshot = new Uint8Array(publicKeyBytes);

  const identity: DotIdentity = {
    publicKey: pubKeySnapshot,
    did: `dot:${base64url(pubKeySnapshot)}`,
    puf: null,

    async sign(data: Uint8Array): Promise<Uint8Array> {
      const sig = await subtle.sign({ name: 'Ed25519' }, signingKey, data);
      return new Uint8Array(sig);
    },

    async verify(
      data: Uint8Array,
      signature: Uint8Array,
      publicKey?: Uint8Array,
    ): Promise<boolean> {
      try {
        const keyBytes = publicKey ?? pubKeySnapshot;
        // Always create a fresh ArrayBuffer copy — Node.js Buffer pool means
        // .buffer may be a large shared pool, not the 32-byte key alone.
        const raw = new Uint8Array(keyBytes).buffer as ArrayBuffer;
        const verifyKey = await subtle.importKey(
          'raw',
          raw,
          { name: 'Ed25519' },
          false,
          ['verify'],
        );
        return subtle.verify({ name: 'Ed25519' }, verifyKey, signature, data);
      } catch {
        return false;
      }
    },

    export(): string {
      return base64url(pubKeySnapshot);
    },
  };

  return identity;
}
