import { describe, it, expect } from 'vitest';
import {
  updateElo,
  applyEloUpdates,
  computeEloFromMatches,
  computeEloPercentile,
  rankLeaderboard,
  ELO_DEFAULT,
} from '../elo.js';
import type { ArenaMatch } from '../types.js';
import { createKeypair, createDOT } from '@dot-protocol/core';

async function makeMockMatch(domain: string, correct: boolean): Promise<ArenaMatch> {
  const kp = await createKeypair();
  const dot = await createDOT({ keypair: kp });
  const resDot = await createDOT({ keypair: kp });
  return {
    prediction: { dot, domain, claim: 'test claim', expiresAt: Date.now() + 1000 },
    resolution: { dot: resDot, predictionRef: new Uint8Array(32), outcome: correct },
    correct,
    pointsAwarded: correct ? 1 : 0,
  };
}

describe('updateElo', () => {
  it('correct prediction increases rating', () => {
    const after = updateElo(ELO_DEFAULT, { domain: 'd', correct: true });
    expect(after).toBeGreaterThan(ELO_DEFAULT);
  });

  it('incorrect prediction decreases rating', () => {
    const after = updateElo(ELO_DEFAULT, { domain: 'd', correct: false });
    expect(after).toBeLessThan(ELO_DEFAULT);
  });
});

describe('computeEloFromMatches', () => {
  it('applies matches to elo map', async () => {
    const matches = [
      await makeMockMatch('prediction', true),
      await makeMockMatch('prediction', true),
    ];
    const initial = new Map<string, number>();
    const result = computeEloFromMatches(initial, matches);
    expect(result.get('prediction')).toBeGreaterThan(ELO_DEFAULT);
  });

  it('handles multiple domains independently', async () => {
    const matches = [
      await makeMockMatch('prediction', true),
      await makeMockMatch('teaching', false),
    ];
    const result = computeEloFromMatches(new Map(), matches);
    expect(result.get('prediction')).toBeGreaterThan(ELO_DEFAULT);
    expect(result.get('teaching')).toBeLessThan(ELO_DEFAULT);
  });
});

describe('computeEloPercentile', () => {
  it('returns 0.5 for empty population', () => {
    expect(computeEloPercentile(1500, [])).toBe(0.5);
  });

  it('top rating gets percentile near 1.0', () => {
    const pop = [1200, 1300, 1400, 1500, 1600];
    expect(computeEloPercentile(1700, pop)).toBe(1.0);
  });

  it('bottom rating gets percentile 0', () => {
    const pop = [1300, 1400, 1500];
    expect(computeEloPercentile(1200, pop)).toBe(0);
  });
});

describe('rankLeaderboard', () => {
  it('sorts by Elo descending and assigns ranks', () => {
    const entries = [
      { pubkey: 'a', elo: 1600, totalPredictions: 10, correctPredictions: 8 },
      { pubkey: 'b', elo: 1700, totalPredictions: 5, correctPredictions: 5 },
      { pubkey: 'c', elo: 1400, totalPredictions: 20, correctPredictions: 10 },
    ];
    const board = rankLeaderboard('prediction', entries);
    expect(board[0].pubkey).toBe('b');
    expect(board[0].rank).toBe(1);
    expect(board[1].pubkey).toBe('a');
    expect(board[2].pubkey).toBe('c');
    expect(board[2].rank).toBe(3);
  });

  it('computes accuracy correctly', () => {
    const entries = [
      { pubkey: 'x', elo: 1500, totalPredictions: 10, correctPredictions: 7 },
    ];
    const board = rankLeaderboard('d', entries);
    expect(board[0].accuracy).toBeCloseTo(0.7, 5);
  });

  it('accuracy = 0 when totalPredictions = 0', () => {
    const entries = [
      { pubkey: 'x', elo: 1500, totalPredictions: 0, correctPredictions: 0 },
    ];
    const board = rankLeaderboard('d', entries);
    expect(board[0].accuracy).toBe(0);
  });
});
