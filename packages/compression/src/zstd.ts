/**
 * Zstd dictionary compression for DOT batch bodies.
 *
 * A zstd dictionary trained on sample DOT batch bodies dramatically reduces
 * compressed size because DOT data has highly regular structure: float64 payloads
 * with small deltas, 0x00 type bytes, varint-encoded timestamps in a predictable range.
 *
 * Dictionary approach:
 * - Train once on 100+ sample batch bodies from the target domain
 * - Ship dictionary alongside the application (or as a DOT on a registry chain)
 * - Compress each new batch body with the dictionary
 * - Receiver must have the same dictionary (identified by 32-byte hash)
 *
 * Implementation:
 * - Training: shells out to `zstd --train` CLI (v1.5+, must be on PATH)
 * - Compress/Decompress: uses `zstd-napi` native Node.js bindings with
 *   `Compressor.loadDictionary()` / `Decompressor.loadDictionary()`
 *
 * Why CLI for training?
 * `zstd-napi` exposes compress/decompress with dictionary support but does NOT
 * expose `ZDICT_trainFromBuffer`. The zstd CLI bundles the training algorithm and
 * is available on macOS via Homebrew (`brew install zstd`) and most Linux distros.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compressor, Decompressor } from 'zstd-napi';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default target dictionary size: 32 KB. */
const DEFAULT_DICT_SIZE = 32_768;

/** Minimum recommended samples for a meaningful dictionary. */
const MIN_SAMPLES_RECOMMENDED = 10;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Train a zstd dictionary from sample DOT batch bodies.
 *
 * Each sample should be a serialized batch v2 body (timestamps + types + payloads).
 * Returns the trained dictionary as a Uint8Array (target: 32 KB).
 *
 * Shells out to `zstd --train` — requires the zstd CLI on PATH (v1.5+).
 * Install via: `brew install zstd` (macOS) or `apt install zstd` (Debian/Ubuntu).
 *
 * @param samples  - Array of sample batch bodies. At least 10 recommended, 100+ for quality.
 * @param dictSize - Target dictionary size in bytes (default: 32768 = 32 KB).
 * @returns Trained dictionary as Uint8Array.
 * @throws If the zstd CLI is not found on PATH or training fails.
 */
export async function trainDictionary(
  samples: Uint8Array[],
  dictSize: number = DEFAULT_DICT_SIZE,
): Promise<Uint8Array> {
  if (samples.length === 0) {
    throw new RangeError('trainDictionary: samples array must not be empty');
  }
  if (samples.length < MIN_SAMPLES_RECOMMENDED) {
    // Warn but don't throw — some tests use fewer samples intentionally
    console.warn(
      `trainDictionary: ${samples.length} samples provided; ` +
        `${MIN_SAMPLES_RECOMMENDED}+ recommended for a quality dictionary`,
    );
  }

  // Create a temp directory, write each sample as a numbered file
  const tmpDir = mkdtempSync(join(tmpdir(), 'dot-zstd-train-'));
  const dictPath = join(tmpDir, 'dict.zstd');

  try {
    const sampleDir = join(tmpDir, 'samples');
    mkdirSync(sampleDir);

    for (let i = 0; i < samples.length; i++) {
      const samplePath = join(sampleDir, `sample_${String(i).padStart(6, '0')}.bin`);
      writeFileSync(samplePath, samples[i]!);
    }

    // zstd --train <sampleDir>/* -o <dictPath> --maxdict <size>
    // Using glob expansion via shell would be fragile; pass directory instead.
    // `zstd --train` with a directory glob is done by listing files explicitly.
    const samplePaths = samples.map((_, i) =>
      join(sampleDir, `sample_${String(i).padStart(6, '0')}.bin`),
    );

    try {
      execFileSync('zstd', ['--train', ...samplePaths, '-o', dictPath, '--maxdict', String(dictSize)], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        throw new Error(
          'zstd CLI not found. Install: brew install zstd (macOS) or apt install zstd (Linux). ' + msg,
        );
      }
      throw err;
    }

    const dictBytes = readFileSync(dictPath);
    return new Uint8Array(dictBytes.buffer, dictBytes.byteOffset, dictBytes.byteLength);
  } finally {
    // Clean up temp directory unconditionally
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Compress data using a trained zstd dictionary.
 *
 * The dictionary must have been produced by {@link trainDictionary}. Both the
 * compressor and decompressor must use the same dictionary — zstd embeds a
 * dictionary ID in the compressed frame so mismatches are detected at
 * decompression time.
 *
 * @param data       - Raw bytes to compress (e.g. a batch v2 body).
 * @param dictionary - Trained zstd dictionary from {@link trainDictionary}.
 * @returns Compressed bytes.
 */
export function compressWithDictionary(data: Uint8Array, dictionary: Uint8Array): Uint8Array {
  const cmp = new Compressor();
  cmp.loadDictionary(dictionary);
  const result = cmp.compress(data);
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

/**
 * Decompress data using the same dictionary that was used for compression.
 *
 * Throws if the dictionary does not match the one used during compression
 * (zstd detects mismatches via the embedded dictionary ID in the frame).
 *
 * @param compressed - Compressed bytes from {@link compressWithDictionary}.
 * @param dictionary - The same trained zstd dictionary used to compress.
 * @returns Original uncompressed bytes.
 * @throws If the dictionary ID in the frame does not match, or the data is corrupt.
 */
export function decompressWithDictionary(compressed: Uint8Array, dictionary: Uint8Array): Uint8Array {
  const dec = new Decompressor();
  dec.loadDictionary(dictionary);
  const result = dec.decompress(compressed);
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}
