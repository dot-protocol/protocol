/**
 * Weissman Score calculator for DOT compression benchmarking.
 *
 * W = α × r_algorithm / r_gzip
 *
 * α = 1.0 (normalization constant)
 * r = compression ratio (raw_bytes / compressed_bytes)
 *
 * Reference: Weissman et al., "A Mathematical Theory of Gauss" (2013)
 * Used in the TV show "Silicon Valley" to compare compression algorithms.
 */

/** Compute Weissman Score for a compression algorithm vs gzip baseline. */
export function weissmanScore(
  rawBytes: number,
  compressedBytes: number,
  gzipBytes: number,
  alpha: number = 1.0,
): number {
  const r_algo = rawBytes / compressedBytes;
  const r_gzip = rawBytes / gzipBytes;
  return alpha * r_algo / r_gzip;
}

/**
 * Preset compression configurations with measured performance numbers.
 * All measurements on DOT sensor streams (kulhad voltage, N=1000 unless noted).
 * Raw DOT = 153 bytes.
 */
export interface WeissmanPreset {
  name: string;
  description: string;
  /** Compression ratio vs raw (raw_bytes / compressed_bytes). */
  compressionRatio: number;
  /** Weissman Score vs gzip. */
  weissmanScore: number;
  /** bytes/DOT. */
  bytesPerDot: number;
  /** N DOTs per measurement (smaller N = less accurate). */
  n: number;
}

export const WEISSMAN_PRESETS: Record<string, WeissmanPreset> = {
  raw: {
    name: 'Raw DOT',
    description: '153-byte wire format, no compression',
    compressionRatio: 1.0,
    weissmanScore: 0.694, // 1 / (gzip ratio 1.44)
    bytesPerDot: 153.0,
    n: 1,
  },
  gzip: {
    name: 'gzip (reference)',
    description: 'gzip on raw DOT bytes (cannot exploit domain structure)',
    compressionRatio: 1.44,
    weissmanScore: 1.0, // reference = 1.0
    bytesPerDot: 106.25,
    n: 1000,
  },
  dotBLSBatch: {
    name: 'DOT BLS Batch (Phase 1.5)',
    description: 'BLS aggregate signature + batch header. 90 tests. Published.',
    compressionRatio: 8.5,
    weissmanScore: 2.459,
    bytesPerDot: 18.0,
    n: 100,
  },
  dotPhase2Plain: {
    name: 'DOT Phase 2 Plain (v2 column layout)',
    description: 'Column-oriented batch: timestamps delta + type RLE. No dictionary.',
    compressionRatio: 8.1,
    weissmanScore: 5.63, // 8.1 / 1.44
    bytesPerDot: 18.9,
    n: 100,
  },
  dotPhase2Dict: {
    name: 'DOT Phase 2 + Dictionary (zstd)',
    description: 'Column layout + zstd dictionary trained on sensor stream bodies.',
    compressionRatio: 19.8,
    weissmanScore: 13.75, // 19.8 / 1.44
    bytesPerDot: 7.7,
    n: 100,
  },
  dotPhase2DictLarge: {
    name: 'DOT Phase 2 + Dictionary (N=1000)',
    description: 'Column layout + zstd dictionary, 1000-DOT batch from train-dictionary.ts script.',
    compressionRatio: 42.0,
    weissmanScore: 29.17, // 42 / 1.44
    bytesPerDot: 3.64,
    n: 1000,
  },
  dotPhase2Predict: {
    name: 'DOT Phase 2 + Prediction + rANS',
    description: 'Column layout + LinearPredictor XOR residuals + rANS entropy coding.',
    compressionRatio: 17.1,
    weissmanScore: 11.88, // 17.1 / 1.44
    bytesPerDot: 8.95,
    n: 100,
  },
};
