/**
 * @dotprotocol/sign — verify()
 *
 * Verify a DOT's signature. < 1ms. No handshake. No CA.
 */

import { verifyDOT, fromBytes } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import type { SignedDOT } from './types.js';

/** Verify a SignedDOT, a DOT object, or raw 153 bytes */
export async function verify(input: SignedDOT | DOT | Uint8Array): Promise<boolean> {
  if (input instanceof Uint8Array) {
    const dot = fromBytes(input);
    return verifyDOT(dot);
  }
  if ('dot' in input && 'bytes' in input) {
    // SignedDOT
    return verifyDOT(input.dot);
  }
  // DOT object
  return verifyDOT(input as DOT);
}
