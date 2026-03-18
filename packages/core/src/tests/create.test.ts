import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT, toBytes } from '../index.js';
import { DOT_SIZE, DotType } from '../types.js';

describe('createDOT', () => {
  it('produces exactly 153 bytes', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp });
    expect(toBytes(dot).length).toBe(DOT_SIZE);
  });

  it('genesis DOT has 32 zero bytes in chain field', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp });
    expect([...dot.chain].every(b => b === 0)).toBe(true);
  });

  it('DOT with payload encodes string as UTF-8', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, payload: 'hello' });
    const helloBytes = new TextEncoder().encode('hello');
    expect(dot.payload.slice(0, 5)).toEqual(helloBytes);
  });

  it('payload larger than 16 bytes throws', async () => {
    const kp = await createKeypair();
    await expect(createDOT({ keypair: kp, payload: 'a'.repeat(17) }))
      .rejects.toThrow();
  });

  it('sets type correctly', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp, type: DotType.PRIVATE });
    expect(dot.type).toBe(DotType.PRIVATE);
  });

  it('chained DOT has previous DOT hash in chain field', async () => {
    const kp = await createKeypair();
    const genesis = await createDOT({ keypair: kp });
    const genesisBytes = toBytes(genesis);
    const child = await createDOT({ keypair: kp, previous: genesisBytes });
    expect([...child.chain].every(b => b === 0)).toBe(false);
  });

  it('deterministic with fixed timestamp', async () => {
    const kp = await createKeypair(new Uint8Array(32).fill(1));
    const ts = 1741564800000;
    const dot1 = await createDOT({ keypair: kp, ts });
    const dot2 = await createDOT({ keypair: kp, ts });
    expect(toBytes(dot1)).toEqual(toBytes(dot2));
  });
});
