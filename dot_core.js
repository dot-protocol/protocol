/**
 * DOT Protocol — JS Core
 * Version 1.0.0 · doi.org/10.5281/zenodo.18946074
 * Zero dependencies · Node 18+ · MIT
 *
 * A DOT is a contact between two things that changes both. 153 bytes.
 *
 * Layout:
 *   [0..31]   pubkey   32B  Ed25519 public key — WHO
 *   [32..95]  sig      64B  Ed25519 signature  — PROOF
 *   [96..127] chain    32B  SHA-256(prev DOT), or 32 zero bytes — SEQUENCE
 *   [128..135] ts       8B  Unix ms, big-endian int64 — WHEN
 *   [136]     type      1B  visibility byte — WHAT KIND
 *   [137..152] payload 16B  zero-padded content — WHAT
 *
 * Signed bytes: pubkey(32) + chain(32) + ts(8) + type(1) + payload(16) = 89 bytes
 */

const { subtle } = globalThis.crypto;

// ── Constants ──────────────────────────────────────────────────────────────

export const TYPE = {
  PUBLIC:    0x00,
  CIRCLE:    0x01,
  PRIVATE:   0x02,
  EPHEMERAL: 0x03,
};

const DOT_SIZE       = 153;
const PUBKEY_OFF     = 0;
const SIG_OFF        = 32;
const CHAIN_OFF      = 96;
const TS_OFF         = 128;
const TYPE_OFF       = 136;
const PAYLOAD_OFF    = 137;
const SIGNED_SIZE    = 89;  // pubkey(32) + chain(32) + ts(8) + type(1) + payload(16)

// PKCS8 header for Ed25519 (RFC 8410) — 16 bytes prefix + 32-byte seed = 48 bytes total
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

// ── Internal helpers ───────────────────────────────────────────────────────

function _signedBytes(buf) {
  const out = new Uint8Array(SIGNED_SIZE);
  out.set(buf.subarray(PUBKEY_OFF, PUBKEY_OFF + 32), 0);   // pubkey
  out.set(buf.subarray(CHAIN_OFF, CHAIN_OFF + 57), 32);    // chain + ts + type + payload
  return out;
}

async function _importPriv(seed32) {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed32, PKCS8_PREFIX.length);
  return subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

async function _importPub(pub32) {
  return subtle.importKey('raw', pub32, { name: 'Ed25519' }, false, ['verify']);
}

// ── Keypair ────────────────────────────────────────────────────────────────

/**
 * Generate a new DOT identity keypair.
 * Returns { publicKey: Uint8Array(32), privateKey: Uint8Array(32), publicKeyObj, privateKeyObj }
 * Store privateKey (seed) securely — it IS the identity.
 */
export async function createKeypair() {
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubRaw     = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const privPkcs8  = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
  const privSeed   = privPkcs8.slice(-32);  // seed is always the last 32 bytes of PKCS8
  return {
    publicKey:    pubRaw,
    privateKey:   privSeed,
    publicKeyObj: kp.publicKey,
    privateKeyObj: kp.privateKey,
  };
}

// ── Create ─────────────────────────────────────────────────────────────────

/**
 * Create a DOT.
 * @param {object} opts
 * @param {object} opts.key       - Keypair from createKeypair()
 * @param {string|Uint8Array} [opts.payload]  - Up to 16 bytes (truncated silently)
 * @param {number} [opts.type]    - TYPE.PUBLIC (default), CIRCLE, PRIVATE, EPHEMERAL
 * @param {object} [opts.previous] - Previous DOT in chain (from fromBytes or createDot)
 * @returns {object} DOT object — call toBytes() to get wire format
 */
export async function createDot({ key, payload, type = TYPE.PUBLIC, previous } = {}) {
  const buf = new Uint8Array(DOT_SIZE);

  // [0..31] pubkey
  buf.set(key.publicKey, PUBKEY_OFF);

  // [96..127] chain hash — SHA-256 of previous DOT, or 32 zero bytes for genesis
  if (previous) {
    const prevBuf = toBytes(previous);
    const chainHash = new Uint8Array(await subtle.digest('SHA-256', prevBuf));
    buf.set(chainHash, CHAIN_OFF);
  }
  // else: remains zero bytes (genesis)

  // [128..135] timestamp — Unix ms, big-endian int64
  const tsView = new DataView(buf.buffer, TS_OFF, 8);
  tsView.setBigInt64(0, BigInt(Date.now()), false);

  // [136] type
  buf[TYPE_OFF] = type & 0xff;

  // [137..152] payload — up to 16 bytes, zero-padded
  if (payload) {
    const payBytes = typeof payload === 'string'
      ? new TextEncoder().encode(payload)
      : payload;
    buf.set(payBytes.subarray(0, 16), PAYLOAD_OFF);
  }

  // sign pubkey + chain + ts + type + payload
  const privKey = key.privateKeyObj ?? await _importPriv(key.privateKey);
  const sig = new Uint8Array(await subtle.sign('Ed25519', privKey, _signedBytes(buf)));
  buf.set(sig, SIG_OFF);

  return fromBytes(buf);
}

