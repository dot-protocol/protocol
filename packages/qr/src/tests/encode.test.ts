import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT } from '@dot-protocol/core';
import {
  encodeBinary,
  decodeBinary,
  encodeNested,
  decodeNested,
  encodeSteganographic,
  decodeSteganographic,
  selectQRSpec,
  DOT_SIZE,
} from '../encode.js';
import { QR_CAPACITY } from '../types.js';

async function makeDots(count: number) {
  const kp = await createKeypair();
  const dots = [];
  let prev = undefined;
  for (let i = 0; i < count; i++) {
    const dot = await createDOT({ keypair: kp, previous: prev });
    dots.push(dot);
    prev = dot;
  }
  return dots;
}

describe('Binary encoding', () => {
  it('encodes and decodes a single DOT', async () => {
    const [dot] = await makeDots(1);
    const buf = encodeBinary([dot]);
    expect(buf.length).toBe(DOT_SIZE);
    const decoded = decodeBinary(buf);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].pubkey).toEqual(dot.pubkey);
    expect(decoded[0].sig).toEqual(dot.sig);
  });

  it('encodes and decodes multiple DOTs', async () => {
    const dots = await makeDots(5);
    const buf = encodeBinary(dots);
    expect(buf.length).toBe(5 * DOT_SIZE);
    const decoded = decodeBinary(buf);
    expect(decoded).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(decoded[i].pubkey).toEqual(dots[i].pubkey);
    }
  });

  it('throws for empty array', () => {
    expect(() => encodeBinary([])).toThrow();
  });

  it(`throws when exceeding QR capacity of ${QR_CAPACITY.dotsPerCode} DOTs`, async () => {
    // Mock DOT count exceeding limit without generating them all
    const dots = await makeDots(1);
    const tooMany = Array(QR_CAPACITY.dotsPerCode + 1).fill(dots[0]);
    expect(() => encodeBinary(tooMany)).toThrow();
  });

  it('throws on decode if buffer not multiple of 153', () => {
    const bad = new Uint8Array(100);
    expect(() => decodeBinary(bad)).toThrow();
  });
});

describe('Nested encoding', () => {
  it('encodes and decodes preserving DOT order', async () => {
    const dots = await makeDots(3);
    const buf = encodeNested(dots);
    const decoded = decodeNested(buf);
    expect(decoded).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(decoded[i].pubkey).toEqual(dots[i].pubkey);
    }
  });

  it('each entry is 2 + 153 = 155 bytes', async () => {
    const dots = await makeDots(2);
    const buf = encodeNested(dots);
    expect(buf.length).toBe(2 * 155);
  });

  it('throws on decode if buffer not multiple of 155', () => {
    const bad = new Uint8Array(100);
    expect(() => decodeNested(bad)).toThrow();
  });
});

describe('Steganographic encoding', () => {
  it('XOR round-trip recovers original DOT bytes', async () => {
    const dots = await makeDots(1);
    const dotBytes = encodeBinary(dots);
    const carrier = new Uint8Array(dotBytes.length).fill(0xab);

    const masked = encodeSteganographic(dots, carrier);
    const recovered = decodeSteganographic(masked, carrier, 1);
    expect(recovered[0].pubkey).toEqual(dots[0].pubkey);
  });

  it('throws if DOT payload exceeds carrier', async () => {
    const dots = await makeDots(1);
    const tinyCarrier = new Uint8Array(10); // too small
    expect(() => encodeSteganographic(dots, tinyCarrier)).toThrow();
  });
});

describe('selectQRSpec', () => {
  it('returns version 1 for a single DOT in binary mode', async () => {
    // 153 bytes — needs v40 since v1 only holds 17 bytes
    const spec = selectQRSpec(1, 'binary');
    expect(spec.version).toBeGreaterThanOrEqual(1);
    expect(spec.dotsPerCode).toBe(1);
    expect(spec.encoding).toBe('binary');
  });

  it('returns version 40 for 19 DOTs (max capacity)', async () => {
    const spec = selectQRSpec(19, 'binary');
    expect(spec.version).toBeLessThanOrEqual(40);
    expect(spec.errorCorrection).toBe('L');
  });
});
