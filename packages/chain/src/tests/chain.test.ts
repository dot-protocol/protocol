import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT, toBytes, fromBytes } from '@dot-protocol/core';
import { createChain, appendDOT, getHead, getRange, verifyChain } from '../index.js';
import { MemoryStorage } from '../index.js';

async function makeChain(length: number) {
  const kp = await createKeypair();
  const genesis = await createDOT({ keypair: kp });
  const chain = await createChain(genesis);
  const dots = [genesis];
  for (let i = 1; i < length; i++) {
    const dot = await createDOT({ keypair: kp, previous: toBytes(dots[i - 1]!) });
    await appendDOT(chain, dot);
    dots.push(dot);
  }
  return { chain, kp, dots };
}

describe('createChain', () => {
  it('creates a chain with the genesis DOT', async () => {
    const kp = await createKeypair();
    const genesis = await createDOT({ keypair: kp });
    const chain = await createChain(genesis);
    const head = await getHead(chain);
    expect(head).toBeDefined();
    expect(head!.pubkey).toEqual(genesis.pubkey);
  });

  it('accepts a custom storage backend', async () => {
    const kp = await createKeypair();
    const genesis = await createDOT({ keypair: kp });
    const storage = new MemoryStorage();
    const chain = await createChain(genesis, storage);
    expect(storage.length()).toBe(1);
  });
});

describe('appendDOT', () => {
  it('appends a valid chained DOT', async () => {
    const { chain } = await makeChain(2);
    const result = await verifyChain(chain);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(2);
  });

  it('throws when chain link is broken (DOT not chained from head)', async () => {
    const kp = await createKeypair();
    const genesis = await createDOT({ keypair: kp });
    const chain = await createChain(genesis);
    // Create a DOT that is NOT chained from genesis
    const unlinked = await createDOT({ keypair: kp });
    await expect(appendDOT(chain, unlinked)).rejects.toThrow('Chain link broken');
  });

  it('throws when DOT has invalid signature', async () => {
    const kp = await createKeypair();
    const genesis = await createDOT({ keypair: kp });
    const chain = await createChain(genesis);
    const valid = await createDOT({ keypair: kp, previous: toBytes(genesis) });
    const validBytes = toBytes(valid);
    // Tamper with the signature
    const byte40 = validBytes[40] ?? 0;
    validBytes[40] = byte40 ^ 0xff;
    const tampered = fromBytes(validBytes);
    await expect(appendDOT(chain, tampered)).rejects.toThrow();
  });
});

describe('verifyChain', () => {
  it('returns valid=true for a well-formed chain', async () => {
    const { chain } = await makeChain(5);
    const result = await verifyChain(chain);
    expect(result.valid).toBe(true);
    expect(result.length).toBe(5);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid=false for a chain with a broken link', async () => {
    const kp = await createKeypair();
    const genesis = await createDOT({ keypair: kp });
    const storage = new MemoryStorage();
    // Manually inject a DOT that doesn't chain from genesis
    storage.append(genesis);
    const unlinked = await createDOT({ keypair: kp });
    storage.append(unlinked);
    const chain = { storage };
    const result = await verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('getHead', () => {
  it('returns the most recent DOT', async () => {
    const { chain, dots } = await makeChain(3);
    const head = await getHead(chain);
    expect(head!.ts).toBe(dots[2]!.ts);
  });
});

describe('getRange', () => {
  it('returns a slice of the chain', async () => {
    const { chain } = await makeChain(5);
    const slice = await getRange(chain, 1, 3);
    expect(slice).toHaveLength(2);
  });
});
