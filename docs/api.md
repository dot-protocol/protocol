# DOT Protocol — API Reference

## `dot-protocol` (engine)

The high-level singleton. **Start here.**

```js
import { DOT } from 'dot-protocol';
```

### `DOT.boot(options?)`

Initializes the engine. Creates or loads identity, starts chain, optionally connects relay.

```js
await DOT.boot();                                  // connects to wss://dotdotdot.rocks
await DOT.boot({ offline: true });                 // no network, for tests
await DOT.boot({ relayUrl: 'wss://my-relay.io' }); // custom relay
await DOT.boot({ sealEvery: 100 });                // auto BLS-seal every 100 DOTs
```

| Option | Type | Default | Description |
|---|---|---|---|
| `relayUrl` | `string` | `'wss://dotdotdot.rocks'` | CHORUS relay URL |
| `offline` | `boolean` | `false` | Skip relay, useful for tests |
| `sealEvery` | `number` | `0` | Auto-seal every N DOTs (0 = manual) |

---

### `DOT.create(datom)`

Creates a signed, chained 153-byte DOT. Physics auto-apply: sign → chain → compress → emit → relay.

```js
const bytes = await DOT.create({});                         // PING — empty DOT
const bytes = await DOT.create({ WHAT: 'hello' });          // text payload
const bytes = await DOT.create({ WHAT: payloadBytes });     // Uint8Array(≤16)
const bytes = await DOT.create({ WHAT: hash, WHO: pubkey }); // directed DOT
```

| Field | Type | Description |
|---|---|---|
| `WHAT` | `string \| Uint8Array` | Payload ≤16 bytes. Strings UTF-8 encoded. Truncated if longer. |
| `WHO` | `Uint8Array` | Recipient public key (32B). Routes DOT to their relay channel. |

Returns `Uint8Array(153)`.

---

### `DOT.on(event, callback)`

Subscribe to engine events.

```js
DOT.on('dot',    (bytes, from) => { /* Uint8Array(153) received */ });
DOT.on('peer',   (peer)        => { /* new peer discovered */ });
DOT.on('ready',  ()            => { /* engine booted */ });
DOT.on('health', (report)      => { /* health status changed */ });
DOT.on('chain',  (chain)       => { /* chain updated */ });
```

---

### `DOT.me`

The current identity. `null` before `boot()`.

```js
const { did, publicKey } = DOT.me;
// did: 'did:dot:base64url...'
// publicKey: Uint8Array(32)
```

---

### `DOT.nearby`

`Map<string, PeerInfo>` of discovered peers keyed by DID.

```js
for (const [did, peer] of DOT.nearby) {
  console.log(did, peer.lastSeen, peer.connectedVia); // 'relay' | 'ble' | 'qr'
}
```

---

### `DOT.seal(n?)`

BLS12-381 aggregate seal. Signs the last `n` DOTs (or all) with a single 48-byte aggregate signature.

```js
const sealBytes = await DOT.seal();      // seal all
const sealBytes = await DOT.seal(100);   // seal last 100
```

Returns `Uint8Array(48)`.

---

### `DOT.verifySeal(sealBytes, n?)`

Verify a BLS seal produced by `seal()`.

```js
const valid = await DOT.verifySeal(sealBytes);     // true | false
```

---

### `DOT.decryptDot(dotBytes, senderPublicKey, chainPos?)`

Decrypt a PRIVATE DOT's payload using ECDH with the sender's public key.

```js
const plaintext = DOT.decryptDot(bytes, senderKey); // Uint8Array(16) | null
```

---

### `DOT.stats()`

Current engine statistics.

```js
const s = DOT.stats();
// s.totalDots, s.totalRawBytes, s.totalChains
// s.relayConnected, s.peersOnline, s.sealCount
// s.predictorAccuracy, s.compressionRatio
```

---

### `DOT.health()`

Self-awareness report.

```js
const h = DOT.health();
// h.status: 'healthy' | 'degraded' | 'critical'
// h.relay.connected, h.relay.latencyMs
// h.chain.length, h.chain.valid, h.chain.lastSealAt
// h.predictor.accuracy, h.predictor.trend
// h.issues: string[]  ← what's wrong
```

---

### `DOT.shutdown()`

Disconnect relay, reset all state. Safe to `boot()` again.

```js
await DOT.shutdown();
```

---

## `@dot-protocol/core`

Raw cryptographic primitives. Zero dependencies.

```js
import { createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes } from '@dot-protocol/core';
```

