/**
 * DOT Protocol — 12+1 Face Architecture
 *
 * 12 alphabet faces describe WHAT is being observed.
 * 1 Transformer face describes HOW state changed.
 *
 * Faces are stored as a bitfield — a DOT can compose multiple faces.
 */

/** The 12 alphabet faces (input/output types) + 1 production rule */
export enum DOTFace {
  File         = 0x01,  // data at rest
  Tunnel       = 0x02,  // data in transit
  Container    = 0x04,  // DOT carrying DOTs
  Reader       = 0x08,  // data being consumed
  Camera       = 0x10,  // visual observation captured
  QR           = 0x20,  // scannable physical DOT
  Writer       = 0x40,  // data being produced
  Steganography= 0x80,  // hidden data within visible carrier
  Microdot     = 0x100, // minimal physical encoding
  Compiler     = 0x200, // format conversion
  Connector    = 0x400, // bridge between systems
  SelfAware    = 0x800, // DOT observing chain health (Gödel constraint)

  // Production rule — operator
  Transformer  = 0x1000, // maps input state to output state via named transform
}

/** A bitfield of active faces. Multiple faces can be combined. */
export type DOTFaceMask = number;

/** All 12 alphabet faces (excludes Transformer) */
export const ALPHABET_FACES = [
  DOTFace.File, DOTFace.Tunnel, DOTFace.Container, DOTFace.Reader,
  DOTFace.Camera, DOTFace.QR, DOTFace.Writer, DOTFace.Steganography,
  DOTFace.Microdot, DOTFace.Compiler, DOTFace.Connector, DOTFace.SelfAware,
];

/** Validate face composition rules */
export function validateFaceMask(mask: DOTFaceMask): { valid: boolean; reason?: string } {
  if (mask === 0) {
    return { valid: false, reason: 'A DOT must have at least one face' };
  }

  const hasAlphabet = ALPHABET_FACES.some((f) => (mask & f) !== 0);
  if (!hasAlphabet) {
    return { valid: false, reason: 'A DOT must have at least one alphabet face' };
  }

  const hasTransformer = (mask & DOTFace.Transformer) !== 0;
  if (hasTransformer && !hasAlphabet) {
    return { valid: false, reason: 'Transformer face requires at least one alphabet face' };
  }

  return { valid: true };
}

/** Check if a face mask includes a specific face */
export function hasFace(mask: DOTFaceMask, face: DOTFace): boolean {
  return (mask & face) !== 0;
}

/** Compose multiple faces into a bitfield mask */
export function composeFaces(...faces: DOTFace[]): DOTFaceMask {
  return faces.reduce((acc, f) => acc | f, 0);
}

/** List active face names from a mask */
export function activeFaces(mask: DOTFaceMask): string[] {
  return Object.entries(DOTFace)
    .filter(([, v]) => typeof v === 'number' && (mask & (v as number)) !== 0)
    .map(([k]) => k);
}
