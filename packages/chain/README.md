# @dot-protocol/chain

Append-only worldlines + Four-Score reputation system for DOT Protocol.

[![npm](https://img.shields.io/npm/v/@dot-protocol/chain)](https://www.npmjs.com/package/@dot-protocol/chain)

## Install

```bash
npm install @dot-protocol/chain
```

## Quick start

```js
import { buildScores, computeTier, updateElo } from '@dot-protocol/chain';

// Build reputation scores from a worldline
const scores = buildScores({
  chainLength:        500,
  branchedChainCount: 25,
});

computeTier(scores); // 'contributor'

// Update Elo after a prediction
const { newRating, delta } = updateElo({
  rating:         1500,
  opponentRating: 1600,
  outcome:        'win',
});
```

## Four-Score System

Protocol-native reputation — no platform assigns it. Four dimensions, each derived from the chain itself:

| Score | What it measures | Range |
|-------|-----------------|-------|
| `depth` | Chain length — how long you've been here | 0–1 |
| `width` | How many others carry your DOTs | 0–1 |
| `elo` | Per-domain prediction accuracy | ~0–3000 |
| `W` | Compression ratio — signal density | 0–1 |

### Tiers

| Tier | Depth | Width | Elo |
|------|-------|-------|-----|
| `observer` | any | any | any |
| `contributor` | ≥ 0.1 | ≥ 0.1 | ≥ 1500 |
| `architect` | ≥ 0.3 | ≥ 0.3 | ≥ 1700 |
| `luminary` | ≥ 0.7 | ≥ 0.5 | ≥ 2000 |

## API

### `buildScores(options)`

Compute all four scores from chain statistics:

```js
const scores = buildScores({
  chainLength:          500,    // number of DOTs in worldline
  branchedChainCount:   25,     // how many other chains reference yours
  eloHistory:           [],     // optional — prior Elo match history
  compressedSizeBytes:  12000,  // optional — for W score
  rawSizeBytes:         76500,  // optional — 500 × 153
});
// { depth: number, width: number, elo: number, W: number }
```

### `computeTier(scores)`

```js
computeTier({ depth: 0.5, width: 0.4, elo: 1800, W: 0.6 });
// 'architect'
```

### `updateElo(options)`

```js
const { newRating, delta } = updateElo({
  rating:         1500,   // current rating
  opponentRating: 1600,   // opponent's rating
  outcome:        'win',  // 'win' | 'draw' | 'loss'
  K:              32,     // optional — default 32
});
```

### `applyEloUpdates(ratings, matches)`

Batch Elo update from multiple matches:

```js
const initial  = new Map([['alice', 1500], ['bob', 1520]]);
const matches  = [
  { winnerId: 'alice', loserId: 'bob', outcome: 'win' },
];

const updated = applyEloUpdates(initial, matches);
// Map { alice → 1516, bob → 1504 }
```

### `computeW(compressedBytes, rawBytes)`

```js
const W = computeW(12000, 76500); // 0–1 ratio (higher = denser signal)
```

### `applyWidthDecay(widthScore, monthsElapsed)`

Width score decays if nobody new carries your DOTs:

```js
const decayed = applyWidthDecay(0.8, 12); // after 1 year
```

## License

MIT
