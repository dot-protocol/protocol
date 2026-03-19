/**
 * Batch v2 serializer — column-oriented DOT batch with BLS aggregate signature.
 *
 * Wire format:
 *   HEADER (86 bytes without dictionary, 118 bytes with dictionary):
 *     [0]      version = 0x03
 *     [1]      flags:
 *                bit0 = timestamp_delta_encoded
 *                bit1 = payload_type_rle
 *                bit2 = reserved
 *                bit3 = dictionary_compressed  ← NEW
 *     [2..5]   dot_count: uint32 LE
 *     [6..37]  shared_pubkey: 32B Ed25519 public key
 *     [38..85] aggregated_bls_sig: 48B BLS G1 aggregate signature
 *     [86..117] dictionary_id: 32B SHA-256 of dictionary (only present when bit3 set)
 *   BODY (column-oriented):
 *     [if bit3] zstd-compressed body (timestamps + types + payloads as normal columns)
 *     [else]    raw columns as before:
 *       [if bit0] varint-delta timestamps (encodeTimestampDeltas)
 *       [else]    raw timestamps: dot_count × 8B big-endian uint64
 *       [if bit1] RLE-encoded types (encodePayloadTypes)
 *       [else]    raw types: dot_count × 1B
 *       [always]  raw payloads: dot_count × 16B
 *
 * Chain hashes are NOT stored — reconstructed on decode via sequential SHA-256.
 *
 * Sprint 1 limitation: assumes genesis-anchored batch (chain[0] = 32 zeros).
 * For non-genesis chains, the first chain hash must be tracked externally.
 * A future sprint will add an optional prevChainHash field to the header.
 */

import { createHash } from 'node:crypto';
import {
  signBLS,
  aggregateSignatures,
  verifyAggregateSameSigner,
  type BLSKeypair,
} from '@dot-protocol/core';
import { encodeTimestampDeltas, decodeTimestampDeltas } from './timestamp-delta.js';
import { encodePayloadTypes, decodePayloadTypes } from './rle.js';
import { compressWithDictionary, decompressWithDictionary } from './zstd.js';
import { type DictionaryRegistry } from './dictionary-registry.js';
import {
  type PayloadPredictor,
  NullPredictor,
  LastValuePredictor,
  LinearPredictor,
  computeResidual,
  applyResidual,
} from './predictor.js';
import { buildFrequencyTable, ransEncode, ransDecode, type FrequencyTable } from './rans.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_V2_VERSION = 0x03;
const HEADER_SIZE = 86; // 1(ver) + 1(flags) + 4(count) + 32(pubkey) + 48(aggSig)
const DICT_ID_SIZE = 32;
const HEADER_SIZE_WITH_DICT = HEADER_SIZE + DICT_ID_SIZE; // 118B when dict flag set
const FLAG_TS_DELTA = 0b00000001;
const FLAG_TYPE_RLE = 0b00000010;
// bit 2 = reserved
export const FLAG_DICT_COMPRESSED = 0x08; // bit 3: body is zstd-compressed with a dictionary
export const FLAG_PREDICTION = 0x10;      // bit 4: payload column uses predictor + rANS coding

// Prediction metadata sizes
const FREQ_TABLE_BYTES = 256 * 2; // 256 symbols × 2 bytes (uint16 LE) = 512 bytes
const PREDICTION_META_SIZE = 1 + FREQ_TABLE_BYTES; // modelId(1) + freqTable(512) = 513 bytes

const DOT_SIZE = 153;
const PUBKEY_SIZE = 32;
const SIG_SIZE = 64;
const CHAIN_SIZE = 32;
const PAYLOAD_SIZE = 16;
const BLS_AGG_SIG_SIZE = 48;

