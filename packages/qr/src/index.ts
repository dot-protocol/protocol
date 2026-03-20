/**
 * @dot-protocol/qr — v0.3.0
 *
 * QR-DOT encoding: pack DOTs into scannable physical objects.
 * A DOT printed as QR on paper IS Falooda Protocol.
 *
 * "Zero-cost communication for people without devices."
 */

export {
  encodeBinary,
  decodeBinary,
  encodeSteganographic,
  decodeSteganographic,
  encodeNested,
  decodeNested,
  selectQRSpec,
  DOT_SIZE,
} from './encode.js';

export { verifyPhysicalDOTs } from './verify.js';

export type {
  QRErrorCorrection,
  QREncoding,
  QRDOTSpec,
  PhysicalDOT,
  QRDecodeResult,
} from './types.js';

export { QR_CAPACITY } from './types.js';
