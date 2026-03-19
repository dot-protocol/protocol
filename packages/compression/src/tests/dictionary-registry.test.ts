import { describe, it, expect } from 'vitest';
import { DictionaryRegistry } from '../dictionary-registry.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Random Uint8Array of given length (crypto-quality). */
function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

/** Return true iff two Uint8Arrays are equal byte-by-byte. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DictionaryRegistry — register → get by ID → same bytes', () => {
  it('retrieves the exact dictionary bytes by the returned ID', async () => {
    const registry = new DictionaryRegistry();
    const dict = randomBytes(512);
    const id = await registry.register(dict, 'test-domain');

    const entry = registry.get(id);
    expect(entry).not.toBeNull();
    expect(bytesEqual(entry!.dictionary, dict)).toBe(true);
  });
});

describe('DictionaryRegistry — unknown ID → null', () => {
  it('returns null for an ID that was never registered', async () => {
    const registry = new DictionaryRegistry();
    const unknownId = randomBytes(32);
    expect(registry.get(unknownId)).toBeNull();
  });

  it('returns null after registering a different dictionary', async () => {
    const registry = new DictionaryRegistry();
    await registry.register(randomBytes(256), 'domain-a');
    const unknownId = randomBytes(32);
    expect(registry.get(unknownId)).toBeNull();
  });
});

describe('DictionaryRegistry — export → import → same entries', () => {
  it('round-trips a single entry through JSON', async () => {
    const registry = new DictionaryRegistry();
    const dict = randomBytes(256);
    const id = await registry.register(dict, 'voltage-sensor-v1');

    const json = registry.export();
    const restored = DictionaryRegistry.import(json);

    expect(restored.size).toBe(1);
    const entry = restored.get(id);
    expect(entry).not.toBeNull();
    expect(bytesEqual(entry!.dictionary, dict)).toBe(true);
    expect(entry!.domain).toBe('voltage-sensor-v1');
    expect(bytesEqual(entry!.id, id)).toBe(true);
    expect(typeof entry!.created).toBe('bigint');
  });

  it('round-trips multiple entries through JSON', async () => {
    const registry = new DictionaryRegistry();
    const dicts = [randomBytes(256), randomBytes(512), randomBytes(128)];
    const ids: Uint8Array[] = [];

    for (let i = 0; i < dicts.length; i++) {
      ids.push(await registry.register(dicts[i]!, `domain-${i}`));
    }

    const restored = DictionaryRegistry.import(registry.export());
    expect(restored.size).toBe(3);

    for (let i = 0; i < ids.length; i++) {
      const entry = restored.get(ids[i]!);
      expect(entry).not.toBeNull();
      expect(bytesEqual(entry!.dictionary, dicts[i]!)).toBe(true);
    }
  });
});

describe('DictionaryRegistry — two different dicts → different IDs', () => {
  it('produces distinct IDs for distinct same-length byte arrays', async () => {
    const registry = new DictionaryRegistry();
    const dict1 = randomBytes(256);
    const dict2 = randomBytes(256);

    const id1 = await registry.register(dict1, 'domain-1');
    const id2 = await registry.register(dict2, 'domain-2');

    expect(bytesEqual(id1, id2)).toBe(false);
    expect(registry.size).toBe(2);
  });
});

describe('DictionaryRegistry — idempotent register', () => {
  it('returns the same ID and keeps size === 1 when registered twice', async () => {
    const registry = new DictionaryRegistry();
    const dict = randomBytes(256);

    const id1 = await registry.register(dict, 'same-domain');
    const id2 = await registry.register(dict, 'same-domain');

    expect(bytesEqual(id1, id2)).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('idempotent even with different domain label on second call', async () => {
    // The ID is content-addressed, so same bytes → same ID regardless of domain.
    // The first registration wins on domain.
    const registry = new DictionaryRegistry();
    const dict = randomBytes(256);

    await registry.register(dict, 'original-domain');
    const id = await registry.register(dict, 'different-domain');

    expect(registry.size).toBe(1);
    const entry = registry.get(id);
    // First registration wins — domain should still be 'original-domain'
    expect(entry!.domain).toBe('original-domain');
  });
});

describe('DictionaryRegistry — domain stored correctly', () => {
  it('stores the exact domain string provided at registration', async () => {
    const registry = new DictionaryRegistry();
    const id = await registry.register(randomBytes(64), 'voltage-sensor-v1');
    const entry = registry.get(id);
    expect(entry!.domain).toBe('voltage-sensor-v1');
  });
});

describe('DictionaryRegistry — created timestamp', () => {
  it('created is a bigint approximately equal to Date.now()', async () => {
    const before = BigInt(Date.now());
    const registry = new DictionaryRegistry();
    const id = await registry.register(randomBytes(64), 'ts-test');
    const after = BigInt(Date.now());

    const entry = registry.get(id);
    expect(typeof entry!.created).toBe('bigint');
    expect(entry!.created).toBeGreaterThanOrEqual(before);
    expect(entry!.created).toBeLessThanOrEqual(after);
  });

  it('created survives export/import as a bigint', async () => {
    const registry = new DictionaryRegistry();
    const id = await registry.register(randomBytes(64), 'ts-persist');
    const original = registry.get(id)!.created;

    const restored = DictionaryRegistry.import(registry.export());
    const entry = restored.get(id);
    expect(entry!.created).toBe(original);
    expect(typeof entry!.created).toBe('bigint');
  });
});

describe('DictionaryRegistry — size', () => {
  it('starts at 0', () => {
    expect(new DictionaryRegistry().size).toBe(0);
  });

  it('increments with each unique dictionary', async () => {
    const registry = new DictionaryRegistry();
    expect(registry.size).toBe(0);
    await registry.register(randomBytes(64), 'a');
    expect(registry.size).toBe(1);
    await registry.register(randomBytes(64), 'b');
    expect(registry.size).toBe(2);
  });
});
