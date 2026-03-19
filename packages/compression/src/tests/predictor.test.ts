import { describe, it, expect } from 'vitest';
import {
  NullPredictor,
  LastValuePredictor,
  LinearPredictor,
  computeResidual,
  applyResidual,
} from '../predictor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(fillByte: number): Uint8Array {
  return new Uint8Array(16).fill(fillByte);
}

function makeRamp(start: number, step: number): Uint8Array {
  const arr = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    arr[i] = (start + i * step) & 0xff;
  }
  return arr;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function allZeros(a: Uint8Array): boolean {
  return a.every((b) => b === 0);
}

// ---------------------------------------------------------------------------
// 1. NullPredictor
// ---------------------------------------------------------------------------

describe('NullPredictor', () => {
  it('predict() always returns 16 zero bytes before any update', () => {
    const p = new NullPredictor();
    const pred = p.predict();
    expect(pred.length).toBe(16);
    expect(allZeros(pred)).toBe(true);
  });

  it('predict() still returns zeros after update()', () => {
    const p = new NullPredictor();
    p.update(makePayload(0x42));
    const pred = p.predict();
    expect(allZeros(pred)).toBe(true);
  });

  it('predict() returns zeros after multiple updates', () => {
    const p = new NullPredictor();
    p.update(makePayload(0xAA));
    p.update(makePayload(0xBB));
    p.update(makePayload(0xCC));
    expect(allZeros(p.predict())).toBe(true);
  });

  it('modelId is 0x00', () => {
    const p = new NullPredictor();
    expect(p.modelId).toBe(0x00);
  });
});

// ---------------------------------------------------------------------------
// 2. LastValuePredictor
// ---------------------------------------------------------------------------

describe('LastValuePredictor', () => {
  it('first predict() returns zeros (no history)', () => {
    const p = new LastValuePredictor();
    expect(allZeros(p.predict())).toBe(true);
  });

  it('after update(x), predict() returns x', () => {
    const p = new LastValuePredictor();
    const x = makePayload(0x42);
    p.update(x);
    expect(arraysEqual(p.predict(), x)).toBe(true);
  });

  it('after update(x) then update(y), predict() returns y', () => {
    const p = new LastValuePredictor();
    const x = makePayload(0x10);
    const y = makePayload(0xFF);
    p.update(x);
    p.update(y);
    expect(arraysEqual(p.predict(), y)).toBe(true);
  });

  it('predict() does not mutate internal state (idempotent)', () => {
    const p = new LastValuePredictor();
    const x = makePayload(0x77);
    p.update(x);
    const pred1 = p.predict();
    const pred2 = p.predict();
    expect(arraysEqual(pred1, pred2)).toBe(true);
  });

  it('reset() causes predict() to return zeros again', () => {
    const p = new LastValuePredictor();
    p.update(makePayload(0x55));
    p.reset();
    expect(allZeros(p.predict())).toBe(true);
  });

  it('modelId is 0x01', () => {
    const p = new LastValuePredictor();
    expect(p.modelId).toBe(0x01);
  });
});

// ---------------------------------------------------------------------------
// 3. LinearPredictor
// ---------------------------------------------------------------------------

describe('LinearPredictor — basic predictions', () => {
  it('first predict() returns zeros (no history)', () => {
    const p = new LinearPredictor();
    expect(allZeros(p.predict())).toBe(true);
  });

  it('after update(x), predict() returns x (one-step: repeat first)', () => {
    const p = new LinearPredictor();
    const x = makePayload(0x30);
    p.update(x);
    expect(arraysEqual(p.predict(), x)).toBe(true);
  });

  it('after update(x) then update(y), predict() extrapolates: 2y - x (byte-level, wrapping)', () => {
    const p = new LinearPredictor();
    // x[i] = 0x10, y[i] = 0x20 → predicted = 2*0x20 - 0x10 = 0x30
    const x = makePayload(0x10);
    const y = makePayload(0x20);
    p.update(x);
    p.update(y);
    const pred = p.predict();
    expect(pred.length).toBe(16);
    // Every byte: 2 * 0x20 - 0x10 = 0x30
    for (let i = 0; i < 16; i++) {
      expect(pred[i]).toBe(0x30);
    }
  });

  it('byte-level wrapping: (2 * 0xFF - 0xFE) & 0xFF = 0x00', () => {
    const p = new LinearPredictor();
    // x = 0xFE, y = 0xFF → predicted = 2*0xFF - 0xFE = 256 = 0x00 (wrapped)
    const x = makePayload(0xFE);
    const y = makePayload(0xFF);
    p.update(x);
    p.update(y);
    const pred = p.predict();
    for (let i = 0; i < 16; i++) {
      expect(pred[i]).toBe(0x00);
    }
  });

  it('reset() clears state and predict() returns zeros again', () => {
    const p = new LinearPredictor();
    p.update(makePayload(0x10));
    p.update(makePayload(0x20));
    p.reset();
    expect(allZeros(p.predict())).toBe(true);
  });

  it('modelId is 0x02', () => {
    const p = new LinearPredictor();
    expect(p.modelId).toBe(0x02);
  });
});

