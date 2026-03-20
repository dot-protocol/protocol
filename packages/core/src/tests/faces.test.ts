import { describe, it, expect } from 'vitest';
import {
  DOTFace,
  ALPHABET_FACES,
  validateFaceMask,
  hasFace,
  composeFaces,
  activeFaces,
} from '../faces.js';

describe('DOTFace — 12+1 Architecture', () => {
  it('has exactly 12 alphabet faces', () => {
    expect(ALPHABET_FACES).toHaveLength(12);
  });

  it('Transformer has a unique bitmask not shared by alphabet faces', () => {
    for (const face of ALPHABET_FACES) {
      expect(face & DOTFace.Transformer).toBe(0);
    }
  });

  it('all alphabet face bitmasks are powers of 2 (no overlap)', () => {
    const all = [...ALPHABET_FACES, DOTFace.Transformer];
    const seen = new Set<number>();
    for (const f of all) {
      expect(seen.has(f)).toBe(false);
      expect(f & (f - 1)).toBe(0); // power of 2 check
      seen.add(f);
    }
  });
});

describe('validateFaceMask', () => {
  it('rejects mask = 0', () => {
    const r = validateFaceMask(0);
    expect(r.valid).toBe(false);
  });

  it('accepts single alphabet face', () => {
    expect(validateFaceMask(DOTFace.File).valid).toBe(true);
  });

  it('accepts Transformer + alphabet face', () => {
    const mask = composeFaces(DOTFace.Camera, DOTFace.Transformer);
    expect(validateFaceMask(mask).valid).toBe(true);
  });

  it('accepts multiple alphabet faces', () => {
    const mask = composeFaces(DOTFace.QR, DOTFace.Container, DOTFace.Microdot);
    expect(validateFaceMask(mask).valid).toBe(true);
  });

  it('Transformer-only mask is invalid (no alphabet face)', () => {
    const r = validateFaceMask(DOTFace.Transformer);
    expect(r.valid).toBe(false);
  });
});

describe('hasFace', () => {
  it('returns true when face is present', () => {
    const mask = composeFaces(DOTFace.File, DOTFace.Tunnel);
    expect(hasFace(mask, DOTFace.File)).toBe(true);
    expect(hasFace(mask, DOTFace.Tunnel)).toBe(true);
  });

  it('returns false when face is absent', () => {
    const mask = DOTFace.File;
    expect(hasFace(mask, DOTFace.Camera)).toBe(false);
  });
});

describe('composeFaces', () => {
  it('combines faces into bitfield', () => {
    const mask = composeFaces(DOTFace.File, DOTFace.Tunnel, DOTFace.Transformer);
    expect(hasFace(mask, DOTFace.File)).toBe(true);
    expect(hasFace(mask, DOTFace.Tunnel)).toBe(true);
    expect(hasFace(mask, DOTFace.Transformer)).toBe(true);
    expect(hasFace(mask, DOTFace.Camera)).toBe(false);
  });

  it('idempotent — composing same face twice = same result', () => {
    const mask1 = composeFaces(DOTFace.File);
    const mask2 = composeFaces(DOTFace.File, DOTFace.File);
    expect(mask1).toBe(mask2);
  });
});

describe('activeFaces', () => {
  it('returns names of active faces', () => {
    const mask = composeFaces(DOTFace.QR, DOTFace.Container);
    const names = activeFaces(mask);
    expect(names).toContain('QR');
    expect(names).toContain('Container');
    expect(names).not.toContain('File');
  });

  it('returns empty array for mask 0', () => {
    expect(activeFaces(0)).toEqual([]);
  });
});
