import { DOT_SIZE, OFF, PUBKEY_SIZE, SIG_SIZE, CHAIN_SIZE, PAYLOAD_SIZE } from './types.js';
import type { DOT } from './types.js';

export function toBytes(dot: DOT): Uint8Array {
  const buf = new Uint8Array(DOT_SIZE);
  buf.set(dot.pubkey, OFF.PUBKEY);
  buf.set(dot.sig, OFF.SIG);
  buf.set(dot.chain, OFF.CHAIN);
  const view = new DataView(buf.buffer as ArrayBuffer, OFF.TS, 8);
  view.setBigInt64(0, BigInt(dot.ts), false);
  buf[OFF.TYPE] = dot.type;
  buf.set(dot.payload, OFF.PAYLOAD);
  return buf;
}

export function fromBytes(buf: Uint8Array): DOT {
  if (buf.length !== DOT_SIZE) {
    throw new Error(`DOT must be ${DOT_SIZE} bytes, got ${buf.length}`);
  }
  const view = new DataView(buf.buffer as ArrayBuffer, buf.byteOffset + OFF.TS, 8);
  return {
    pubkey: buf.slice(OFF.PUBKEY, OFF.PUBKEY + PUBKEY_SIZE),
    sig: buf.slice(OFF.SIG, OFF.SIG + SIG_SIZE),
    chain: buf.slice(OFF.CHAIN, OFF.CHAIN + CHAIN_SIZE),
    ts: Number(view.getBigInt64(0, false)),
    type: buf[OFF.TYPE] as number,
    payload: buf.slice(OFF.PAYLOAD, OFF.PAYLOAD + PAYLOAD_SIZE),
  };
}

export function signedBytes(buf: Uint8Array): Uint8Array {
  // pubkey(32) + chain(32) + ts(8) + type(1) + payload(16) = 89 bytes
  const out = new Uint8Array(89);
  out.set(buf.subarray(OFF.PUBKEY, OFF.PUBKEY + 32), 0);
  out.set(buf.subarray(OFF.CHAIN, DOT_SIZE), 32);
  return out;
}