---

### `createKeypair(seed?)`

Generate an Ed25519 keypair.

```js
const kp = await createKeypair();            // random
const kp = await createKeypair(seed32);      // deterministic from Uint8Array(32)

// kp.publicKey  Uint8Array(32)
// kp.privateKey Uint8Array(32)
```

---

### `createDOT(input)`

Create and sign a DOT.

```js
const dot = await createDOT({ keypair });

const dot = await createDOT({
  keypair,
  payload: 'hello',           // string (UTF-8) or Uint8Array(≤16)
  type: DotType.PRIVATE,      // visibility
  previous: prevDot,          // for chaining — accepts DOT object or Uint8Array(153)
  ts: Date.now(),             // override timestamp (ms)
});
```

Returns a `DOT` object:
```ts
{
  pubkey:  Uint8Array(32)   // Ed25519 public key
  sig:     Uint8Array(64)   // Ed25519 signature
  chain:   Uint8Array(32)   // SHA-256 of previous DOT bytes (zeros for genesis)
  ts:      number           // Unix timestamp ms
  type:    DotType          // 0x00–0x03
  payload: Uint8Array(16)   // zero-padded to 16 bytes
}
```

---

### `verifyDOT(dot)`

Verify the Ed25519 signature of a DOT.

```js
const ok = await verifyDOT(dot); // true | false
```

---

### `checkChain(dots)`

Verify an array of DOTs form a valid chain (signatures + chain links).

```js
const result = await checkChain([genesis, dot2, dot3]);
// { valid: true }
// { valid: false, brokenAt: 2, reason: 'chain hash mismatch' }
```

---

### `toBytes(dot)` / `fromBytes(buf)`

Convert between DOT object and raw wire bytes.

```js
const buf = toBytes(dot);        // Uint8Array(153)
const dot = fromBytes(buf);      // DOT object
```

---

### `DotType`

```js
import { DotType } from '@dot-protocol/core';

DotType.PUBLIC    // 0x00
DotType.CIRCLE    // 0x01
DotType.PRIVATE   // 0x02
DotType.EPHEMERAL // 0x03
```

---

### `DOTFace` — v0.3.0

12 alphabet faces + 1 Transformer production rule:

```js
import { DOTFace, composeFaces, hasFace, activeFaces, validateFaceMask } from '@dot-protocol/core';

// Alphabet faces
DOTFace.File          // 0x001 — data at rest
DOTFace.Tunnel        // 0x002 — data in transit
DOTFace.Container     // 0x004 — DOT carrying DOTs
DOTFace.Reader        // 0x008 — data being consumed
DOTFace.Camera        // 0x010 — visual observation
DOTFace.QR            // 0x020 — scannable physical DOT
DOTFace.Writer        // 0x040 — data being produced
DOTFace.Steganography // 0x080 — hidden data in carrier
DOTFace.Microdot      // 0x100 — minimal physical encoding
DOTFace.Compiler      // 0x200 — format conversion
DOTFace.Connector     // 0x400 — bridge between systems
DOTFace.SelfAware     // 0x800 — observing chain health

// Production rule
DOTFace.Transformer   // 0x1000 — state transition operator

// Compose
const mask = composeFaces(DOTFace.QR, DOTFace.Container);
hasFace(mask, DOTFace.QR);        // true
activeFaces(mask);                 // ['QR', 'Container']
validateFaceMask(mask);            // { valid: true }
```

---

### `TransformRegistry` — v0.3.0

Registry of deterministic, verifiable state transforms.

```js
import { TransformRegistry } from '@dot-protocol/core';

// Built-in transforms
TransformRegistry.has('time-capsule');      // true
TransformRegistry.has('signer-approval');   // true
TransformRegistry.has('chain-depth-gate');  // true

const spec = TransformRegistry.get('time-capsule');
spec.verify(inputDOT, outputDOT);  // boolean

// Register custom transform
TransformRegistry.register({
  id: 'my-transform',
  version: 1,
  inputSchema: { description: 'DOT in initial state' },
  outputSchema: { description: 'DOT in transitioned state' },
  verify: (input, output) => input.pubkey.every((b, i) => b === output.pubkey[i]),
  description: 'Same-signer state change',
});

// Serialize condition for inclusion in DOT hash
import { serializeTransformCondition, deserializeTransformCondition } from '@dot-protocol/core';

const cond = {
  transformId: 'time-capsule',
  triggerCondition: { type: 'timestamp', value: 9999999999000, verifier: 'chain-clock' },
  stateChange: { from: { accessLevel: 0 }, to: { accessLevel: 2 } },
};
const bytes = serializeTransformCondition(cond);
const back  = deserializeTransformCondition(bytes);
```

