/**
 * DOT Protocol — Browser Core
 * Version 1.0.0 · doi.org/10.5281/zenodo.18946074
 * Zero dependencies · Web Crypto API · MIT
 *
 * Same 153-byte format as dot.mjs.
 * Optimized for browser bundle size — no Node-isms.
 * Re-exports everything from dot.mjs (same Web Crypto API in both environments).
 *
 * Usage:
 *   import { createKeypair, createDot, verifyDot, ping, TYPE } from './dot.browser.mjs'
 */

export {
  TYPE,
  createKeypair,
  createDot,
  verifyDot,
  checkChain,
  toBytes,
  fromBytes,
  ping,
  inspect,
} from './dot.mjs';

/**
 * Encode a DOT as a base64 string for URL-safe transport (QR codes, SMS, URLs).
 * @param {Uint8Array} buf - 153-byte DOT
 * @returns {string} Base64-encoded DOT
 */
export function dotToBase64(buf) {
  return btoa(String.fromCharCode(...buf));
}

/**
 * Decode a base64 DOT string back to Uint8Array(153).
 * @param {string} b64 - Base64-encoded DOT
 * @returns {Uint8Array} 153-byte DOT
 */
export function dotFromBase64(b64) {
  return new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
}

/**
 * Encode a DOT as a hex string (for display and debugging).
 */
export function dotToHex(buf) {
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a hex-encoded DOT.
 */
export function dotFromHex(hex) {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < buf.length; i++) buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return buf;
}

/**
 * Generate a DOT URI for sharing.
 * dot://pubkey-prefix/timestamp/type/genesis-or-chain-prefix
 */
export function dotURI(dot) {
  const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const typeStr = ['public', 'circle', 'private', 'ephemeral'][dot.type] ?? 'unknown';
  const isGenesis = dot.chain.every(b => b === 0);
  const ts = new Date(dot.ts).toISOString();
  const chain = isGenesis ? 'genesis' : hex(dot.chain).slice(0, 8);
  return `dot://${hex(dot.pubkey).slice(0, 8)}/${ts}/${typeStr}/${chain}`;
}
