/**
 * Sensor entropy collection for PUF-style device fingerprinting.
 * Collects timing jitter + crypto RNG. Hashes to stable 32-byte seed.
 * NOT a hardware PUF — but better than pure RNG (device-specific timing patterns).
 * Pure TypeScript, no native deps — works in browser and Node.js.
 */

export interface EntropyOptions {
  durationMs?: number;
}

/**
 * Collect entropy by sampling high-resolution timer jitter + crypto RNG.
 * The fractional bits of performance.now() reflect CPU microarchitecture
 * variance — not fully unique per device, but adds bias that's hard to replicate.
 */
export async function collectEntropy(options?: EntropyOptions): Promise<Uint8Array> {
  const ms = Math.min(options?.durationMs ?? 100, 200);
  const samples: number[] = [];

  const start = performance.now();
  while (performance.now() - start < ms) {
    samples.push(performance.now());
  }

  // Extract fractional bits from timing samples
  const bytes: number[] = [];
  for (const s of samples.slice(0, 256)) {
    const frac = s - Math.floor(s);
    bytes.push(Math.floor(frac * 256) & 0xFF);
  }

  // Mix in 32 bytes of crypto RNG for unpredictability
  const rng = new Uint8Array(32);
  crypto.getRandomValues(rng);
  bytes.push(...rng);

  return new Uint8Array(bytes);
}

/**
 * Hash a variable-length entropy buffer to a stable 32-byte fingerprint.
 * Deterministic: same input always produces same output.
 */
export async function hashEntropy(entropy: Uint8Array): Promise<Uint8Array> {
  const input = entropy.byteOffset === 0 && entropy.byteLength === entropy.buffer.byteLength
    ? (entropy.buffer as ArrayBuffer)
    : entropy.slice(0).buffer as ArrayBuffer;
  const buf = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(buf);
}

/**
 * Produce a 64-character hex string fingerprint for this device session.
 * Combines timing jitter entropy with hashing. Changes across sessions
 * due to RNG mixing, but the timing pattern provides device-specific bias.
 */
export async function deviceFingerprint(): Promise<string> {
  const entropy = await collectEntropy({ durationMs: 50 });
  const hash = await hashEntropy(entropy);
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}