---

### TEACH byte royalty — v0.3.0

```js
import { computeRoyalty, validateTEACHConfig, DEFAULT_TEACH_CONFIG } from '@dot-protocol/core';

// DEFAULT: 1% royalty, 3 generations deep, x402 payment
DEFAULT_TEACH_CONFIG; // { byte: 0x01, royaltyBps: 100, propagationDepth: 3, paymentMethod: 'x402' }

const royalty = computeRoyalty(config, depth=1, baseValue=10000);
// Linear decay: full at depth 1, zero beyond propagationDepth

validateTEACHConfig(config); // { valid: true } | { valid: false, reason: '...' }
```

---

## `@dot-protocol/chain`

Append-only worldlines with pluggable storage.

```js
import { createChain, appendDOT, getHead, verifyChain } from '@dot-protocol/chain';
```

### Chain operations

```js
const chain = await createChain(genesisDOT);      // creates chain with genesis
await appendDOT(chain, nextDOT);                   // validates + appends (throws if broken)
const head = await getHead(chain);                 // most recent DOT
const result = await verifyChain(chain);           // { valid, length, head, errors }
const range = await getRange(chain, 0, 10);        // first 10 DOTs
```

### Four-score system — v0.3.0

```js
import {
  buildScores, computeTier, computeEloPercentile,
  updateElo, applyEloUpdates, applyWidthDecay,
  ELO_DEFAULT, TIER_THRESHOLDS
} from '@dot-protocol/chain';

// Build scores from raw chain data
const scores = buildScores({
  chainLength: 500,
  branchedChainCount: 30,
  eloMap: new Map([['prediction', 1700], ['teaching', 1550]]),
  payloads: [...], // optional Uint8Array[] for W computation
});

// scores.depth  — chain length
// scores.width  — TEACH branches
// scores.elo    — Map<domain, rating>
// scores.w      — bits of meaning per byte

// Tier
computeTier(scores);                   // 'observer'
computeTier(scores, 0.92);             // 'architect' if percentile ≥ 90th

// Elo update
const newRating = updateElo(1500, { domain: 'prediction', correct: true });
const newMap    = applyEloUpdates(eloMap, [{ domain: 'prediction', correct: false }]);

// Decay
applyWidthDecay(100, 3);  // 100 * 0.9^3 after 3 months
```

Tier thresholds:

| Tier | Requirements |
|---|---|
| `observer` | Default (depth < 100) |
| `contributor` | depth ≥ 100, width ≥ 10 |
| `architect` | Elo top 90th percentile in 1+ domain |
| `luminary` | Elo top 90th in 3+ domains, width ≥ 1000, W ≥ 20.0 |

---

## `@dot-protocol/relay`

CHORUS relay client — WebSocket transport for 153-byte DOTs.

```js
import { RelayClient } from '@dot-protocol/relay';

const client = new RelayClient({
  url: 'wss://dotdotdot.rocks',
  myDid: 'did:dot:...',
  privateKey: Uint8Array(32),
  publicKey: Uint8Array(32),
});

await client.connect();
client.onDot((bytes, channel) => { /* Uint8Array(153) */ });
await client.broadcast(dotBytes);         // send to own channel
await client.send(dotBytes, channel);     // send to specific channel
client.disconnect();
```

Frame format (relay wire protocol):

```js
import { packFrame, unpackFrame, FRAME_SIZE } from '@dot-protocol/relay';

const frame = packFrame(dotBytes, circleId);  // Uint8Array(FRAME_SIZE)
const { dot, circleId } = unpackFrame(frame); // destructure
```

---

## `@dot-protocol/qr` — v0.3.0

Physical DOT — the Falooda Protocol. A DOT printed as QR on paper IS communication.

```js
import {
  encodeBinary, decodeBinary,
  encodeSteganographic, decodeSteganographic,
  encodeNested, decodeNested,
  selectQRSpec, verifyPhysicalDOTs,
  QR_CAPACITY,
} from '@dot-protocol/qr';
```

### Encoding modes

**Binary** — DOTs packed sequentially, one 153-byte block each:
```js
const buf  = encodeBinary(dots);   // Uint8Array(N * 153)
const back = decodeBinary(buf);    // DOT[]
```

