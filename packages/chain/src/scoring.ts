/**
 * DOT Protocol v0.3.0 — Four-Score System
 *
 * Protocol-native scoring computed from DOT chains.
 * No platform assigns scores. The protocol computes them.
 *
 * Four scores:
 *   depth  — chain length (persistence)
 *   width  — count of chains that branched from this chain via TEACH
 *   elo    — domain-specific Elo ratings
 *   w      — compression ratio (bits of meaning per byte)
 */

export interface DOTScores {
  depth: number;                  // chain length — persistence score
  width: number;                  // TEACH-branched chains count
  elo: Map<string, number>;       // domain → Elo rating
  w: number;                      // compression ratio (bits of meaning / byte)
}

export type Tier = 'observer' | 'contributor' | 'architect' | 'luminary';

export interface TierResult {
  tier: Tier;
  scores: DOTScores;
}

// Tier thresholds (configurable via protocol amendment)
export const TIER_THRESHOLDS = {
  observer:    { maxDepth: 100 },
  contributor: { minDepth: 100, minWidth: 10 },
  architect:   { minEloPercentile: 0.90, minDomains: 1 },
  luminary:    { minEloPercentile: 0.90, minDomains: 3, minWidth: 1000, minW: 20.0 },
} as const;

export const ELO_DEFAULT = 1500;
export const ELO_K = 32;

// ── Elo ───────────────────────────────────────────────────────────────────────

export interface EloUpdate {
  domain: string;
  correct: boolean;
  opponentElo?: number;   // if head-to-head, opponent's rating
}

/**
 * Update Elo rating for a single outcome.
 * Standard Elo formula with K=32.
 */
export function updateElo(current: number, update: EloUpdate): number {
  const opponent = update.opponentElo ?? ELO_DEFAULT;
  const expected = 1 / (1 + Math.pow(10, (opponent - current) / 400));
  const actual = update.correct ? 1 : 0;
  return current + ELO_K * (actual - expected);
}

/**
 * Apply a batch of Elo updates to a scores map.
 * Returns updated Map (new instance, does not mutate).
 */
export function applyEloUpdates(
  eloMap: Map<string, number>,
  updates: EloUpdate[]
): Map<string, number> {
  const next = new Map(eloMap);
  for (const u of updates) {
    const current = next.get(u.domain) ?? ELO_DEFAULT;
    next.set(u.domain, updateElo(current, u));
  }
  return next;
}

// ── W Score (compression ratio) ───────────────────────────────────────────────

/**
 * Compute W (bits of meaning per byte) from a chain.
 *
 * W = (unique payload bytes × 8) / (chain length × 153)
 *
 * A chain of PINGs has W ≈ 0 (no payload information).
 * A chain where every payload points to distinct content has W ≈ 1.
 * W > 1 indicates compression (payload as hash pointer to larger content).
 */
export function computeW(payloadEntropy: number, chainLength: number): number {
  if (chainLength === 0) return 0;
  const totalBytes = chainLength * 153;
  return (payloadEntropy * 8) / totalBytes;
}

/**
 * Estimate payload entropy from raw payloads.
 * Uses Shannon entropy on the byte distribution across all payloads.
 */
export function estimatePayloadEntropy(payloads: Uint8Array[]): number {
  if (payloads.length === 0) return 0;

  const freq = new Map<number, number>();
  let total = 0;

  for (const p of payloads) {
    for (const b of p) {
      freq.set(b, (freq.get(b) ?? 0) + 1);
      total++;
    }
  }

  if (total === 0) return 0;

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }

  // Return total bits of information
  return entropy * total;
}

// ── Depth & Width ──────────────────────────────────────────────────────────────

/**
 * Compute depth score from an ordered list of DOTs.
 * Depth = number of DOTs in the chain (genesis counts as 1).
 */
export function computeDepth(chainLength: number): number {
  return chainLength;
}

/**
 * Compute width score from a set of child chain genesis hashes.
 * Width = count of chains that branched from this chain's DOTs via TEACH.
 */
export function computeWidth(branchedChainCount: number): number {
  return branchedChainCount;
}

// ── Decay ──────────────────────────────────────────────────────────────────────

/** Monthly decay factor for width contribution weight */
export const WIDTH_DECAY_MONTHLY = 0.10;

/**
 * Apply monthly decay to width contribution weight.
 * Depth never decays (it's historical).
 * Width decays 10% per month.
 */
export function applyWidthDecay(weight: number, monthsElapsed: number): number {
  return weight * Math.pow(1 - WIDTH_DECAY_MONTHLY, monthsElapsed);
}

// ── Tier Computation ───────────────────────────────────────────────────────────

/**
 * Compute tier from DOT scores.
 * Tiers are mutually exclusive and evaluated from highest to lowest.
 */
export function computeTier(scores: DOTScores, eloPercentile?: number): Tier {
  const { depth, width, w } = scores;
  const domains = scores.elo.size;
  const percentile = eloPercentile ?? 0;

  // Luminary: top Elo percentile in 3+ domains, 1000+ TEACH branches, W >= 20
  if (
    percentile >= TIER_THRESHOLDS.luminary.minEloPercentile &&
    domains >= TIER_THRESHOLDS.luminary.minDomains &&
    width >= TIER_THRESHOLDS.luminary.minWidth &&
    w >= TIER_THRESHOLDS.luminary.minW
  ) {
    return 'luminary';
  }

  // Architect: top Elo percentile in 1+ domain
  if (
    percentile >= TIER_THRESHOLDS.architect.minEloPercentile &&
    domains >= TIER_THRESHOLDS.architect.minDomains
  ) {
    return 'architect';
  }

  // Contributor: depth >= 100, width >= 10
  if (
    depth >= TIER_THRESHOLDS.contributor.minDepth &&
    width >= TIER_THRESHOLDS.contributor.minWidth
  ) {
    return 'contributor';
  }

  return 'observer';
}

// ── Composite ──────────────────────────────────────────────────────────────────

/**
 * Build a fresh DOTScores object from raw chain data.
 */
export function buildScores(params: {
  chainLength: number;
  branchedChainCount: number;
  eloMap?: Map<string, number>;
  payloads?: Uint8Array[];
}): DOTScores {
  const { chainLength, branchedChainCount, eloMap, payloads } = params;

  const depth = computeDepth(chainLength);
  const width = computeWidth(branchedChainCount);
  const elo = eloMap ?? new Map<string, number>();
  const entropy = payloads ? estimatePayloadEntropy(payloads) : 0;
  const w = computeW(entropy, chainLength);

  return { depth, width, elo, w };
}
