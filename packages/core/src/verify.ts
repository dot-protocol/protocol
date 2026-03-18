import type { DOT } from './types.js';
import { toBytes, signedBytes, toArrayBuffer } from './bytes.js';
import { importPublicKey } from './keypair.js';

export async function verifyDOT(dot: DOT): Promise<boolean> {
  try {
    const buf = toBytes(dot);
    const pubCryptoKey = await importPublicKey(dot.pubkey);
    return await crypto.subtle.verify(
      'Ed25519', pubCryptoKey,
      toArrayBuffer(dot.sig),
      toArrayBuffer(signedBytes(buf))
    );
  } catch {
    return false;
  }
}

export async function checkChain(
  dots: DOT[]
): Promise<{ valid: true } | { valid: false; brokenAt: number; reason: string }> {
  if (dots.length === 0) return { valid: true };

  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i]!;
    if (!await verifyDOT(dot)) {
      return { valid: false, brokenAt: i, reason: `Invalid signature at index ${i}` };
    }
    if (i > 0) {
      const prevBytes = toBytes(dots[i - 1]!);
      const expectedChain = new Uint8Array(
        await crypto.subtle.digest('SHA-256', toArrayBuffer(prevBytes))
      );
      if (!expectedChain.every((b, j) => b === dot.chain[j])) {
        return { valid: false, brokenAt: i, reason: `Broken chain link at index ${i}` };
      }
    }
  }
  return { valid: true };
}
