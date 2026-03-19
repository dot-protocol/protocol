/**
 * DOT Engine — Watchdog
 *
 * The watchdog monitors engine health and heals automatically:
 *   - Predictor accuracy drops → reset predictor
 *   - Relay disconnects → schedule reconnect with exponential backoff
 *   - Chain goes too long without a seal → request seal
 *
 * The engine creates one watchdog on boot and wires callbacks into it.
 * Healing actions are recorded and surfaced in HealthReport.healingActions.
 */

import { computeTrend } from './health.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WatchdogConfig {
  /** Max reconnect wait in ms. Default 60000. */
  relayReconnectMaxMs: number;
  /** Reset predictor if accuracy drops below this. Default 0.3. */
  predictorAccuracyThreshold: number;
  /** Number of DOTs to use for trend window. Default 10. */
  predictorDriftWindow: number;
  /** Auto-seal if sealAgeDots exceeds this. Default 100. */
  sealEveryDots: number;
  /** Watchdog poll interval in ms. Default 5000. */
  checkIntervalMs: number;
}

const DEFAULTS: WatchdogConfig = {
  relayReconnectMaxMs: 60_000,
  predictorAccuracyThreshold: 0.3,
  predictorDriftWindow: 10,
  sealEveryDots: 100,
  checkIntervalMs: 5_000,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface WatchdogState {
  relayReconnects: number;
  relayBuffered: number;
  chainValid: boolean;
  chainLastGoodLength: number;
  predictorHistory: number[];  // last N accuracy readings
  predictorResets: number;
  identityRecoveries: number;
  healingActions: string[];
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Watchdog interface
// ---------------------------------------------------------------------------

export interface Watchdog {
  start(): void;
  stop(): void;
  getState(): WatchdogState;
  /** Called after each DOT.create() with the current predictor accuracy. */
  recordDot(accuracy: number): void;
  /** Called on relay connect/disconnect. */
  recordRelay(connected: boolean): void;
  /** Called after every chain append. */
  recordChain(valid: boolean, length: number): void;
  /** Called after a seal completes. */
  recordSeal(chainPos: number): void;
  /** Engine sets this: called when predictor needs reset. */
  onPredictorReset: (() => void) | undefined;
  /** Engine sets this: called with chain position to repair from. */
  onChainRepair: ((fromPos: number) => void) | undefined;
  /** Engine sets this: called when relay should attempt reconnect. */
  onRelayShouldReconnect: (() => void) | undefined;
  /** Engine sets this: called when the chain needs a seal. */
  onSealNeeded: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// createWatchdog
// ---------------------------------------------------------------------------

const MAX_HEALING_ACTIONS = 20;

export function createWatchdog(config?: Partial<WatchdogConfig>): Watchdog {
  const cfg: WatchdogConfig = { ...DEFAULTS, ...config };

  const state: WatchdogState = {
    relayReconnects: 0,
    relayBuffered: 0,
    chainValid: true,
    chainLastGoodLength: 0,
    predictorHistory: [],
    predictorResets: 0,
    identityRecoveries: 0,
    healingActions: [],
    startedAt: 0,
  };

  // Internal
  let _running = false;
  let _intervalHandle: ReturnType<typeof setInterval> | null = null;
  let _relayConnected = true;
  let _relayReconnectDelay = 1_000;
  let _relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let _lastSealAt = -1;   // chain position of last seal (-1 = never)
  let _sealAgeDots = 0;   // dots since last seal

  // Healing callbacks (set by engine)
  let _onPredictorReset: (() => void) | undefined;
  let _onChainRepair: ((fromPos: number) => void) | undefined;
  let _onRelayShouldReconnect: (() => void) | undefined;
  let _onSealNeeded: (() => void) | undefined;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function _timestamp(): string {
    return new Date().toISOString();
  }

  function _addHealingAction(msg: string): void {
    state.healingActions.push(`[${_timestamp()}] ${msg}`);
    // Cap at MAX_HEALING_ACTIONS
    if (state.healingActions.length > MAX_HEALING_ACTIONS) {
      state.healingActions.splice(0, state.healingActions.length - MAX_HEALING_ACTIONS);
    }
  }

  // ---------------------------------------------------------------------------
  // Relay reconnect with exponential backoff
  // ---------------------------------------------------------------------------

  function _scheduleRelayReconnect(): void {
    if (_relayReconnectTimer !== null) return; // already scheduled
    if (!_running) return;

    const delay = _relayReconnectDelay;
    _relayReconnectDelay = Math.min(_relayReconnectDelay * 2, cfg.relayReconnectMaxMs);

    _relayReconnectTimer = setTimeout(() => {
      _relayReconnectTimer = null;
      if (!_relayConnected && _running) {
        state.relayReconnects++;
        _addHealingAction('Relay reconnect attempted');
        _onRelayShouldReconnect?.();
      }
    }, delay);
  }

  function _clearRelayReconnect(): void {
    if (_relayReconnectTimer !== null) {
      clearTimeout(_relayReconnectTimer);
      _relayReconnectTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Periodic check
  // ---------------------------------------------------------------------------

  function _check(): void {
    if (!_running) return;

    // Check predictor accuracy trend
    if (state.predictorHistory.length >= cfg.predictorDriftWindow) {
      const recent = state.predictorHistory.slice(-cfg.predictorDriftWindow);
      const latestAccuracy = recent[recent.length - 1] ?? 0;

      // Check absolute threshold
      if (latestAccuracy < cfg.predictorAccuracyThreshold) {
        state.predictorResets++;
        _addHealingAction(`Predictor reset after accuracy drop to ${latestAccuracy.toFixed(3)}`);
        _onPredictorReset?.();
        return;
      }

      // Check 20% relative drop over window
      const first = recent[0] ?? 0;
      if (first - latestAccuracy > 0.2) {
        state.predictorResets++;
        _addHealingAction(`Predictor reset after drift (${first.toFixed(3)} → ${latestAccuracy.toFixed(3)})`);
        _onPredictorReset?.();
        return;
      }
    }

    // Check seal age
    if (cfg.sealEveryDots > 0 && _sealAgeDots > cfg.sealEveryDots) {
      _addHealingAction(`Seal requested at chain age ${_sealAgeDots} dots`);
      _onSealNeeded?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    start() {
      if (_running) return;
      _running = true;
      state.startedAt = Date.now();
      _intervalHandle = setInterval(_check, cfg.checkIntervalMs);
    },

    stop() {
      _running = false;
      if (_intervalHandle !== null) {
        clearInterval(_intervalHandle);
        _intervalHandle = null;
      }
      _clearRelayReconnect();
    },

    getState(): WatchdogState {
      return { ...state, predictorHistory: [...state.predictorHistory] };
    },

    recordDot(accuracy: number): void {
      state.predictorHistory.push(accuracy);
      // Keep only the drift window (plus a little extra for trend)
      const keepN = cfg.predictorDriftWindow * 2;
      if (state.predictorHistory.length > keepN) {
        state.predictorHistory.splice(0, state.predictorHistory.length - keepN);
      }
      _sealAgeDots++;

      // Inline check for seal (instead of waiting for interval)
      if (cfg.sealEveryDots > 0 && _sealAgeDots > cfg.sealEveryDots) {
        _addHealingAction(`Seal requested at chain age ${_sealAgeDots} dots`);
        _onSealNeeded?.();
      }
    },

    recordRelay(connected: boolean): void {
      const wasConnected = _relayConnected;
      _relayConnected = connected;

      if (connected) {
        // Reset backoff on successful connect
        _relayReconnectDelay = 1_000;
        _clearRelayReconnect();
      } else if (wasConnected) {
        // Just disconnected — schedule reconnect
        _scheduleRelayReconnect();
      }
    },

    recordChain(valid: boolean, length: number): void {
      state.chainValid = valid;
      if (valid) {
        state.chainLastGoodLength = length;
      } else {
        _addHealingAction(`Chain integrity check failed at length ${length}`);
        _onChainRepair?.(state.chainLastGoodLength);
      }
    },

    recordSeal(chainPos: number): void {
      _lastSealAt = chainPos;
      _sealAgeDots = 0;
    },

    get onPredictorReset(): (() => void) | undefined { return _onPredictorReset; },
    set onPredictorReset(cb: (() => void) | undefined) { _onPredictorReset = cb; },

    get onChainRepair(): ((fromPos: number) => void) | undefined { return _onChainRepair; },
    set onChainRepair(cb: ((fromPos: number) => void) | undefined) { _onChainRepair = cb; },

    get onRelayShouldReconnect(): (() => void) | undefined { return _onRelayShouldReconnect; },
    set onRelayShouldReconnect(cb: (() => void) | undefined) { _onRelayShouldReconnect = cb; },

    get onSealNeeded(): (() => void) | undefined { return _onSealNeeded; },
    set onSealNeeded(cb: (() => void) | undefined) { _onSealNeeded = cb; },
  };
}
