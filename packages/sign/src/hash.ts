/**
 * @dotprotocol/sign — Hashing utilities
 *
 * SHA-256 content hashing and truncation for DOT payloads.
 */

import { PAYLOAD_SIZE } from '@dotprotocol/core';

/** Compute full SHA-256 hash of content */
export async function contentHash(content: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', content);
  return new Uint8Array(hash);
}

/** Compute truncated SHA-256 hash (first 16 bytes) for DOT payload */
export async function truncatedHash(content: Uint8Array): Promise<Uint8Array> {
  const full = await contentHash(content);
  return full.slice(0, PAYLOAD_SIZE);
}
