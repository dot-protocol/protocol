import { describe, it, expect } from 'vitest';
import { weissmanScore, WEISSMAN_PRESETS } from '../weissman.js';

describe('weissmanScore()', () => {
  it('computes ratio correctly: 153B raw, 18B compressed, 106B gzip', () => {
    // r_algo = 153/18 = 8.5, r_gzip = 153/106 ≈ 1.4434
    // W = 8.5 / 1.4434 ≈ 5.889
    const w = weissmanScore(153, 18, 106);
    expect(w).toBeCloseTo(5.889, 2);
  });

  it('returns 1.0 when algorithm equals gzip (equal compression)', () => {
    const w = weissmanScore(100, 100, 100, 1.0);
    expect(w).toBe(1.0);
  });

  it('respects alpha scaling factor', () => {
    const w1 = weissmanScore(100, 50, 100, 1.0);
    const w2 = weissmanScore(100, 50, 100, 2.0);
    expect(w2).toBeCloseTo(w1 * 2, 10);
  });

  it('default alpha is 1.0', () => {
    const w = weissmanScore(200, 50, 100);
    // r_algo = 200/50 = 4, r_gzip = 200/100 = 2, W = 4/2 = 2
    expect(w).toBeCloseTo(2.0, 10);
  });
});

describe('WEISSMAN_PRESETS', () => {
  it('gzip preset has weissmanScore of exactly 1.0 (reference baseline)', () => {
    expect(WEISSMAN_PRESETS.gzip.weissmanScore).toBe(1.0);
  });

  it('dotPhase2DictLarge has bytesPerDot < 5 (best measured level)', () => {
    expect(WEISSMAN_PRESETS.dotPhase2DictLarge.bytesPerDot).toBeLessThan(5);
  });

  it('dotBLSBatch weissmanScore ≈ 2.459 (Phase 1.5 published result)', () => {
    expect(WEISSMAN_PRESETS.dotBLSBatch.weissmanScore).toBeCloseTo(2.459, 2);
  });

  it('all presets have compressionRatio > 0', () => {
    for (const [key, preset] of Object.entries(WEISSMAN_PRESETS)) {
      expect(preset.compressionRatio, `${key}.compressionRatio`).toBeGreaterThan(0);
    }
  });

  it('all presets have bytesPerDot > 0', () => {
    for (const [key, preset] of Object.entries(WEISSMAN_PRESETS)) {
      expect(preset.bytesPerDot, `${key}.bytesPerDot`).toBeGreaterThan(0);
    }
  });

  it('weissmanScore function is exported and callable', () => {
    expect(typeof weissmanScore).toBe('function');
    const result = weissmanScore(153, 18, 106);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('Phase 2 dictionary preset outperforms plain preset', () => {
    expect(WEISSMAN_PRESETS.dotPhase2Dict.weissmanScore)
      .toBeGreaterThan(WEISSMAN_PRESETS.dotPhase2Plain.weissmanScore);
  });
});
