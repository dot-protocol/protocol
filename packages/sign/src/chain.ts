/**
 * @dotprotocol/sign — chain()
 *
 * Chain integrity verification and extension.
 */

import { checkChain, toBytes, fromBytes } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import type { SignedDOT, ChainResult } from './types.js';

/** Verify chain integrity for an array of DOTs (any supported format) */
export async function chain(dots: Array<SignedDOT | DOT | Uint8Array>): Promise<ChainResult> {
  const resolved: DOT[] = dots.map((d) => {
    if (d instanceof Uint8Array) return fromBytes(d);
    if ('dot' in d && 'bytes' in d) return (d as SignedDOT).dot;
    return d as DOT;
  });

  const result = await checkChain(resolved);
  if (result.valid) {
    return { valid: true, length: resolved.length };
  }
  return {
    valid: false,
    length: resolved.length,
    brokenAt: result.brokenAt,
    reason: result.reason,
  };
}
