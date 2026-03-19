/**
 * Dictionary Registry — maps 32-byte dict IDs to trained zstd dictionaries.
 *
 * Each dictionary is identified by SHA-256(dictionary_bytes) — 32 bytes.
 * This makes IDs deterministic and content-addressable.
 *
 * In Sprint 2, this is in-memory with JSON serialization.
 * In the future, dictionaries become DOTs on a registry chain.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DictionaryEntry {
  id: Uint8Array;          // 32-byte SHA-256 hash of dictionary content
  dictionary: Uint8Array;  // the dictionary bytes (~32KB max)
  domain: string;          // human label: e.g. "voltage-sensor-v1"
  created: bigint;         // Unix ms timestamp as bigint
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new RangeError(`hexToBytes: odd-length hex string (${hex.length} chars)`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data.slice(0).buffer);
  return new Uint8Array(hashBuffer);
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** Serialised form used in JSON export. */
interface SerializedEntry {
  id: string;          // hex
  dictionary: string;  // hex
  domain: string;
  created: string;     // bigint as decimal string
}

export class DictionaryRegistry {
  /** Internal store: hex(id) → DictionaryEntry */
  private readonly _entries: Map<string, DictionaryEntry> = new Map();

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a trained dictionary. Returns its 32-byte ID (SHA-256 of content).
   * Idempotent — registering the same dictionary twice returns the same ID.
   */
  async register(dictionary: Uint8Array, domain: string): Promise<Uint8Array> {
    const id = await sha256(dictionary);
    const key = bytesToHex(id);

    if (!this._entries.has(key)) {
      const entry: DictionaryEntry = {
        id,
        dictionary: new Uint8Array(dictionary), // defensive copy
        domain,
        created: BigInt(Date.now()),
      };
      this._entries.set(key, entry);
    }

    // Return the id from the stored entry (idempotent path returns same object)
    return this._entries.get(key)!.id;
  }

  /**
   * Look up a dictionary by ID. Returns null if unknown.
   * ID comparison is byte-by-byte (not reference equality).
   */
  get(id: Uint8Array): DictionaryEntry | null {
    const key = bytesToHex(id);
    return this._entries.get(key) ?? null;
  }

  /**
   * Export registry to JSON string for persistence.
   * Uint8Array fields serialized as hex strings.
   */
  export(): string {
    const serialized: SerializedEntry[] = [];
    for (const entry of this._entries.values()) {
      serialized.push({
        id: bytesToHex(entry.id),
        dictionary: bytesToHex(entry.dictionary),
        domain: entry.domain,
        created: entry.created.toString(),
      });
    }
    return JSON.stringify(serialized);
  }

  /**
   * Import registry from JSON string (produced by export()).
   * Returns a new DictionaryRegistry instance.
   */
  static import(json: string): DictionaryRegistry {
    const registry = new DictionaryRegistry();
    const serialized: SerializedEntry[] = JSON.parse(json);

    for (const raw of serialized) {
      const id = hexToBytes(raw.id);
      const dictionary = hexToBytes(raw.dictionary);
      const entry: DictionaryEntry = {
        id,
        dictionary,
        domain: raw.domain,
        created: BigInt(raw.created),
      };
      registry._entries.set(raw.id, entry);
    }

    return registry;
  }

  /**
   * Number of dictionaries in the registry.
   */
  get size(): number {
    return this._entries.size;
  }
}
