/**
 * rANS (Asymmetric Numeral Systems) entropy coder for byte-level data.
 *
 * Implements table-based streaming rANS with a 32-bit state and 16-bit output
 * chunks. Symbols are bytes (0-255). Frequencies are normalised to sum = 4096
 * (SCALE = 2^12). Laplace smoothing ensures no zero-frequency symbols.
 *
 * State invariant: x in [RANS_L, RANS_L * 2^16). With RANS_L = 2^15 this is
 * [32768, 2147483648) which fits comfortably in a 32-bit unsigned integer.
 *
 * For DOT XOR residuals the zero byte dominates → near-zero bits per symbol.
 */

/** Precision of the frequency table: 2^SCALE_BITS total slots. */
const SCALE_BITS = 12;
const SCALE = 1 << SCALE_BITS; // 4096

/**
 * Lower bound of the normalisation interval.
 * State x is always in [RANS_L, RANS_L * 65536).
 * RANS_L = 2^15 so max state = 2^15 * 2^16 - 1 = 2^31 - 1 < 2^32.  ✓
 */
const RANS_L = 1 << 15; // 32768

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Normalised frequency table over 256 symbols.
 * sum(freq) === 4096, freq[b] >= 1 for all b.
 */
export interface FrequencyTable {
  /** Normalised frequency for each byte value (0-255). */
  freq: Uint16Array; // length 256, sum = 4096
  /** Cumulative frequencies. cumFreq[b] = sum(freq[0..b-1]). */
  cumFreq: Uint16Array; // length 257, cumFreq[0]=0, cumFreq[256]=4096
}

// ---------------------------------------------------------------------------
// buildFrequencyTable
// ---------------------------------------------------------------------------

/**
 * Build a FrequencyTable from byte data using Largest Remainder Method (LRM)
 * to guarantee exact normalisation to SCALE = 4096.
 *
 * Steps:
 *  1. Count raw occurrences of each byte.
 *  2. Add 1 to every count (Laplace smoothing) — eliminates zero frequencies.
 *  3. Assign floor(count/total * SCALE) to each symbol; ensure minimum of 1.
 *  4. Distribute remaining slots to symbols with largest fractional remainders.
 *  5. Build cumulative prefix sums.
 *
 * @param data - Representative byte data (e.g., XOR residuals).
 */
export function buildFrequencyTable(data: Uint8Array): FrequencyTable {
  // Step 1: raw counts
  const rawCounts = new Float64Array(256);
  for (let i = 0; i < data.length; i++) {
    rawCounts[data[i]!]++;
  }

  // Step 2: Laplace smoothing — every symbol gets at least 1 count
  const counts = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    counts[i] = rawCounts[i]! + 1;
  }

  const total = counts.reduce((a, b) => a + b, 0);

  // Step 3: floor allocation, minimum 1 per symbol
  const freq = new Uint16Array(256);
  const remainders = new Float64Array(256);
  let allocated = 0;

  for (let i = 0; i < 256; i++) {
    const exact = (counts[i]! / total) * SCALE;
    const floored = Math.floor(exact);
    const f = Math.max(1, floored);
    freq[i] = f;
    allocated += f;
    // Store remainder for LRM — use exact - floored (pre-clamp remainder)
    remainders[i] = floored >= 1 ? exact - floored : 0;
  }

  // Step 4: Largest Remainder Method — correct the total to exactly SCALE
  const delta = SCALE - allocated; // positive = under, negative = over
  if (delta > 0) {
    // Under-allocated: give extra slots to highest remainders
    const indices = Array.from({ length: 256 }, (_, i) => i);
    indices.sort((a, b) => remainders[b]! - remainders[a]!);
    for (let k = 0; k < delta; k++) {
      freq[indices[k % 256]!]! + 1; // suppress lint
      freq[indices[k % 256]!] += 1;
    }
  } else if (delta < 0) {
    // Over-allocated: remove slots from largest frequencies (keep min=1)
    const indices = Array.from({ length: 256 }, (_, i) => i);
    indices.sort((a, b) => freq[b]! - freq[a]!);
    let toRemove = -delta;
    let k = 0;
    while (toRemove > 0) {
      const idx = indices[k % 256]!;
      if (freq[idx]! > 1) {
        freq[idx] -= 1;
        toRemove--;
      }
      k++;
    }
  }

  // Step 5: cumulative prefix sums
  const cumFreq = new Uint16Array(257);
  for (let i = 0; i < 256; i++) {
    cumFreq[i + 1] = cumFreq[i]! + freq[i]!;
  }

  return { freq, cumFreq };
}

// ---------------------------------------------------------------------------
// ransEncode
// ---------------------------------------------------------------------------