/**
 * Create a PING — an empty DOT with zero payload.
 * The default. Content is the exception.
 */
export function ping(key, previous) {
  return createDot({ key, previous });
}

// ── Serialization ──────────────────────────────────────────────────────────

/**
 * Serialize a DOT object to Uint8Array(153) wire format.
 */
export function toBytes(dot) {
  if (dot._buf) return dot._buf;  // cached from fromBytes
  const buf = new Uint8Array(DOT_SIZE);
  buf.set(dot.pubkey,  PUBKEY_OFF);
  buf.set(dot.sig,     SIG_OFF);
  buf.set(dot.chain,   CHAIN_OFF);
  const tsView = new DataView(buf.buffer, TS_OFF, 8);
  if (dot.ts == null || !Number.isFinite(dot.ts)) throw new Error(`toBytes: invalid ts value: ${dot.ts}`);
  tsView.setBigInt64(0, BigInt(dot.ts), false);
  buf[TYPE_OFF] = dot.type;
  buf.set(dot.payload, PAYLOAD_OFF);
  return buf;
}

/**
 * Reconstruct a DOT object from Uint8Array(153) wire format.
 * Throws if not exactly 153 bytes.
 */
export function fromBytes(buf) {
  if (buf.length !== DOT_SIZE) {
    throw new Error(`DOT must be exactly ${DOT_SIZE} bytes, got ${buf.length}`);
  }
  const tsView = new DataView(buf.buffer, buf.byteOffset + TS_OFF, 8);
  const dot = {
    pubkey:  buf.slice(PUBKEY_OFF, PUBKEY_OFF + 32),
    sig:     buf.slice(SIG_OFF,    SIG_OFF    + 64),
    chain:   buf.slice(CHAIN_OFF,  CHAIN_OFF  + 32),
    ts:      Number(tsView.getBigInt64(0, false)),
    type:    buf[TYPE_OFF],
    payload: buf.slice(PAYLOAD_OFF),
    size:    DOT_SIZE,
  };
  dot._buf = new Uint8Array(buf);  // cache wire bytes
  return dot;
}

// ── Verification ───────────────────────────────────────────────────────────

/**
 * Verify a DOT's Ed25519 signature.
 * Returns true if authentic and untampered, false otherwise.
 */
export async function verifyDot(dot) {
  try {
    const buf   = toBytes(dot);
    const pubKey = dot._pubKeyObj ?? await _importPub(dot.pubkey);
    return await subtle.verify('Ed25519', pubKey, dot.sig, _signedBytes(buf));
  } catch {
    return false;
  }
}

/**
 * Verify a chain of DOTs.
 * Checks signatures and SHA-256 chain links in sequence.
 * Returns { valid: true } or { valid: false, brokenAt: number, reason: string }
 */
export async function checkChain(dots) {
  for (let i = 0; i < dots.length; i++) {
    if (!await verifyDot(dots[i])) {
      return { valid: false, brokenAt: i, reason: 'signature invalid' };
    }
    if (i > 0) {
      const prevHash = new Uint8Array(await subtle.digest('SHA-256', toBytes(dots[i - 1])));
      for (let j = 0; j < 32; j++) {
        if (dots[i].chain[j] !== prevHash[j]) {
          return { valid: false, brokenAt: i, reason: 'chain hash mismatch' };
        }
      }
    }
  }
  return { valid: true };
}

// ── Inspection ─────────────────────────────────────────────────────────────

const TYPE_NAMES = { 0x00: 'public', 0x01: 'circle', 0x02: 'private', 0x03: 'ephemeral' };

/**
 * Human-readable summary of a DOT.
 * Returns { key, chain, time, type, payload, size }
 */
