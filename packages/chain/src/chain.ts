import { verifyDOT, checkChain, toBytes } from '@dot-protocol/core';
import type { DOT } from '@dot-protocol/core';
import type { IChainStorage } from './storage.js';
import { MemoryStorage } from './storage.js';

export interface Chain {
  storage: IChainStorage;
}

export interface ChainVerifyResult {
  valid: boolean;
  length: number;
  head: DOT | undefined;
  errors: string[];
}

/** Create a new chain with the given genesis DOT. */
export async function createChain(genesisDOT: DOT, storage?: IChainStorage): Promise<Chain> {
  const s = storage ?? new MemoryStorage();
  await s.append(genesisDOT);
  return { storage: s };
}

/**
 * Append a DOT to the chain.
 * The DOT must chain from the current head (chain field = SHA-256(toBytes(head))).
 * Throws if the chain link is broken.
 */
export async function appendDOT(chain: Chain, dot: DOT): Promise<void> {
  const head = await chain.storage.getHead();
  if (!head) throw new Error('Chain is empty — cannot append');

  // Verify the chain link
  const headBytes = toBytes(head);
  const expectedChain = new Uint8Array(
    await crypto.subtle.digest('SHA-256', headBytes.buffer as ArrayBuffer)
  );
  const actualChain = dot.chain;
  const chainOk = expectedChain.every((b, i) => b === actualChain[i]);
  if (!chainOk) {
    throw new Error('Chain link broken: dot.chain does not hash from current head');
  }

  // Verify signature
  if (!await verifyDOT(dot)) {
    throw new Error('Invalid DOT signature');
  }

  await chain.storage.append(dot);
}

/** Get the most recent DOT in the chain. */
export async function getHead(chain: Chain): Promise<DOT | undefined> {
  return chain.storage.getHead();
}

/** Get all DOTs in the chain, oldest first. */
export async function getRange(chain: Chain, from: number, to: number): Promise<DOT[]> {
  const all = await chain.storage.getAll();
  return all.slice(from, to);
}

/** Verify the entire chain: signatures + chain links. */
export async function verifyChain(chain: Chain): Promise<ChainVerifyResult> {
  const dots = await chain.storage.getAll();
  const length = dots.length;
  const head = dots[length - 1];
  const errors: string[] = [];

  const result = await checkChain(dots);
  if (!result.valid) {
    errors.push(result.reason);
  }

  return { valid: result.valid, length, head, errors };
}
