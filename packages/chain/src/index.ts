export { createChain, appendDOT, getHead, getRange, verifyChain } from './chain.js';
export { MemoryStorage } from './storage.js';
export type { Chain, ChainVerifyResult } from './chain.js';
export type { IChainStorage } from './storage.js';

// v0.3.0 — Four-Score System (depth, width, Elo, W) + tiers
export {
  updateElo,
  applyEloUpdates,
  computeW,
  estimatePayloadEntropy,
  computeDepth,
  computeWidth,
  applyWidthDecay,
  computeTier,
  buildScores,
  TIER_THRESHOLDS,
  ELO_DEFAULT,
  ELO_K,
  WIDTH_DECAY_MONTHLY,
} from './scoring.js';
export type { DOTScores, Tier, TierResult, EloUpdate } from './scoring.js';
