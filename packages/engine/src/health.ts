/**
 * DOT Engine — Self-Awareness Types
 *
 * HealthReport gives the engine a window into its own state.
 * Computed from WatchdogState + live engine data on every health() call.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'critical';

export interface RelayHealth {
  connected: boolean;
  latencyMs: number;       // last ping roundtrip, -1 if disconnected
  reconnectAttempts: number;
  bufferedDots: number;    // DOTs waiting to send
}

export interface ChainHealth {
  length: number;
  valid: boolean;          // last integrity check passed
  lastSealAt: number;      // chain position of last seal, -1 if never
  sealAgeDots: number;     // how many DOTs since last seal
}

export interface PredictorHealth {
  accuracy: number;        // 0.0–1.0
  trend: 'improving' | 'stable' | 'degrading';  // based on last 10 DOTs
  resets: number;          // times predictor was auto-reset
}

export interface IdentityHealth {
  exists: boolean;
  persisted: boolean;      // saved to storage
  recoveries: number;      // times identity was re-derived
}

export interface CompressionHealth {
  ratio: number;           // current compression ratio
  trend: 'improving' | 'stable' | 'degrading';
}

export interface HealthReport {
  status: HealthStatus;
  relay: RelayHealth;
  chain: ChainHealth;
  predictor: PredictorHealth;
  identity: IdentityHealth;
  compression: CompressionHealth;
  uptimeMs: number;
  issues: string[];        // human-readable problems e.g. "Relay disconnected 3 times"
  healingActions: string[]; // what the watchdog did e.g. "Predictor reset after accuracy drop"
}

// ---------------------------------------------------------------------------
// Compute HealthStatus from a report's relay, chain, and predictor state
// ---------------------------------------------------------------------------

/**
 * Derive overall HealthStatus from report fields.
 *
 * critical: chain invalid AND relay disconnected
 * degraded: relay disconnected OR predictor accuracy below threshold OR chain invalid
 * healthy:  everything nominal
 */
export function computeStatus(
  relayConnected: boolean,
  chainValid: boolean,
  predictorAccuracy: number,
  predictorThreshold: number,
): HealthStatus {
  const relayDown = !relayConnected;
  const chainBad  = !chainValid;
  const predLow   = predictorAccuracy < predictorThreshold;

  if (chainBad && relayDown) return 'critical';
  if (chainBad || relayDown || predLow) return 'degraded';
  return 'healthy';
}

/**
 * Compute trend from an array of readings.
 * Compares average of first half vs average of second half.
 * Stable if difference < 0.05.
 */
export function computeTrend(
  history: number[],
): 'improving' | 'stable' | 'degrading' {
  if (history.length < 2) return 'stable';

  const mid = Math.floor(history.length / 2);
  const first = history.slice(0, mid);
  const last  = history.slice(mid);

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const diff = avg(last) - avg(first);

  if (Math.abs(diff) < 0.05) return 'stable';
  return diff > 0 ? 'improving' : 'degrading';
}