/**
 * rANS encode a byte sequence.
 *
 * Processes symbols in REVERSE order (standard rANS convention). Emits 16-bit
 * output chunks (lo byte, hi byte) when normalizing. After all symbols, flushes
 * the 32-bit state (4 bytes LE). Reverses the whole output so the decoder sees:
 * [state_BE_4bytes] [oldest_chunk...] [newest_chunk].
 *
 * @param symbols - Input bytes to encode.
 * @param table   - FrequencyTable built from representative data.
 */
export function ransEncode(symbols: Uint8Array, table: FrequencyTable): Uint8Array {
  if (symbols.length === 0) {
    return new Uint8Array(0);
  }

  const output: number[] = [];
  let x = RANS_L;

  // L_over_M = floor(RANS_L / SCALE) = floor(2^15 / 2^12) = 8
  const L_over_M = Math.floor(RANS_L / SCALE); // 8

  // Process symbols in REVERSE order
  for (let i = symbols.length - 1; i >= 0; i--) {
    const s = symbols[i]!;
    const fs = table.freq[s]!;
    const cs = table.cumFreq[s]!;

    // Normalise: emit 16-bit chunk(s) until x is in the valid pre-encode range.
    // Valid range before encoding s: x in [RANS_L/SCALE*fs, RANS_L/SCALE*fs*65536)
    const upperBound = L_over_M * fs * 65536;
    while (x >= upperBound) {
      output.push(x & 0xff);
      output.push((x >>> 8) & 0xff);
      x = Math.floor(x / 65536);
    }

    // Encode symbol: maps x in [L/M*fs, L/M*fs*B) to [L, L*B) bijectively
    x = Math.floor(x / fs) * SCALE + (x % fs) + cs;
  }

  // Flush final state (4 bytes, little-endian)
  // State fits in 32 bits since RANS_L = 2^15 and x < RANS_L * 65536 = 2^31
  output.push(x & 0xff);
  output.push((x >>> 8) & 0xff);
  output.push((x >>> 16) & 0xff);
  output.push((x >>> 24) & 0xff);

  // Reverse so the decoder reads state first, then chunks in oldest-to-newest order.
  // After reversing, state bytes are [b3,b2,b1,b0] (big-endian) at positions 0..3.
  output.reverse();
  return new Uint8Array(output);
}

// ---------------------------------------------------------------------------
// ransDecode
// ---------------------------------------------------------------------------

/**
 * rANS decode a byte sequence encoded by ransEncode.
 *
 * @param encoded - Output of ransEncode.
 * @param table   - Same FrequencyTable used for encoding.
 * @param length  - Number of original symbols (required for correct termination).
 */
export function ransDecode(
  encoded: Uint8Array,
  table: FrequencyTable,
  length: number,
): Uint8Array {
  if (length === 0) {
    return new Uint8Array(0);
  }

  // Build a fast slot→symbol lookup table (length SCALE = 4096)
  const cumToSym = new Uint8Array(SCALE);
  for (let sym = 0; sym < 256; sym++) {
    const start = table.cumFreq[sym]!;
    const end = table.cumFreq[sym + 1]!;
    for (let j = start; j < end; j++) {
      cumToSym[j] = sym;
    }
  }

  // Read initial 32-bit state.
  // The encoder pushes LE bytes [b0,b1,b2,b3] last, then reverses the whole output,
  // so in the stream they appear as [b3,b2,b1,b0] = big-endian.
  // Use DataView for a clean big-endian read without JS bitwise sign issues.
  const initBuf = new ArrayBuffer(4);
  const initView = new DataView(initBuf);
  initView.setUint8(0, encoded[0]!);
  initView.setUint8(1, encoded[1]!);
  initView.setUint8(2, encoded[2]!);
  initView.setUint8(3, encoded[3]!);
  let x = initView.getUint32(0, false); // big-endian = MSB first

  let streamPos = 4;
  const output = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    // Identify symbol: slot = x mod SCALE
    const slot = x & (SCALE - 1);
    const s = cumToSym[slot]!;
    output[i] = s;

    const fs = table.freq[s]!;
    const cs = table.cumFreq[s]!;

    // Advance state: x = fs * floor(x / SCALE) + slot - cs
    x = fs * Math.floor(x / SCALE) + slot - cs;

    // Renormalise: pull 16-bit chunks from the stream until x >= RANS_L.
    // Each chunk was pushed as [lo, hi] then reversed, so in stream order it's [hi, lo]
    // = big-endian. Read accordingly.
    while (x < RANS_L && streamPos + 2 <= encoded.length) {
      const hi = encoded[streamPos]!;
      const lo = encoded[streamPos + 1]!;
      const chunk = (hi << 8) | lo;
      // x * 65536 max: (RANS_L - 1) * 65536 = 2147418112 < 2^31, safe for Number
      x = x * 65536 + chunk;
      streamPos += 2;
    }
  }

  return output;
}
