/**
 * Browser-safe compression measurement for DOT batches.
 * Uses LinearPredictor residuals to estimate compression ratio.
 * No native deps — works in browser and Node.js.
 */
import { LinearPredictor } from '@dotprotocol/compression';

export interface CompressionStats {
  rawSize: number;
  compressedSize: number;
  ratio: number;
  predictorAccuracy: number;
}

export interface BatchCompressor {
  measure(dots: Uint8Array[]): CompressionStats;
  feed(dot: Uint8Array): void;
  reset(): void;
}

const PAYLOAD_OFFSET = 137;
const PAYLOAD_SIZE = 16;
const DOT_SIZE = 153;

export function createBatchCompressor(): BatchCompressor {
  const predictor = new LinearPredictor();

  return {
    feed(dot: Uint8Array) {
      const payload = dot.slice(PAYLOAD_OFFSET, PAYLOAD_OFFSET + PAYLOAD_SIZE);
      predictor.update(payload);
    },

    measure(dots: Uint8Array[]): CompressionStats {
      if (dots.length === 0) {
        return { rawSize: 0, compressedSize: 0, ratio: 1, predictorAccuracy: 0 };
      }

      const tempPredictor = new LinearPredictor();
      let zeroResiduals = 0;

      for (const dot of dots) {
        const payload = dot.slice(PAYLOAD_OFFSET, PAYLOAD_OFFSET + PAYLOAD_SIZE);
        const pred = tempPredictor.predict();

        // Compute whether residual is all-zero (perfect prediction)
        let allZero = true;
        for (let i = 0; i < PAYLOAD_SIZE; i++) {
          if ((payload[i]! ^ pred[i]!) !== 0) {
            allZero = false;
            break;
          }
        }
        if (allZero) zeroResiduals++;

        tempPredictor.update(payload);
      }

      const rawSize = dots.length * DOT_SIZE;

      // Estimate compressed size:
      // - Fixed overhead: public key (32B) + chain hash base (32B) + header bytes
      // - Per-DOT overhead: signature (64B) + timestamp (8B) + type (1B) = 73B always
      // - Payload: zero-residual DOTs use ~1 bit (RLE), others use 16 bytes
      const nonPredicted = dots.length - zeroResiduals;
      const fixedPerDot = 73; // sig + ts + type (can't compress well)
      const payloadBytes = nonPredicted * PAYLOAD_SIZE + zeroResiduals; // ~1 byte each for zero-residuals
      const overhead = 64; // batch header overhead
      const compressedSize = Math.max(overhead + dots.length * fixedPerDot + payloadBytes, 1);

      return {
        rawSize,
        compressedSize: Math.min(compressedSize, rawSize),
        ratio: rawSize / Math.min(compressedSize, rawSize),
        predictorAccuracy: dots.length > 0 ? zeroResiduals / dots.length : 0,
      };
    },

    reset() {
      predictor.reset();
    },
  };
}
