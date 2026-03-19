import { describe, it, expect } from 'vitest';
import { collectEntropy, hashEntropy, deviceFingerprint } from '../sensor.js';

describe('sensor PUF', () => {
  it('collectEntropy returns non-empty bytes', async () => {
    const entropy = await collectEntropy({ durationMs: 50 });
    expect(entropy.length).toBeGreaterThan(0);
  });

  it('hashEntropy returns 32 bytes', async () => {
    const entropy = new Uint8Array([1, 2, 3, 4, 5]);
    const hash = await hashEntropy(entropy);
    expect(hash).toHaveLength(32);
  });

  it('same entropy → same hash', async () => {
    const entropy = new Uint8Array(64).fill(7);
    const h1 = await hashEntropy(entropy);
    const h2 = await hashEntropy(entropy);
    expect(Array.from(h1)).toEqual(Array.from(h2));
  });

  it('deviceFingerprint returns 64-char hex string', async () => {
    const fp = await deviceFingerprint();
    expect(fp).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
  });
});
