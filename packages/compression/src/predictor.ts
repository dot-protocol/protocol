/**
 * Payload predictors for DOT stream compression.
 *
 * Predictive coding works by predicting the next payload value based on history,
 * then storing only the residual (actual XOR predicted). When the predictor is
 * accurate, residuals are near-zero → compress extremely well.
 *
 * Three models are provided, each suited to different data patterns:
 *   - NullPredictor (0x00): Always predicts zeros. Baseline — no savings, never hurts.
 *   - LastValuePredictor (0x01): Predicts the previous actual. Good for slowly-changing data.
 *   - LinearPredictor (0x02): Extrapolates linear trend. Good for steadily-changing data.
 *
 * All payloads are exactly 16 bytes (the DOT payload width).
 */

const PAYLOAD_SIZE = 16;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Prediction model interface. All models implement this.
 * The model predicts the next payload value based on history.
 * Compression sends only the residual (actual - predicted via XOR).
 */
export interface PayloadPredictor {
  /** Returns predicted next payload (16 bytes). */
  predict(): Uint8Array;

  /** Feed actual observed payload to update model state. */
  update(actual: Uint8Array): void;

  /** Reset model state. */
  reset(): void;

  /** Model identifier byte for batch header. */
  readonly modelId: number;
}

// ---------------------------------------------------------------------------
// NullPredictor (modelId: 0x00)
// ---------------------------------------------------------------------------

/**
 * Always predicts all-zeros.
 *
 * Residual = actual XOR zeros = actual (no compression savings, but provably safe baseline).
 * Useful as a passthrough when no prediction is possible or practical.
 */
export class NullPredictor implements PayloadPredictor {
  readonly modelId = 0x00;

  predict(): Uint8Array {
    return new Uint8Array(PAYLOAD_SIZE);
  }

  update(_actual: Uint8Array): void {
    // Stateless: no update needed.
  }

  reset(): void {
    // No state to reset.
  }
}

// ---------------------------------------------------------------------------
// LastValuePredictor (modelId: 0x01)
// ---------------------------------------------------------------------------

/**
 * Predicts that the next payload equals the previous actual payload.
 *
 * Ideal when payloads change slowly or repeat (e.g., heartbeat PINGs, sensor
 * readings that hold steady). On a constant stream, residuals are all-zero
 * from the second observation onward.
 *
 * State: previous payload (16 bytes).
 */
export class LastValuePredictor implements PayloadPredictor {
  readonly modelId = 0x01;

  private _prev: Uint8Array = new Uint8Array(PAYLOAD_SIZE);

  predict(): Uint8Array {
    return new Uint8Array(this._prev); // Return a copy — caller must not mutate.
  }

  update(actual: Uint8Array): void {
    this._prev = new Uint8Array(actual);
  }

  reset(): void {
    this._prev = new Uint8Array(PAYLOAD_SIZE);
  }
}

// ---------------------------------------------------------------------------
// LinearPredictor (modelId: 0x02)
// ---------------------------------------------------------------------------

/**
 * Extrapolates the linear trend between the last two observations.
 *
 * Prediction formula (byte-level, wrapping uint8 arithmetic):
 *   predicted[i] = (2 * current[i] - previous[i]) & 0xFF
 *
 * This is equivalent to "the slope between the last two points continues."
 * On a linearly-changing or constant stream, residuals are zero after the
 * first two observations. Excellent for telemetry, counter chains, or any
 * data with a steady rate of change.
 *
 * Fallback behaviour:
 *   - No history (0 updates seen): predict zeros.
 *   - One update seen: predict = that one value (no trend yet).
 *   - Two+ updates seen: full linear extrapolation.
 *
 * State: previous two payloads (32 bytes).
 */
export class LinearPredictor implements PayloadPredictor {
  readonly modelId = 0x02;

  private _count = 0;
  private _prev: Uint8Array = new Uint8Array(PAYLOAD_SIZE); // t-1
  private _curr: Uint8Array = new Uint8Array(PAYLOAD_SIZE); // t-0

  predict(): Uint8Array {
    const out = new Uint8Array(PAYLOAD_SIZE);

    if (this._count === 0) {
      // No history: all zeros.
      return out;
    }

    if (this._count === 1) {
      // One observation: repeat it.
      return new Uint8Array(this._curr);
    }

    // Full linear extrapolation: next = 2 * curr - prev (byte-wrapping).
    for (let i = 0; i < PAYLOAD_SIZE; i++) {
      out[i] = ((2 * this._curr[i]!) - this._prev[i]!) & 0xff;
    }
    return out;
  }

  update(actual: Uint8Array): void {
    this._prev = new Uint8Array(this._curr);
    this._curr = new Uint8Array(actual);
    this._count++;
  }

  reset(): void {
    this._count = 0;
    this._prev = new Uint8Array(PAYLOAD_SIZE);
    this._curr = new Uint8Array(PAYLOAD_SIZE);
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Compute XOR residual between actual and predicted payloads.
 *
 * residual[i] = actual[i] XOR predicted[i]
 *
 * When actual[i] === predicted[i], residual[i] = 0. The more correlated the
 * data with the predictor's model, the more zeros appear — and zeros compress
 * to near nothing under any entropy coder or zstd.
 *
 * @param actual - Observed 16-byte payload.
 * @param predicted - Predictor's 16-byte estimate.
 * @returns 16-byte residual.
 * @throws RangeError if either array is not exactly 16 bytes, or they differ.
 */
export function computeResidual(actual: Uint8Array, predicted: Uint8Array): Uint8Array {
  if (actual.length !== PAYLOAD_SIZE || predicted.length !== PAYLOAD_SIZE) {
    throw new RangeError(
      `computeResidual: both arrays must be exactly ${PAYLOAD_SIZE} bytes ` +
        `(got ${actual.length} and ${predicted.length})`,
    );
  }
  const residual = new Uint8Array(PAYLOAD_SIZE);
  for (let i = 0; i < PAYLOAD_SIZE; i++) {
    residual[i] = actual[i]! ^ predicted[i]!;
  }
  return residual;
}

/**
 * Reconstruct actual payload from residual and predicted.
 *
 * actual[i] = residual[i] XOR predicted[i]
 *
 * This is the exact inverse of computeResidual. XOR is its own inverse:
 * apply(compute(actual, pred), pred) === actual.
 *
 * @param residual - 16-byte residual from computeResidual.
 * @param predicted - The same 16-byte predicted value used at encode time.
 * @returns Reconstructed 16-byte actual payload.
 * @throws RangeError if either array is not exactly 16 bytes, or they differ.
 */
export function applyResidual(residual: Uint8Array, predicted: Uint8Array): Uint8Array {
  if (residual.length !== PAYLOAD_SIZE || predicted.length !== PAYLOAD_SIZE) {
    throw new RangeError(
      `applyResidual: both arrays must be exactly ${PAYLOAD_SIZE} bytes ` +
        `(got ${residual.length} and ${predicted.length})`,
    );
  }
  const actual = new Uint8Array(PAYLOAD_SIZE);
  for (let i = 0; i < PAYLOAD_SIZE; i++) {
    actual[i] = residual[i]! ^ predicted[i]!;
  }
  return actual;
}
