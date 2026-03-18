import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes } from '../index.js';

describe('verifyDOT', () => {
  it('returns true for valid DOT', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    expect(await verifyDOT(dot)).toBe(true);
  });

  it('returns false when signature is tampered', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    const dotBytes = toBytes(dot);
    // Flip a byte in the signature region (bytes 32..95)
    dotBytes.set([dotBytes[40]! ^ 0xff], 40);
    const tamperedDOT = fromBytes(dotBytes);
    expect(await verifyDOT(tamperedDOT)).toBe(false);
  });

  it('returns false when payload is tampered', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'test' });
    const dotBytes = toBytes(dot);
    // Flip a byte in the payload region (bytes 137..152)
    dotBytes.set([dotBytes[140]! ^ 0xff], 140);
    const tamperedDOT = fromBytes(dotBytes);
    expect(await verifyDOT(tamperedDOT)).toBe(false);
  });
});

describe('checkChain', () => {
  it('validates a chain of DOTs', async () => {
    const kp = await createKeypair();
    const d1 = await createDOT({ keypair: kp });
    const d2 = await createDOT({ keypair: kp, previous: toBytes(d1) });
    const d3 = await createDOT({ keypair: kp, previous: toBytes(d2) });
    const result = await checkChain([d1, d2, d3]);
    expect(result.valid).toBe(true);
  });

  it('detects broken chain link', async () => {
    const kp = await createKeypair();
    const d1 = await createDOT({ keypair: kp });
    const d2 = await createDOT({ keypair: kp });
    const result = await checkChain([d1, d2]);
    expect(result.valid).toBe(false);
  });

  it('empty chain is valid', async () => {
    const result = await checkChain([]);
    expect(result.valid).toBe(true);
  });
});