// Byte offsets in DOT wire format
const OFF_PUBKEY = 0;
const OFF_SIG = 32;
const OFF_CHAIN = 96;
const OFF_TS = 128;
const OFF_TYPE = 136;
const OFF_PAYLOAD = 137;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SerializeBatchV2Options {
  /** Encode timestamps as varint deltas (default: true). Saves ~75% on periodic streams. */
  timestampDelta?: boolean;
  /** RLE-encode payload type column (default: true). Saves ~90%+ on homogeneous batches. */
  payloadTypeRLE?: boolean;
  /**
   * Trained zstd dictionary bytes. When provided together with `dictionaryId`,
   * the encoded body columns are zstd-compressed using this dictionary and
   * FLAG_DICT_COMPRESSED (bit 3) is set in the header flags.
   */
  dictionary?: Uint8Array;
  /**
   * 32-byte SHA-256 ID of the dictionary (SHA-256 of the dictionary bytes).
   * Stored in the extended header [86..117] so the deserializer can look it up
   * in a DictionaryRegistry. Must be provided together with `dictionary`.
   */
  dictionaryId?: Uint8Array;
  /**
   * Payload predictor to use for prediction + rANS coding of the payload column.
   * When set, FLAG_PREDICTION (bit 4) is set in the frame header flags.
   *
   * Use a specific PayloadPredictor instance (e.g. new LinearPredictor()) for
   * explicit control, or 'auto' to automatically select between LinearPredictor
   * and NullPredictor based on a compressibility heuristic.
   *
   * Mutually exclusive with `dictionary` / `dictionaryId` — both cannot be set
   * simultaneously. Throws TypeError if both are provided.
   */
  predictor?: PayloadPredictor | 'auto';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute SHA-256 of the given bytes. */
function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/**
 * Extract the 89-byte signed portion from a 153-byte DOT buffer.
 * Returns pubkey(32) + chain+ts+type+payload(57) = 89 bytes.
 * Mirrors core's signedBytes(buf) function.
 */
function extractSignedBytes(dot: Uint8Array): Uint8Array {
  const out = new Uint8Array(89);
  out.set(dot.subarray(OFF_PUBKEY, OFF_PUBKEY + PUBKEY_SIZE), 0);
  out.set(dot.subarray(OFF_CHAIN, DOT_SIZE), 32);
  return out;
}

/**
 * Build the sig field (64B) from an aggregate BLS signature (48B).
 * BLS chain hash rule: first 48 bytes = aggSig, remaining 16 bytes = 0.
 */
function buildSigField(aggSig: Uint8Array): Uint8Array {
  const sigField = new Uint8Array(SIG_SIZE); // 64 bytes, zero-initialized
  sigField.set(aggSig);                       // copy 48-byte aggSig into [0..47]
  return sigField;
}

/**
 * Read a big-endian uint64 as bigint from buf at the given offset.
 */
function readTimestamp(buf: Uint8Array, offset: number): bigint {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
}

/**
 * Write a big-endian uint64 bigint into buf at the given offset.
 */
function writeTimestamp(buf: Uint8Array, offset: number, ts: bigint): void {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  view.setBigUint64(0, ts, false);
}

// ─── Prediction helpers ───────────────────────────────────────────────────────

/**
 * Serialize a FrequencyTable's freq array as 256 × uint16 LE = 512 bytes.
 * The cumFreq array is deterministic and is NOT stored (reconstructed on decode).
 */
function serializeFreqTable(table: FrequencyTable): Uint8Array {
  const buf = new Uint8Array(FREQ_TABLE_BYTES);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < 256; i++) {
    view.setUint16(i * 2, table.freq[i]!, true); // little-endian
  }
  return buf;
}

/**
 * Deserialize a FrequencyTable from 512 bytes at `offset` in `buf`.
 * Reconstructs cumFreq from freq (deterministic).
 */
function deserializeFreqTable(buf: Uint8Array, offset: number): FrequencyTable {
  const freq = new Uint16Array(256);
  const cumFreq = new Uint16Array(257);
  const view = new DataView(buf.buffer, buf.byteOffset);
  for (let i = 0; i < 256; i++) {
    freq[i] = view.getUint16(offset + i * 2, true);
  }
  cumFreq[0] = 0;
  for (let i = 0; i < 256; i++) {
    cumFreq[i + 1] = cumFreq[i]! + freq[i]!;
  }
  return { freq, cumFreq };
}

/**
 * Compute XOR residuals for all payloads using the given predictor.
 * Returns a flat Uint8Array of N × PAYLOAD_SIZE residual bytes.
 * Predictor MUST be reset before calling.
 */
function computeAllResiduals(payloads: Uint8Array[], predictor: PayloadPredictor): Uint8Array {
  const n = payloads.length;
  const residuals = new Uint8Array(n * PAYLOAD_SIZE);
  for (let i = 0; i < n; i++) {
    const predicted = predictor.predict();
    const residual = computeResidual(payloads[i]!, predicted);
    residuals.set(residual, i * PAYLOAD_SIZE);
    predictor.update(payloads[i]!);
  }
  return residuals;
}

