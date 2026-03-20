import { createKeypair, createDOT, DotType, toBytes, fromBytes } from '@dotprotocol/core';
import type { DOT, Keypair } from '@dotprotocol/core';

export interface Identity {
  keypair: Keypair;
  genesisDOT: DOT;
  createdAt: number;
}

export interface ExportedIdentity {
  publicKey: string;   // hex
  privateKey: string;  // hex — store securely
  genesisDOT: string;  // hex (153 bytes)
  createdAt: number;
}

/** Create a new identity with a random keypair and genesis DOT. */
export async function createIdentity(seed?: Uint8Array): Promise<Identity> {
  const keypair = await createKeypair(seed);
  const createdAt = Date.now();
  const genesisDOT = await createDOT({
    keypair,
    type: DotType.PUBLIC,
    ts: createdAt,
  });
  return { keypair, genesisDOT, createdAt };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Export identity as hex strings for storage.
 * WARNING: The returned object contains the raw private key as a hex string.
 * Never log, transmit, or persist this to an untrusted location.
 */
export function exportIdentity(id: Identity): ExportedIdentity {
  return {
    publicKey: toHex(id.keypair.publicKey),
    privateKey: toHex(id.keypair.privateKey),
    genesisDOT: toHex(toBytes(id.genesisDOT)),
    createdAt: id.createdAt,
  };
}

/** Import identity from exported hex strings. */
export async function importIdentity(exported: ExportedIdentity): Promise<Identity> {
  const keypair: Keypair = {
    publicKey: fromHex(exported.publicKey),
    privateKey: fromHex(exported.privateKey),
  };
  const genesisDOT = fromBytes(fromHex(exported.genesisDOT));
  return { keypair, genesisDOT, createdAt: exported.createdAt };
}
