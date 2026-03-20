/**
 * DOT Protocol v0.3.0 — QR-DOT Types
 *
 * Specification for encoding DOTs into scannable physical objects.
 * A DOT printed as QR on paper IS Falooda Protocol.
 */

/** QR error correction levels */
export type QRErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** Encoding strategy for DOTs in QR modules */
export type QREncoding = 'binary' | 'steganographic' | 'nested';

/**
 * QR code specification for a physical DOT.
 *
 * - binary:          DOTs serialized directly into QR data bytes
 * - steganographic:  DOTs hidden in visual pattern of QR modules
 * - nested:          each QR module is itself a microdot container
 */
export interface QRDOTSpec {
  version: number;                    // QR version (1–40)
  errorCorrection: QRErrorCorrection;
  dotsPerCode: number;               // how many DOTs encoded (1–800)
  encoding: QREncoding;
}

/**
 * A physical DOT: one or more DOTs encoded into a scannable object.
 * The Falooda Protocol endpoint — zero cost communication.
 */
export interface PhysicalDOT {
  qr: QRDOTSpec;
  chain: import('@dot-protocol/core').DOT[];   // the DOTs encoded
  scannerFace: 'camera' | 'reader';             // how to read it
  transformOnScan?: string;                     // transform registry ID triggered by scanning
}

/** QR channel capacity constants */
export const QR_CAPACITY = {
  /** Max data bytes in a QR v40 L code */
  maxBytesPerCode: 2953,
  /** ~19 DOTs per standard QR (2953 / 153) */
  dotsPerCode: Math.floor(2953 / 153),
  /** Microdot density at arm's length (dots per cm²) */
  microDotDensity: 800,
  /** Storage capacity at arm's length (~122 KB per cm²) */
  microDotCapacity: 800 * 153,
} as const;

/** Result of decoding a QR image into DOTs */
export interface QRDecodeResult {
  dots: import('@dot-protocol/core').DOT[];
  encoding: QREncoding;
  verified: boolean;    // true if all DOT signatures passed
  errors: string[];
}