describe('LinearPredictor — convergence on constant stream', () => {
  it('residuals are all zeros from the third observation onward (constant value)', () => {
    const p = new LinearPredictor();
    const value = makePayload(0xAB);

    // Feed 10 constant values, check residuals from index 2 onward
    for (let i = 0; i < 10; i++) {
      const pred = p.predict();
      if (i >= 2) {
        const residual = computeResidual(value, pred);
        expect(allZeros(residual)).toBe(true);
      }
      p.update(value);
    }
  });
});

describe('LinearPredictor — convergence on linear ramp', () => {
  it('residuals are all zeros from the third observation onward (linear ramp)', () => {
    const p = new LinearPredictor();
    const step = 3;

    // Feed 10 ramp payloads: each byte increments by `step` from the previous
    for (let i = 0; i < 10; i++) {
      const actual = makePayload((i * step) & 0xff);
      const pred = p.predict();
      if (i >= 2) {
        const residual = computeResidual(actual, pred);
        expect(allZeros(residual)).toBe(true);
      }
      p.update(actual);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. computeResidual
// ---------------------------------------------------------------------------

describe('computeResidual', () => {
  it('actual XOR predicted — spot check: 0x42 XOR 0x40 = 0x02', () => {
    const actual = makePayload(0x42);
    const predicted = makePayload(0x40);
    const residual = computeResidual(actual, predicted);
    expect(residual.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(residual[i]).toBe(0x02);
    }
  });

  it('identical inputs → all-zero residual', () => {
    const val = makePayload(0x55);
    expect(allZeros(computeResidual(val, val))).toBe(true);
  });

  it('XOR is its own inverse: residual XOR predicted = actual', () => {
    const actual = makePayload(0xDE);
    const predicted = makePayload(0xAD);
    const residual = computeResidual(actual, predicted);
    const recovered = applyResidual(residual, predicted);
    expect(arraysEqual(recovered, actual)).toBe(true);
  });

  it('throws RangeError when sizes differ', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(15);
    expect(() => computeResidual(a, b)).toThrow(RangeError);
  });

  it('throws RangeError when sizes are not 16', () => {
    const a = new Uint8Array(8);
    const b = new Uint8Array(8);
    expect(() => computeResidual(a, b)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 5. applyResidual
// ---------------------------------------------------------------------------

describe('applyResidual', () => {
  it('apply(compute(actual, pred), pred) === actual (round-trip)', () => {
    const actual = new Uint8Array(16);
    for (let i = 0; i < 16; i++) actual[i] = (i * 17 + 33) & 0xff;

    const predicted = new Uint8Array(16);
    for (let i = 0; i < 16; i++) predicted[i] = (i * 7 + 11) & 0xff;

    const residual = computeResidual(actual, predicted);
    const recovered = applyResidual(residual, predicted);
    expect(arraysEqual(recovered, actual)).toBe(true);
  });

  it('throws RangeError when sizes differ', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(8);
    expect(() => applyResidual(a, b)).toThrow(RangeError);
  });

  it('throws RangeError when sizes are not 16', () => {
    const a = new Uint8Array(10);
    const b = new Uint8Array(10);
    expect(() => applyResidual(a, b)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 6. modelId values
// ---------------------------------------------------------------------------

describe('modelId constants', () => {
  it('NullPredictor modelId = 0x00', () => {
    expect(new NullPredictor().modelId).toBe(0x00);
  });

  it('LastValuePredictor modelId = 0x01', () => {
    expect(new LastValuePredictor().modelId).toBe(0x01);
  });

  it('LinearPredictor modelId = 0x02', () => {
    expect(new LinearPredictor().modelId).toBe(0x02);
  });
});
