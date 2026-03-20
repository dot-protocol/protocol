/**
 * @dotprotocol/sign — sign()
 *
 * Universal signing. Content is opaque. Any size.
 * If content <= 16 bytes, stored directly in payload.
 * If content > 16 bytes, truncated SHA-256 hash stored in payload.
 */

import { createDOT, toBytes, PAYLOAD_SIZE } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import { truncatedHash, contentHash } from './hash.js';
import { TeachByte } from './types.js';
import type { SignInput, SignedDOT } from './types.js';

const enc = new TextEncoder();

export async function sign(input: SignInput): Promise<SignedDOT> {
  const {
    key,
    access,
    face = 0,
    teach = TeachByte.None,
    transform,
    ts,
  } = input;

  // Resolve content to bytes
  let contentBytes: Uint8Array | undefined;
  if (input.content !== undefined) {
    contentBytes = typeof input.content === 'string'
      ? enc.encode(input.content)
      : input.content;
  }

  // Determine payload: direct if <=16B, truncated hash if >16B
  let payload: Uint8Array | undefined;
  let cHash: Uint8Array | undefined;

  if (contentBytes !== undefined) {
    if (contentBytes.length <= PAYLOAD_SIZE) {
      payload = contentBytes;
    } else {
      // Content too large for payload — store truncated hash as pointer
      cHash = await contentHash(contentBytes);
      payload = await truncatedHash(contentBytes);
    }
  }

  // Resolve previous chain hash
  let previous: Uint8Array | undefined;
  if (input.prev) {
    previous = input.prev;
  }

  // Create the core DOT
  const dot: DOT = await createDOT({
    keypair: key,
    payload,
    type: access,
    previous,
    ts,
  });

  // Set face mask on DOT
  if (face !== 0) {
    dot.faceMask = face;
  }

  const bytes = toBytes(dot);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

  return {
    dot,
    bytes,
    hash,
    face,
    teach,
    transform,
    contentHash: cHash,
  };
}
