# @dot-protocol/arena

Elo engine + blind prediction evaluation for DOT Protocol.

[![npm](https://img.shields.io/npm/v/@dot-protocol/arena)](https://www.npmjs.com/package/@dot-protocol/arena)

## Install

```bash
npm install @dot-protocol/arena
```

## Quick start

```js
import { resolveSession, rankLeaderboard } from '@dot-protocol/arena';

// Resolve predictions against oracle outcome
const { matches, ratings } = await resolveSession(session, resolutionDOT);

// Rank by Elo
const board = rankLeaderboard('prediction', entries);
```

## How blind evaluation works

1. **Predictors submit** DOTs with sealed answers (commitment scheme)
2. **Hash is published** before the oracle resolves — no retroactive changes
3. **Oracle resolves** by emitting a resolution DOT
4. **Session resolves** — correct predictions win Elo, incorrect ones lose it
5. **Chain proves** the sequence — oracle cannot have seen predictions before resolving

```js
import { hashPredictionDOT, resolveSession, verifyPrediction } from '@dot-protocol/arena';

// --- Predictor ---
const predDOT    = await createDOT({ keypair, payload: myAnswer });
const commitment = hashPredictionDOT(predDOT); // publish this hash

// --- Oracle ---
const resDOT = await createDOT({ keypair: oracleKeypair, payload: trueOutcome });

// --- Resolution ---
const session = { predictions: [predDOT], commitments: [commitment], domain: 'crypto' };
const { matches, ratings } = await resolveSession(session, resDOT);
```

## API

### `resolveSession(session, resolutionDOT)`

Evaluate all predictions in a session against the oracle's resolution.

```js
const { matches, ratings } = await resolveSession({
  predictions:  predictionDOTs,     // DOT[] — sealed predictions
  commitments:  commitmentHashes,   // Uint8Array[] — published hashes
  domain:       'crypto',           // string — Elo domain
  initialRatings: new Map(),        // optional — Map<pubkey, number>
}, resolutionDOT);

// matches: [{ predictor: Uint8Array, correct: boolean, eloDelta: number }]
// ratings: Map<pubkeyHex, number> — updated Elo ratings
```

### `verifyPrediction(predictionDOT, commitment)`

Verify that a prediction DOT matches its published commitment.

```js
const ok = verifyPrediction(predictionDOT, commitment); // boolean
```

### `hashPredictionDOT(dot)`

Compute the commitment hash for a prediction DOT.

```js
const hash = hashPredictionDOT(dot); // Uint8Array(32)
```

### `rankLeaderboard(domain, entries)`

Sort leaderboard entries by Elo descending.

```js
const board = rankLeaderboard('crypto', [
  { pubkey: aliceKey, elo: 1650 },
  { pubkey: bobKey,   elo: 1720 },
]);
// [{ pubkey: bobKey, elo: 1720, rank: 1 }, ...]
```

### Elo utilities

```js
import { updateElo, computeEloFromMatches, computeEloPercentile } from '@dot-protocol/arena';

// Single match
const { newRating, delta } = updateElo({
  rating:         1500,
  opponentRating: 1600,
  outcome:        'win',   // 'win' | 'draw' | 'loss'
  K:              32,
});

// Bulk from history
const rating = computeEloFromMatches(ELO_DEFAULT, matchHistory);

// Where does this rating fall?
const pct = computeEloPercentile(1720, allRatings); // 0.87 = top 13%
```

## License

MIT
