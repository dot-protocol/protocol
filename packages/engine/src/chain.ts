/**
 * DOT Engine — Append-only Chain
 *
 * A chain is a worldline: an ordered sequence of 153-byte DOTs where each
 * DOT's chain field = SHA-256(toBytes(previousDot)).
 *
 * The engine maintains one chain per identity pair. Each device has its own
 * sovereign chain keyed by its DID.
 */

export interface DotEntry {
  dot: Uint8Array;   // 153-byte raw DOT
  index: number;     // position in chain (0-based)
  timestamp: number; // Unix ms from DOT timestamp field
}

export interface Chain {
  /** Chain ID — DID of chain creator, or "shared:" + genesis hash for group chains */
  id: string;
  entries: DotEntry[];
  /** Most recent DOT bytes (for chain linking into the next DOT) */
  lastDot?: Uint8Array;
  length: number;
}

/**
 * Create a new empty chain anchored to an identity DID.
 * The first DOT appended will use 32 zero bytes as its chain hash (genesis).
 */
export function createChain(id: string): Chain {
  return { id, entries: [], length: 0 };
}

/**
 * Append a 153-byte DOT to the chain. Returns the updated chain (immutable-style).
 * The engine passes this DOT as `previous` to the next createDOT call.
 */
export function appendToChain(chain: Chain, dot: Uint8Array): Chain {
  if (dot.length !== 153) {
    throw new RangeError(`appendToChain: expected 153-byte DOT, got ${dot.length}`);
  }

  // Extract timestamp from bytes [128..135] (big-endian int64)
  const view = new DataView(dot.buffer, dot.byteOffset + 128, 8);
  const tsBigInt = view.getBigInt64(0, false);
  const timestamp = Number(tsBigInt);

  const entry: DotEntry = {
    dot: new Uint8Array(dot), // defensive copy
    index: chain.length,
    timestamp,
  };

  const entries = [...chain.entries, entry];
  return {
    id: chain.id,
    entries,
    lastDot: entry.dot,
    length: entries.length,
  };
}