/**
 * Heuristic to select best predictor for 'auto' mode.
 * Uses sum of residual bytes as a proxy for compressibility.
 * Lower sum = more zeros = better compression.
 */
function selectPredictor(payloads: Uint8Array[]): PayloadPredictor {
  const linear = new LinearPredictor();
  const nullP = new NullPredictor();

  const linearResiduals = computeAllResiduals(payloads, linear);
  const nullResiduals = computeAllResiduals(payloads, nullP);

  let linearScore = 0;
  let nullScore = 0;
  for (let i = 0; i < linearResiduals.length; i++) {
    linearScore += linearResiduals[i]!;
  }
  for (let i = 0; i < nullResiduals.length; i++) {
    nullScore += nullResiduals[i]!;
  }

  return linearScore < nullScore ? new LinearPredictor() : new NullPredictor();
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * Serialize N DOTs (same pubkey, chain order) into a batch v2 frame.
 * Column-oriented layout: timestamps | types | payloads.
 * BLS aggregate signature over all DOT signed portions.
 *
 * @param dots     - Array of 153-byte Uint8Array DOTs, chain order, same pubkey
 * @param blsKeypair - BLS keypair for aggregate signing (same identity as Ed25519 DOTs)
 * @param options  - Compression flags (both default true)
 */
export async function serializeBatchV2(
  dots: Uint8Array[],
  blsKeypair: BLSKeypair,
  options?: SerializeBatchV2Options,
): Promise<Uint8Array> {
  // ── Validate input ──────────────────────────────────────────────────────────
  if (dots.length === 0) {
    throw new RangeError('serializeBatchV2: dots array must not be empty');
  }
  for (let i = 0; i < dots.length; i++) {
    if (dots[i]!.length !== DOT_SIZE) {
      throw new RangeError(
        `serializeBatchV2: dot[${i}] has ${dots[i]!.length} bytes, expected ${DOT_SIZE}`,
      );
    }
  }
  const sharedPubkey = dots[0]!.subarray(OFF_PUBKEY, OFF_PUBKEY + PUBKEY_SIZE);
  for (let i = 1; i < dots.length; i++) {
    const pk = dots[i]!.subarray(OFF_PUBKEY, OFF_PUBKEY + PUBKEY_SIZE);
    for (let b = 0; b < PUBKEY_SIZE; b++) {
      if (pk[b] !== sharedPubkey[b]) {
        throw new Error(`serializeBatchV2: dot[${i}] has different pubkey than dot[0]`);
      }
    }
  }

  // ── Options ─────────────────────────────────────────────────────────────────
  const useTsDelta = options?.timestampDelta !== false; // default true
  const useTypeRLE = options?.payloadTypeRLE !== false; // default true

  // Guard: both dictionary and dictionaryId must be provided together
  if (options?.dictionary && !options?.dictionaryId) {
    throw new TypeError('serializeBatchV2: dictionary requires dictionaryId');
  }
  if (options?.dictionaryId && !options?.dictionary) {
    throw new TypeError('serializeBatchV2: dictionaryId requires dictionary');
  }

  // Guard: predictor and dictionary are mutually exclusive
  if (options?.predictor && (options?.dictionary || options?.dictionaryId)) {
    throw new TypeError(
      'serializeBatchV2: predictor and dictionary are mutually exclusive — cannot set both',
    );
  }

  const useDict = !!(options?.dictionary && options?.dictionaryId);

  if (useDict) {
    if (options!.dictionaryId!.length !== DICT_ID_SIZE) {
      throw new RangeError(
        `serializeBatchV2: dictionaryId must be ${DICT_ID_SIZE} bytes, got ${options!.dictionaryId!.length}`,
      );
    }
  }

  // ── Extract columns ─────────────────────────────────────────────────────────
  const timestamps: bigint[] = new Array(dots.length);
  const types = new Uint8Array(dots.length);
  const payloads: Uint8Array[] = new Array(dots.length);

  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i]!;
    timestamps[i] = readTimestamp(dot, OFF_TS);
    types[i] = dot[OFF_TYPE]!;
    payloads[i] = dot.subarray(OFF_PAYLOAD, OFF_PAYLOAD + PAYLOAD_SIZE);
  }

  // ── Build BLS-form DOTs (zeroed sig field) for deterministic chain hashing ──
  // CRITICAL: We sign signedBytes of the BLS-form DOT (with zeroed sig, not
  // the original Ed25519 sig). This makes signing and verification fully
  // deterministic: the deserializer reconstructs the same zeroed-sig DOTs
  // from the frame's compressed data, computes their signedBytes, and verifies.
  const zeroedSig = new Uint8Array(SIG_SIZE); // 64 zero bytes
  const blsFormDots: Uint8Array[] = new Array(dots.length);
  let prevBlsDot: Uint8Array | null = null;

  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i]!;

    let chainHash: Uint8Array;
    if (i === 0) {
      // Sprint 1: genesis-anchored batch — chain[0] = 32 zero bytes
      chainHash = new Uint8Array(CHAIN_SIZE);
    } else {
      chainHash = sha256(prevBlsDot!);
    }

    const blsDot = new Uint8Array(DOT_SIZE);
    blsDot.set(sharedPubkey, OFF_PUBKEY);
    blsDot.set(zeroedSig, OFF_SIG);
    blsDot.set(chainHash, OFF_CHAIN);
    writeTimestamp(blsDot, OFF_TS, timestamps[i]!);
    blsDot[OFF_TYPE] = types[i]!;
    blsDot.set(payloads[i]!, OFF_PAYLOAD);

    blsFormDots[i] = blsDot;
    prevBlsDot = blsDot;
  }

  // ── BLS sign each BLS-form DOT's signed portion ─────────────────────────────
  const perDotSigs: Uint8Array[] = new Array(dots.length);
  for (let i = 0; i < dots.length; i++) {
    const msg = extractSignedBytes(blsFormDots[i]!);
    perDotSigs[i] = signBLS(msg, blsKeypair.privateKey);
  }
  const aggSig = aggregateSignatures(perDotSigs);

  // ── Resolve predictor ───────────────────────────────────────────────────────
  let resolvedPredictor: PayloadPredictor | null = null;
  if (options?.predictor) {
    if (options.predictor === 'auto') {
      resolvedPredictor = selectPredictor(payloads);
    } else {
      resolvedPredictor = options.predictor;
    }
    resolvedPredictor.reset();
  }
  const usePrediction = resolvedPredictor !== null;

  // ── Encode columns ──────────────────────────────────────────────────────────
  const encodedTs = useTsDelta
    ? encodeTimestampDeltas(timestamps)
    : (() => {
        const buf = new Uint8Array(dots.length * 8);
        for (let i = 0; i < dots.length; i++) {
          writeTimestamp(buf, i * 8, timestamps[i]!);
        }
        return buf;
      })();

  const encodedTypes = useTypeRLE
    ? encodePayloadTypes(types)
    : types.slice();

  // ── Encode payload column ───────────────────────────────────────────────────
  // Either: raw payloads, predictor+rANS residuals, or dict-compressed body.
  let predictionMeta: Uint8Array | null = null; // 513 bytes when usePrediction
  let ransEncodedResiduals: Uint8Array | null = null;
  let ransEncodedLen = 0;

  if (usePrediction) {
    // Compute residuals with the resolved predictor
    const residuals = computeAllResiduals(payloads, resolvedPredictor!);

    // Build frequency table from residuals
    const freqTable = buildFrequencyTable(residuals);

    // rANS-encode all residuals as one stream
    ransEncodedResiduals = ransEncode(residuals, freqTable);
    ransEncodedLen = ransEncodedResiduals.length;

    // Serialize prediction metadata: modelId(1) + freqTable(512) = 513 bytes
    predictionMeta = new Uint8Array(PREDICTION_META_SIZE);
    predictionMeta[0] = resolvedPredictor!.modelId;
    predictionMeta.set(serializeFreqTable(freqTable), 1);
  }

  const encodedPayloads = usePrediction
    ? null // payload column is replaced by rANS residuals in body
    : (() => {
        const buf = new Uint8Array(dots.length * PAYLOAD_SIZE);
        for (let i = 0; i < dots.length; i++) {
          buf.set(payloads[i]!, i * PAYLOAD_SIZE);
        }
        return buf;
      })();

  // ── Assemble body ───────────────────────────────────────────────────────────
  // Body layout:
  //   ts column | types column | [if prediction: uint32-LE rans_len + rans data | else: raw payloads]
  // If dict (no prediction): entire body is zstd-compressed.
  let body: Uint8Array;

  if (usePrediction) {
    // Body = ts | types | rans_data | uint32LE(rans_len) [last 4 bytes]
    // Storing rans_len at the END allows clean RLE-types boundary detection on decode:
    //   rleEnd = bodyBuf.length - 4 - ransLen
    const bodySize = encodedTs.length + encodedTypes.length + ransEncodedLen + 4;
    const bodyBuf = new Uint8Array(bodySize);
    let off = 0;
    bodyBuf.set(encodedTs, off);                off += encodedTs.length;
    bodyBuf.set(encodedTypes, off);             off += encodedTypes.length;
    bodyBuf.set(ransEncodedResiduals!, off);     off += ransEncodedLen;
    // uint32 LE: rANS encoded byte count (last 4 bytes of body)
    const lenView = new DataView(bodyBuf.buffer, bodyBuf.byteOffset + off, 4);
    lenView.setUint32(0, ransEncodedLen, true);
    body = bodyBuf;
  } else {
    const rawBody = new Uint8Array(
      encodedTs.length + encodedTypes.length + encodedPayloads!.length,
    );
    let off = 0;
    rawBody.set(encodedTs, off);          off += encodedTs.length;
    rawBody.set(encodedTypes, off);       off += encodedTypes.length;
    rawBody.set(encodedPayloads!, off);

    body = useDict ? compressWithDictionary(rawBody, options!.dictionary!) : rawBody;
  }

  // ── Assemble frame ──────────────────────────────────────────────────────────
  // Header area = fixed header + optional dict_id + optional prediction metadata
  const headerSize = useDict ? HEADER_SIZE_WITH_DICT : HEADER_SIZE;
  const predMetaSize = usePrediction ? PREDICTION_META_SIZE : 0;
  const totalSize = headerSize + predMetaSize + body.length;
  const frame = new Uint8Array(totalSize);
  let cursor = 0;

  // Header
  frame[cursor++] = BATCH_V2_VERSION;
  frame[cursor++] =
    (useTsDelta ? FLAG_TS_DELTA : 0) |
    (useTypeRLE ? FLAG_TYPE_RLE : 0) |
    (useDict ? FLAG_DICT_COMPRESSED : 0) |
    (usePrediction ? FLAG_PREDICTION : 0);

  // dot_count: uint32 LE
  const countView = new DataView(frame.buffer, frame.byteOffset + cursor, 4);
  countView.setUint32(0, dots.length, true);
  cursor += 4;

  // shared_pubkey: 32B
  frame.set(sharedPubkey, cursor);
  cursor += PUBKEY_SIZE;

  // aggregated_bls_sig: 48B
  frame.set(aggSig, cursor);
  cursor += BLS_AGG_SIG_SIZE;

  // dictionary_id: 32B (only when FLAG_DICT_COMPRESSED is set)
  if (useDict) {
    frame.set(options!.dictionaryId!, cursor);
    cursor += DICT_ID_SIZE;
  }

  // prediction metadata: 513B (only when FLAG_PREDICTION is set)
  if (usePrediction) {
    frame.set(predictionMeta!, cursor);
    cursor += PREDICTION_META_SIZE;
  }

  // Body (columns, possibly prediction-coded or dict-compressed)
  frame.set(body, cursor);

  return frame;
}

