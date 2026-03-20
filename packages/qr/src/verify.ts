/**
 * DOT Protocol v0.3.0 — QR-DOT Verifier
 *
 * Verify all DOTs decoded from a QR payload.
 * Checks Ed25519 signatures and optionally chain integrity.
 */

import { verifyDOT, checkChain } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import type { QRDecodeResult, QREncoding } from './types.js';

/**
 * Verify an array of DOTs decoded from a physical QR.
 * Each DOT's Ed25519 signature is checked individually.
 * If all DOTs share the same pubkey, chain integrity is also verified.
 */
export async function verifyPhysicalDOTs(
  dots: DOT[],
  encoding: QREncoding
): Promise<QRDecodeResult> {
  const errors: string[] = [];

  // Individual signature checks
  for (let i = 0; i < dots.length; i++) {
    const ok = await verifyDOT(dots[i]);
    if (!ok) {
      errors.push(`DOT[${i}] signature invalid`);
    }
  }

  // Chain integrity check if all DOTs share the same pubkey
  if (dots.length > 1) {
    const firstKey = dots[0].pubkey;
    const sameKey = dots.every((d) => d.pubkey.every((b, j) => b === firstKey[j]));

    if (sameKey) {
      const chainResult = await checkChain(dots);
      if (!chainResult.valid) {
        errors.push(`Chain broken at index ${chainResult.brokenAt}: ${chainResult.reason}`);
      }
    }
  }

  return {
    dots,
    encoding,
    verified: errors.length === 0,
    errors,
  };
}