**Steganographic** — DOTs XOR-hidden in QR module data:
```js
const masked    = encodeSteganographic(dots, carrier);
const recovered = decodeSteganographic(masked, carrier, dotCount);
```

**Nested** — each DOT prefixed with 2-byte index, for microdot containers:
```js
const buf  = encodeNested(dots);   // Uint8Array(N * 155)
const back = decodeNested(buf);    // DOT[] sorted by index
```

### QR spec selection

```js
const spec = selectQRSpec(5, 'binary');
// spec.version          — QR version (1–40)
// spec.errorCorrection  — 'L'
// spec.dotsPerCode      — 5
// spec.encoding         — 'binary'
```

### Capacity

```js
QR_CAPACITY.maxBytesPerCode  // 2953 (QR v40, L error correction)
QR_CAPACITY.dotsPerCode      // 19   (~19 DOTs per standard QR)
QR_CAPACITY.microDotDensity  // 800  dots/cm² at arm's length
QR_CAPACITY.microDotCapacity // 122400 bytes/cm²
```

### Verification

```js
const result = await verifyPhysicalDOTs(dots, 'binary');
// result.verified  — true if all signatures pass + chain valid
// result.errors    — string[]
```

---

## `@dot-protocol/arena` — v0.3.0

Elo engine, blind evaluation, prediction resolution.

```js
import {
  resolveSession, verifyPrediction, verifyResolution, hashPredictionDOT,
  computeEloFromMatches, computeEloPercentile, rankLeaderboard,
  updateElo, ELO_DEFAULT,
} from '@dot-protocol/arena';
```

### Blind evaluation protocol

1. Predictor signs a `PredictionDOT` (claim + domain + expiry)
2. Oracle signs a `ResolutionDOT` (outcome) — blind, doesn't see individual predictions
3. Arena resolves: matches predictions to outcome, updates Elo

```js
// Create a blind eval session
const session = {
  id: 'my-session',
  domain: 'prediction',
  oracleKey: oracleKeypair.publicKey,  // who will resolve
  closesAt: Date.now() + 3600_000,
  predictions: [],
};

// Resolve when oracle posts outcome
const resolution = {
  dot: resolutionDOT,
  predictionRef: new Uint8Array(32),
  outcome: true,  // was the prediction correct?
};

const { matches, session: resolved } = await resolveSession(session, resolution);
// matches[i].correct, matches[i].pointsAwarded
```

### Elo

```js
// Single update
const newRating = updateElo(1500, { domain: 'prediction', correct: true });

// From arena matches
const newEloMap = computeEloFromMatches(existingEloMap, matches);

// Percentile
const pct = computeEloPercentile(myRating, allRatings); // 0–1

// Leaderboard
const board = rankLeaderboard('prediction', [
  { pubkey: '0xabc...', elo: 1700, totalPredictions: 50, correctPredictions: 38 },
  { pubkey: '0xdef...', elo: 1620, totalPredictions: 30, correctPredictions: 20 },
]);
// board[0].rank === 1, board[0].accuracy === 0.76
```

---

## `@dot-protocol/compression`

Batch packing — multiple DOTs into fewer bytes.

```js
import { batchPack, batchUnpack } from '@dot-protocol/compression';

const packed = await batchPack(dots);    // Uint8Array — shared pubkey + deduped signatures
const back   = batchUnpack(packed);      // DOT[]
```

**Ed25519 batch** at N=100: ~8.2 kB vs 15.3 kB individual (46% savings)
**BLS12-381 batch** at N=100: ~1.9 kB vs 15.3 kB individual (88% savings)

---

## `@dot-protocol/wrapper`

Wrap any binary payload as a DOT chain. The payload becomes the data; the chain is the proof.

```js
import { wrap, unwrap, createSession } from '@dot-protocol/wrapper';

const session = await createSession(keypair);
const chain   = await wrap(session, binaryData, { chunkSize: 14 }); // fits in 16B payload
const data    = await unwrap(chain);                                  // original bytes
```

---

## Constants

```js
import { DOT_SIZE, PAYLOAD_SIZE, OFF } from '@dot-protocol/core';

DOT_SIZE     // 153
PAYLOAD_SIZE // 16

OFF.PUBKEY   // 0   — start of public key
OFF.SIG      // 32  — start of signature
OFF.CHAIN    // 96  — start of chain hash
OFF.TS       // 128 — start of timestamp
OFF.TYPE     // 136 — type byte
OFF.PAYLOAD  // 137 — start of payload
```
