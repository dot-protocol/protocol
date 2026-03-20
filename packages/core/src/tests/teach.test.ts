import { describe, it, expect } from 'vitest';
import {
  computeRoyalty,
  validateTEACHConfig,
  DEFAULT_TEACH_CONFIG,
} from '../teach.js';
import type { TEACHConfig } from '../teach.js';

describe('DEFAULT_TEACH_CONFIG', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_TEACH_CONFIG.byte).toBe(0x01);
    expect(DEFAULT_TEACH_CONFIG.royaltyBps).toBe(100);  // 1%
    expect(DEFAULT_TEACH_CONFIG.propagationDepth).toBe(3);
    expect(DEFAULT_TEACH_CONFIG.paymentMethod).toBe('x402');
  });
});

describe('validateTEACHConfig', () => {
  it('accepts valid config', () => {
    expect(validateTEACHConfig(DEFAULT_TEACH_CONFIG).valid).toBe(true);
  });

  it('rejects negative royaltyBps', () => {
    const r = validateTEACHConfig({ ...DEFAULT_TEACH_CONFIG, royaltyBps: -1 });
    expect(r.valid).toBe(false);
  });

  it('rejects royaltyBps > 10000 (>100%)', () => {
    const r = validateTEACHConfig({ ...DEFAULT_TEACH_CONFIG, royaltyBps: 10001 });
    expect(r.valid).toBe(false);
  });

  it('rejects propagationDepth < 1', () => {
    const r = validateTEACHConfig({ ...DEFAULT_TEACH_CONFIG, propagationDepth: 0 });
    expect(r.valid).toBe(false);
  });

  it('accepts byte = 0x00 (no royalty)', () => {
    const r = validateTEACHConfig({ ...DEFAULT_TEACH_CONFIG, byte: 0x00 });
    expect(r.valid).toBe(true);
  });

  it('accepts byte = 0xFF', () => {
    const r = validateTEACHConfig({ ...DEFAULT_TEACH_CONFIG, byte: 0xFF });
    expect(r.valid).toBe(true);
  });
});

describe('computeRoyalty', () => {
  const config: TEACHConfig = {
    byte: 0x01,
    royaltyBps: 1000, // 10%
    propagationDepth: 3,
    paymentMethod: 'x402',
  };

  it('returns 0 when byte = 0x00', () => {
    const zeroByte = { ...config, byte: 0x00 };
    expect(computeRoyalty(zeroByte, 1, 10000)).toBe(0);
  });

  it('returns 0 when depth exceeds propagationDepth', () => {
    expect(computeRoyalty(config, 4, 10000)).toBe(0);
    expect(computeRoyalty(config, 99, 10000)).toBe(0);
  });

  it('returns full royalty at depth 1', () => {
    // depth 1 of 3: multiplier = 1 - (1-1)/max(1,3) = 1
    // royalty = floor(10000 * 1000 * 1 / 10000) = 1000
    expect(computeRoyalty(config, 1, 10000)).toBe(1000);
  });

  it('returns reduced royalty at depth 2', () => {
    // depth 2 of 3: multiplier = 1 - 1/3 = 0.667
    // royalty = floor(10000 * 1000 * 0.667 / 10000) = 666
    const r = computeRoyalty(config, 2, 10000);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1000);
  });

  it('returns 0 royalty at exactly propagationDepth+1', () => {
    expect(computeRoyalty(config, config.propagationDepth + 1, 10000)).toBe(0);
  });

  it('royalty decays linearly: depth 1 > depth 2 > depth 3', () => {
    const d1 = computeRoyalty(config, 1, 10000);
    const d2 = computeRoyalty(config, 2, 10000);
    const d3 = computeRoyalty(config, 3, 10000);
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThanOrEqual(d3);
  });

  it('returns 0 for baseValue = 0', () => {
    expect(computeRoyalty(config, 1, 0)).toBe(0);
  });
});
