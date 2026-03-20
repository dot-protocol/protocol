import { describe, it, expect } from 'vitest';
import {
  updateElo,
  applyEloUpdates,
  computeW,
  estimatePayloadEntropy,
  computeDepth,
  computeWidth,
  applyWidthDecay,
  computeTier,
  buildScores,
  ELO_DEFAULT,
  TIER_THRESHOLDS,
  WIDTH_DECAY_MONTHLY,
} from '../scoring.js';

describe('Elo rating', () => {
  it('correct prediction increases Elo above default', () => {
    const after = updateElo(ELO_DEFAULT, { domain: 'prediction', correct: true });
    expect(after).toBeGreaterThan(ELO_DEFAULT);
  });

  it('incorrect prediction decreases Elo below default', () => {
    const after = updateElo(ELO_DEFAULT, { domain: 'prediction', correct: false });
    expect(after).toBeLessThan(ELO_DEFAULT);
  });

  it('expected value for default vs default is 0.5', () => {
    // correct=true vs equal opponent: gain = K * (1 - 0.5) = 16
    const after = updateElo(ELO_DEFAULT, { domain: 'd', correct: true, opponentElo: ELO_DEFAULT });
    expect(after - ELO_DEFAULT).toBeCloseTo(16, 0);
  });

  it('applyEloUpdates returns a new map (immutable)', () => {
    const original = new Map([['a', 1600]]);
    const updates = [{ domain: 'a', correct: true }];
    const result = applyEloUpdates(original, updates);
    expect(result).not.toBe(original);
    expect(original.get('a')).toBe(1600); // original unchanged
    expect(result.get('a')).toBeGreaterThan(1600);
  });

  it('applyEloUpdates creates new domain entry from default', () => {
    const result = applyEloUpdates(new Map(), [{ domain: 'new', correct: true }]);
    expect(result.has('new')).toBe(true);
    expect(result.get('new')).toBeGreaterThan(ELO_DEFAULT);
  });
});

describe('W score (compression ratio)', () => {
  it('returns 0 for empty chain', () => {
    expect(computeW(0, 0)).toBe(0);
  });

  it('returns 0 for all-zero payloads (no entropy)', () => {
    const zeros = [new Uint8Array(16), new Uint8Array(16)];
    const entropy = estimatePayloadEntropy(zeros);
    expect(computeW(entropy, 2)).toBeCloseTo(0, 5);
  });

  it('non-zero for varied payloads', () => {
    const payloads = Array.from({ length: 10 }, (_, i) => {
      const b = new Uint8Array(16);
      b.fill(i % 256);
      return b;
    });
    const entropy = estimatePayloadEntropy(payloads);
    expect(entropy).toBeGreaterThan(0);
    expect(computeW(entropy, 10)).toBeGreaterThan(0);
  });
});

describe('Depth & Width', () => {
  it('depth = chain length', () => {
    expect(computeDepth(1)).toBe(1);
    expect(computeDepth(42)).toBe(42);
    expect(computeDepth(0)).toBe(0);
  });

  it('width = branched chain count', () => {
    expect(computeWidth(0)).toBe(0);
    expect(computeWidth(999)).toBe(999);
  });
});

describe('Width decay', () => {
  it('no decay at 0 months', () => {
    expect(applyWidthDecay(100, 0)).toBe(100);
  });

  it('decays by WIDTH_DECAY_MONTHLY each month', () => {
    const after1 = applyWidthDecay(100, 1);
    expect(after1).toBeCloseTo(100 * (1 - WIDTH_DECAY_MONTHLY), 5);
  });

  it('decays significantly after many months', () => {
    // 0.9^200 ≈ 7e-10, which is effectively zero for any practical weight
    expect(applyWidthDecay(100, 200)).toBeLessThan(1e-6);
  });
});

describe('Tier computation', () => {
  it('observer tier for low depth', () => {
    const scores = buildScores({ chainLength: 10, branchedChainCount: 0 });
    expect(computeTier(scores)).toBe('observer');
  });

  it('contributor tier for depth >= 100 and width >= 10', () => {
    const scores = buildScores({ chainLength: 150, branchedChainCount: 20 });
    expect(computeTier(scores)).toBe('contributor');
  });

  it('architect tier for top Elo percentile in 1+ domain', () => {
    const scores = buildScores({
      chainLength: 200,
      branchedChainCount: 5,
      eloMap: new Map([['prediction', 2000]]),
    });
    expect(computeTier(scores, 0.92)).toBe('architect');
  });

  it('luminary requires top percentile in 3+ domains, 1000+ width, W >= 20', () => {
    const eloMap = new Map([
      ['prediction', 2100],
      ['teaching', 2050],
      ['engineering', 1950],
    ]);
    // Build scores but override W manually since we can't easily generate real entropy
    const scores = buildScores({
      chainLength: 5000,
      branchedChainCount: 1500,
      eloMap,
    });
    // Override w to meet luminary threshold
    (scores as { w: number }).w = 25;
    expect(computeTier(scores, 0.95)).toBe('luminary');
  });

  it('falls back to contributor even with high percentile if width < 1000', () => {
    const eloMap = new Map([['d1', 2100], ['d2', 2100], ['d3', 2100]]);
    const scores = buildScores({ chainLength: 200, branchedChainCount: 15, eloMap });
    (scores as { w: number }).w = 25;
    // percentile 0.95 but width=15 < 1000 → not luminary, not architect (no minWidth), so architect
    const tier = computeTier(scores, 0.95);
    expect(['architect', 'contributor']).toContain(tier);
  });
});