// ─── Deserialize ──────────────────────────────────────────────────────────────

/**
 * Deserialize a batch v2 frame back to 153-byte DOTs.
 * Verifies BLS aggregate signature. Throws if invalid.
 *
 * Sprint 1 limitation: assumes genesis-anchored batch — chain[0] = 32 zero bytes.
 * Each subsequent chain hash is reconstructed as SHA-256(full_dot[i-1]) where
 * the sig field of each reconstructed DOT is the aggregate sig zero-padded to 64B.
 *
 * @param buf                - The batch v2 frame
 * @param blsPubkey          - 96-byte BLS G2 public key for verification
 * @param dictionaryRegistry - Optional registry for looking up zstd dictionaries.
 *                             Required when the frame has FLAG_DICT_COMPRESSED set.
 */
export async function deserializeBatchV2(
  buf: Uint8Array,
  blsPubkey: Uint8Array,
  dictionaryRegistry?: DictionaryRegistry,
): Promise<Uint8Array[]> {
  if (buf.length < HEADER_SIZE) {
    throw new RangeError(
      `deserializeBatchV2: buffer too short (${buf.length} bytes, need at least ${HEADER_SIZE})`,
    );
  }

  // ── Parse header ────────────────────────────────────────────────────────────
  let cursor = 0;

  const version = buf[cursor++]!;
  if (version !== BATCH_V2_VERSION) {
    throw new Error(
      `deserializeBatchV2: unsupported version 0x${version.toString(16).padStart(2, '0')} (expected 0x${BATCH_V2_VERSION.toString(16).padStart(2, '0')})`,
    );
  }

  const flags = buf[cursor++]!;
  const hasTsDelta = (flags & FLAG_TS_DELTA) !== 0;
  const hasTypeRLE = (flags & FLAG_TYPE_RLE) !== 0;
  const hasDictCompressed = (flags & FLAG_DICT_COMPRESSED) !== 0;
  const hasPrediction = (flags & FLAG_PREDICTION) !== 0;

  const countView = new DataView(buf.buffer, buf.byteOffset + cursor, 4);
  const dotCount = countView.getUint32(0, true);
  cursor += 4;

  if (dotCount === 0) {
    throw new RangeError('deserializeBatchV2: dot_count is 0');
  }

  const pubkey = buf.slice(cursor, cursor + PUBKEY_SIZE);
  cursor += PUBKEY_SIZE;

  const aggSig = buf.slice(cursor, cursor + BLS_AGG_SIG_SIZE);
  cursor += BLS_AGG_SIG_SIZE;

  // cursor is now at HEADER_SIZE (86)

  // ── Read dictionary_id if present and decompress body ────────────────────────
  let bodyBuf: Uint8Array;
  if (hasDictCompressed) {
    if (buf.length < HEADER_SIZE_WITH_DICT) {
      throw new RangeError(
        `deserializeBatchV2: buffer too short for dict header (${buf.length} bytes, need at least ${HEADER_SIZE_WITH_DICT})`,
      );
    }
    const dictionaryId = buf.slice(cursor, cursor + DICT_ID_SIZE);
    cursor += DICT_ID_SIZE;
    // cursor is now at HEADER_SIZE_WITH_DICT (118)

    if (!dictionaryRegistry) {
      const idHex = Array.from(dictionaryId)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      throw new Error(
        `deserializeBatchV2: frame uses dictionary compression (id=${idHex}) but no dictionaryRegistry was provided`,
      );
    }

    const entry = dictionaryRegistry.get(dictionaryId);
    if (!entry) {
      const idHex = Array.from(dictionaryId)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      throw new Error(
        `deserializeBatchV2: unknown dictionary id=${idHex} — register it in the DictionaryRegistry before deserializing`,
      );
    }

    // Decompress body using the looked-up dictionary
    const compressedBody = buf.subarray(cursor);
    bodyBuf = decompressWithDictionary(compressedBody, entry.dictionary);
  } else {
    // No dictionary compression — body starts at cursor (HEADER_SIZE = 86)
    bodyBuf = buf.subarray(cursor);
  }

  // ── Read prediction metadata if FLAG_PREDICTION is set ──────────────────────
  // Prediction metadata is stored after dict_id (if any) and BEFORE the body.
  // Format: 1B modelId + 512B freq table = 513 bytes total.
  // We read it from buf (not bodyBuf), advancing cursor past the prediction meta.
  let predictionPredictor: PayloadPredictor | null = null;
  let predictionFreqTable: FrequencyTable | null = null;

  if (hasPrediction) {
    // Re-derive the absolute cursor position in buf
    // cursor advanced through: version(1) + flags(1) + count(4) + pubkey(32) + aggSig(48) = 86
    // + dict_id(32) if hasDictCompressed
    // bodyBuf is buf.subarray(cursor_after_dict) — but we haven't advanced cursor for prediction meta yet
    // We need to read from the start of bodyBuf (before body columns)
    if (bodyBuf.length < PREDICTION_META_SIZE) {
      throw new RangeError(
        `deserializeBatchV2: buffer too short for prediction metadata (${bodyBuf.length} bytes, need ${PREDICTION_META_SIZE})`,
      );
    }
    const modelId = bodyBuf[0]!;
    predictionFreqTable = deserializeFreqTable(bodyBuf, 1);

    // Select predictor by modelId
    switch (modelId) {
      case 0x00:
        predictionPredictor = new NullPredictor();
        break;
      case 0x01:
        predictionPredictor = new LastValuePredictor();
        break;
      case 0x02:
        predictionPredictor = new LinearPredictor();
        break;
      default:
        throw new Error(`deserializeBatchV2: unknown predictor modelId 0x${modelId.toString(16)}`);
    }
    predictionPredictor.reset();

    // Advance bodyBuf past the prediction metadata
    bodyBuf = bodyBuf.subarray(PREDICTION_META_SIZE);
  }

  // From here on, all column decoding operates on bodyBuf (decompressed or raw,
  // with prediction metadata already consumed if hasPrediction).
  // bodyCursor is always relative to bodyBuf (starts at 0).
  let bodyCursor = 0;
  const payloadsTotalSize = dotCount * PAYLOAD_SIZE;
  let timestamps: bigint[];
  let tsColumnSize: number;

  if (hasTsDelta) {
    // Delta-encoded: decode first, then re-encode to measure consumed bytes
    const tsBuf = bodyBuf.subarray(bodyCursor);
    timestamps = decodeTimestampDeltas(tsBuf, dotCount);
    // Measure size by re-encoding (idempotent roundtrip)
    tsColumnSize = encodeTimestampDeltas(timestamps).length;
  } else {
    // Raw timestamps: dotCount × 8B
    tsColumnSize = dotCount * 8;
    if (bodyCursor + tsColumnSize > bodyBuf.length) {
      throw new RangeError('deserializeBatchV2: buffer too short for raw timestamps');
    }
    timestamps = [];
    for (let i = 0; i < dotCount; i++) {
      timestamps.push(readTimestamp(bodyBuf, bodyCursor + i * 8));
    }
  }

  const tsEnd = bodyCursor + tsColumnSize;

  // ── Decode type column ──────────────────────────────────────────────────────
  let types: Uint8Array;
  let typesEnd: number;

  if (hasTypeRLE) {
    // RLE-encoded types — the types column ends where payload data begins.
    // When prediction is active, payload data = uint32(4) + rans_bytes (variable).
    // When prediction is inactive, payload data = dotCount × 16B (fixed).
    // We find the RLE end differently for each case.
    if (hasPrediction) {
      // With prediction the body layout is: [ts][types][rans_data][uint32 rans_len (last 4B)]
      // rans_len is stored as the last 4 bytes → rleEnd = bodyBuf.length - 4 - ransLen
      const ransLenView = new DataView(
        bodyBuf.buffer,
        bodyBuf.byteOffset + bodyBuf.length - 4,
        4,
      );
      const ransEncodedLen = ransLenView.getUint32(0, true);
      // rle types run from tsEnd to (bodyBuf.length - 4 - ransEncodedLen)
      const rleEnd = bodyBuf.length - 4 - ransEncodedLen;
      if (rleEnd <= tsEnd) {
        throw new RangeError('deserializeBatchV2: buffer too short for RLE types + rANS data');
      }
      const rleSlice = bodyBuf.subarray(tsEnd, rleEnd);
      types = decodePayloadTypes(rleSlice, dotCount);
      typesEnd = rleEnd;
    } else {
      // No prediction: payloads are always at the tail: dotCount × 16B.
      const rleEnd = bodyBuf.length - payloadsTotalSize;
      if (rleEnd <= tsEnd) {
        throw new RangeError('deserializeBatchV2: buffer too short for RLE types + payloads');
      }
      const rleSlice = bodyBuf.subarray(tsEnd, rleEnd);
      types = decodePayloadTypes(rleSlice, dotCount);
      typesEnd = rleEnd;
    }
  } else {
    // Raw types: dotCount × 1B
    if (tsEnd + dotCount > bodyBuf.length) {
      throw new RangeError('deserializeBatchV2: buffer too short for raw types');
    }
    types = bodyBuf.slice(tsEnd, tsEnd + dotCount);
    typesEnd = tsEnd + dotCount;
  }

  // ── Decode payload column ───────────────────────────────────────────────────
  // Decode payloads into a flat array: either raw bytes or rANS-decoded residuals.
  const decodedPayloads: Uint8Array[] = new Array(dotCount);

  if (hasPrediction) {
    // With prediction: body = [ts][types][rans_data][uint32 rans_len (last 4B)]
    // ransEnd = bodyBuf.length - 4
    // ransStart = typesEnd
    const ransLen = new DataView(
      bodyBuf.buffer,
      bodyBuf.byteOffset + bodyBuf.length - 4,
      4,
    ).getUint32(0, true);
    const ransStart = typesEnd;
    const ransEnd = bodyBuf.length - 4;
    if (ransEnd - ransStart !== ransLen) {
      throw new RangeError(
        `deserializeBatchV2: rANS data length mismatch (got ${ransEnd - ransStart}, expected ${ransLen})`,
      );
    }
    const ransData = bodyBuf.subarray(ransStart, ransEnd);
    const totalResidualBytes = dotCount * PAYLOAD_SIZE;
    const residuals = ransDecode(ransData, predictionFreqTable!, totalResidualBytes);

    // Reconstruct payloads from residuals using the predictor
    for (let i = 0; i < dotCount; i++) {
      const predicted = predictionPredictor!.predict();
      const residual = residuals.subarray(i * PAYLOAD_SIZE, (i + 1) * PAYLOAD_SIZE);
      const actual = applyResidual(residual, predicted);
      decodedPayloads[i] = actual;
      predictionPredictor!.update(actual);
    }
  } else {
    // Raw payloads at tail
    if (typesEnd + payloadsTotalSize > bodyBuf.length) {
      throw new RangeError('deserializeBatchV2: buffer too short for payloads');
    }
    for (let i = 0; i < dotCount; i++) {
      const off = typesEnd + i * PAYLOAD_SIZE;
      decodedPayloads[i] = bodyBuf.subarray(off, off + PAYLOAD_SIZE);
    }
  }

  // ── Reconstruct BLS-form DOTs (zeroed sig field) for verification ───────────
  // CRITICAL: Use zeroed sig field for chain hash computation — same rule as
  // serialization. The BLS aggregate sig is NOT used in chain hashes; it would
  // create a circular dependency (sig depends on messages, messages depend on chain
  // hashes, chain hashes depend on sig). Zeroed sig is the canonical form.
  //
  // Sprint 1 limitation: genesis-anchored batch — chain[0] = 32 zero bytes.
  const zeroedSig = new Uint8Array(SIG_SIZE); // 64 zero bytes
  const blsFormDots: Uint8Array[] = new Array(dotCount);
  let prevChain = new Uint8Array(CHAIN_SIZE); // 32 zeros = genesis chain

  for (let i = 0; i < dotCount; i++) {
    const dot = new Uint8Array(DOT_SIZE);

    // pubkey [0..31]
    dot.set(pubkey, OFF_PUBKEY);

    // sig field [32..95] — zeroed (canonical BLS form for chain hashing)
    dot.set(zeroedSig, OFF_SIG);

    // chain hash [96..127] — previous DOT's chain (or genesis zeros)
    dot.set(prevChain, OFF_CHAIN);

    // timestamp [128..135]
    writeTimestamp(dot, OFF_TS, timestamps[i]!);

    // type [136]
    dot[OFF_TYPE] = types[i]!;

    // payload [137..152]
    dot.set(decodedPayloads[i]!, OFF_PAYLOAD);

    blsFormDots[i] = dot;

    // Chain hash for next DOT: SHA-256(this BLS-form DOT)
    prevChain = sha256(dot);
  }

  // ── BLS aggregate signature verification ────────────────────────────────────
  const signedMessages = blsFormDots.map(dot => extractSignedBytes(dot));
  const valid = verifyAggregateSameSigner(aggSig, signedMessages, blsPubkey);
  if (!valid) {
    throw new Error('deserializeBatchV2: BLS aggregate signature verification failed');
  }

  // ── Build final DOTs with aggSig in sig field (wire-format completeness) ─────
  // The returned DOTs store the aggregate sig (zero-padded to 64B) in the sig
  // field for wire-format completeness. Chain hashes were computed from zeroed
  // sig form above, so they are preserved here (prevChain already advanced).
  const sigField = buildSigField(aggSig);
  const dots: Uint8Array[] = new Array(dotCount);
  for (let i = 0; i < dotCount; i++) {
    const dot = blsFormDots[i]!.slice(); // copy BLS-form DOT
    dot.set(sigField, OFF_SIG);          // replace zeroed sig with aggSig field
    dots[i] = dot;
  }

  return dots;
}
