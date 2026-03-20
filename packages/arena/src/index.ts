/**
 * @dot-protocol/arena — v0.3.0
 *
 * Elo engine, blind evaluation, prediction resolution.
 * DOT spreads like life, not like messages.
 *
 * "DOT is a noun-verb. A state that records its own transition."
 */

// Elo engine
export {
  updateElo,
  applyEloUpdates,
  computeEloFromMatches,
  computeEloPercentile,
  rankLeaderboard,
  ELO_DEFAULT,
} from './elo.js';
export type { EloUpdate } from './elo.js';

// Resolution protocol
export {
  verifyResolution,
  verifyPrediction,
  resolveSession,
  hashPredictionDOT,
} from './resolution.js';

// Types
export type {
  PredictionDOT,
  ResolutionDOT,
  ArenaMatch,
  BlindEvalSession,
  LeaderboardEntry,
} from './types.js';