export function inspect(dot) {
  const hex  = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const isGenesis = dot.chain.every(b => b === 0);
  const payloadTrimmed = dot.payload.slice(0, dot.payload.findLastIndex(b => b !== 0) + 1);
  let payloadStr = null;
  try { payloadStr = payloadTrimmed.length ? new TextDecoder('utf-8', { fatal: true }).decode(payloadTrimmed) : null; } catch { /* binary */ }
  return {
    key:     hex(dot.pubkey).slice(0, 16) + '…',
    chain:   isGenesis ? 'genesis' : hex(dot.chain).slice(0, 16) + '…',
    time:    new Date(dot.ts).toISOString(),
    type:    TYPE_NAMES[dot.type] ?? `0x${dot.type.toString(16).padStart(2, '0')}`,
    payload: payloadStr,
    size:    DOT_SIZE,
  };
}

// ── Browser helpers ────────────────────────────────────────────────────────

/** Encode Uint8Array to base64 string */
export function dotToBase64(buf) {
  return btoa(String.fromCharCode(...buf));
}

/** Decode base64 string to Uint8Array */
export function dotFromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Encode Uint8Array to lowercase hex string */
export function dotToHex(buf) {
  return Array.from(buf, x => x.toString(16).padStart(2, '0')).join('');
}

/** Decode hex string to Uint8Array */
export function dotFromHex(hex) {
  if (hex.length % 2 !== 0) throw new Error('dotFromHex: hex string must have even length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── Sensor payload ─────────────────────────────────────────────────────────

/**
 * Pack sensor readings into 16-byte DOT payload.
 * Missing sensors default to zero. Big-endian throughout.
 */
export function packSensorPayload({ lat = 0, lng = 0, accelMag = 0, pressure = 0, heading = 0 } = {}) {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setFloat32(0, lat, false);
  v.setFloat32(4, lng, false);
  v.setUint16(8,  Math.round(accelMag), false);
  v.setUint16(10, Math.round(pressure), false);
  v.setUint16(12, Math.round(heading * 10), false);
  return new Uint8Array(buf);
}

/** Unpack a 16-byte payload back into sensor readings */
export function unpackSensorPayload(bytes) {
  if (bytes.length < 16) throw new Error('unpackSensorPayload: payload must be at least 16 bytes');
  const v = new DataView(bytes.buffer, bytes.byteOffset, 16);
  return {
    lat:      v.getFloat32(0, false),
    lng:      v.getFloat32(4, false),
    accelMag: v.getUint16(8, false),
    pressure: v.getUint16(10, false),
    heading:  v.getUint16(12, false) / 10,
  };
}

// ── IndexedDB ──────────────────────────────────────────────────────────────

const _DB_NAME    = 'dot-chain-v1';
const _DB_VERSION = 1;
const _KP_STORE   = 'keypair';
const _CHAIN_STORE = 'chain';

/** Open (or create) the DOT chain database */
export function openDotDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_KP_STORE))
        db.createObjectStore(_KP_STORE);
      if (!db.objectStoreNames.contains(_CHAIN_STORE))
        db.createObjectStore(_CHAIN_STORE, { autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/** Persist keypair — stores publicKey and privateKey (seeds) separately */
export function dbStoreKeypair(db, kp) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_KP_STORE, 'readwrite');
    const s  = tx.objectStore(_KP_STORE);
    s.put(kp.publicKey,  'pub');
    s.put(kp.privateKey, 'priv');
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/** Load keypair — returns null if not yet generated */
export function dbLoadKeypair(db) {
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(_KP_STORE, 'readonly');
    const s    = tx.objectStore(_KP_STORE);
    const pub  = s.get('pub');
    const priv = s.get('priv');
    tx.oncomplete = () =>
      (pub.result && priv.result)
        ? resolve({ publicKey: pub.result, privateKey: priv.result })
        : resolve(null);
    tx.onerror = e => reject(e.target.error);
  });
}

/** Append a signed DOT (153-byte Uint8Array) to the chain */
export function dbAppendDot(db, dotBytes) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_CHAIN_STORE, 'readwrite');
    tx.objectStore(_CHAIN_STORE).add(dotBytes);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/** Load all DOTs in insertion order — returns array of DOT objects */
export function dbLoadChain(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_CHAIN_STORE, 'readonly');
    const req = tx.objectStore(_CHAIN_STORE).getAll();
    req.onsuccess = () => resolve(req.result.map(fromBytes));
    req.onerror   = e => reject(e.target.error);
  });
}

/** Load the most recent N DOTs (for chain head) */
export function dbLoadHead(db, n = 1) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(_CHAIN_STORE, 'readonly');
    const store = tx.objectStore(_CHAIN_STORE);
    const req   = store.openCursor(null, 'prev');
    const results = [];
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor && results.length < n) {
        results.unshift(fromBytes(cursor.value));
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = e => reject(e.target.error);
  });
}
