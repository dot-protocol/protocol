import { DotType, OFF, DOT_SIZE, PAYLOAD_SIZE, CHAIN_SIZE } from './types.js';
import type { DOT, CreateDOTInput } from './types.js';
import { toBytes, fromBytes, signedBytes } from './bytes.js';
import { importPrivateKey } from './keypair.js';

const enc = new TextEncoder();

/** Ensure a Uint8Array has its own ArrayBuffer (required by Web Crypto API under strict TS). */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  if (arr.byteOffset === 0 && arr.byteLength === arr.buffer.byteLength) {
    return arr.buffer as ArrayBuffer;
  }
  return arr.slice(0).buffer as ArrayBuffer;
}

export async function createDOT(input: CreateDOTInput): Promise<DOT> {
  const { keypair, type = DotType.PUBLIC, ts = Date.now() } = input;

  const payload = new Uint8Array(PAYLOAD_SIZE);
  if (input.payload) {
    const raw = typeof input.payload === 'string'
      ? enc.encode(input.payload)
      : input.payload;
    if (raw.length > PAYLOAD_SIZE) {
      throw new Error(`Payload too large: ${raw.length} bytes (max ${PAYLOAD_SIZE})`);
    }
    payload.set(raw);
  }

  const chain = new Uint8Array(CHAIN_SIZE);
  if (input.previous) {
    const prevBytes = input.previous instanceof Uint8Array
      ? input.previous
      : toBytes(input.previous);
    const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(prevBytes));
    chain.set(new Uint8Array(hash));
  }

  const buf = new Uint8Array(DOT_SIZE);
  buf.set(keypair.publicKey, OFF.PUBKEY);
  buf.set(chain, OFF.CHAIN);

  const view = new DataView(buf.buffer as ArrayBuffer, OFF.TS, 8);
  view.setBigInt64(0, BigInt(ts), false);

  buf[OFF.TYPE] = type;
  buf.set(payload, OFF.PAYLOAD);

  const privKey = await importPrivateKey(keypair.privateKey);
  const sig = new Uint8Array(
    await crypto.subtle.sign('Ed25519', privKey, toArrayBuffer(signedBytes(buf)))
  );
  buf.set(sig, OFF.SIG);

  return fromBytes(buf);
}
