# DOT Protocol — Architecture

How the packages relate, what belongs where, and how to build with them.

---

## Package Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         @dot-protocol/sdk                           │
│                   (everything re-exported)                          │
└────────┬────────┬───────────┬────────┬──────────┬──────────────────┘
         │        │           │        │          │
         ▼        ▼           ▼        ▼          ▼
    dot-protocol  @dot-protocol/  @dot-protocol/  @dot-protocol/
    (engine)      qr              arena           wrapper
         │        │           │        │          │
         └────────┴─────┬─────┴────────┘          │
                        ▼                         │
               @dot-protocol/relay                │
                        │                         │
                        ▼                         │
               @dot-protocol/chain ◄──────────────┘
                        │
                        ▼
               @dot-protocol/core ◄── @dot-protocol/identity
                                  ◄── @dot-protocol/compression
```

**Rule:** Arrows point from higher-level to lower-level. Higher-level packages may import from lower-level ones. Never the reverse.

---

## Package Responsibilities

### `@dot-protocol/core`

**The atom.** No runtime dependencies. Pure functions only.

- Wire format constants (`DOT_SIZE = 153`, `PAYLOAD_SIZE = 16`, byte offsets)
- `createKeypair()` — Ed25519 key generation
- `createDOT()` — sign + chain a new DOT
- `verifyDOT()` — verify Ed25519 signature
- `checkChain()` — validate a sequence of DOTs
- `toBytes()` / `fromBytes()` — serialize / deserialize
- `DotType` enum — PUBLIC, CIRCLE, PRIVATE, EPHEMERAL
- `DOTFace` enum + `composeFaces()`, `hasFace()`, `activeFaces()` — 12+1 face architecture
- `TransformRegistry` — register, get, list deterministic transforms
- TEACH types — `computeRoyalty()`, `validateTEACHConfig()`

**What does NOT belong here:** networking, storage, UI, compression, relay logic, high-level abstractions.

---

### `@dot-protocol/chain`

**The worldline.** Depends only on `@dot-protocol/core`.

- `WorldLine` class — append-only sequence of DOTs per identity
- `checkChain()` re-export from core
- **Four-Score system:**
  - `buildScores()` — compute depth, width, Elo, W from chain stats
  - `computeTier()` — observer / contributor / architect / luminary
  - `updateElo()` — single match Elo update
  - `applyEloUpdates()` — batch update from match results
  - `computeW()` — compression ratio score (bits saved per byte)
  - `applyWidthDecay()` — exponential decay of width score over time

**What does NOT belong here:** relay transport, QR encoding, prediction logic.

---

### `@dot-protocol/relay`

**Transport.** WebSocket client for CHORUS relay. Depends on core.

- `RelayClient` — connect, send, receive, reconnect
- `packFrame()` / `unpackFrame()` — wrap/unwrap 153-byte DOTs in relay frames
- Handles connection lifecycle, backoff, message routing

**What does NOT belong here:** DOT creation/verification (that's core), storage, identity.

---

### `@dot-protocol/identity`

**Persistence.** Keypair storage and DID generation. Depends on core.

- `loadKeypair()` / `saveKeypair()` — filesystem keypair persistence
- `generateDID()` — derive a DID from a public key
- Optional encryption at rest

**What does NOT belong here:** relay transport, chain logic.

---

### `@dot-protocol/compression`

**Batch packing.** Ed25519 signature aggregation (BLS12-381 optional). Depends on core.

- `pack()` / `unpack()` — aggregate multiple DOTs for storage or transport
- Reduces overhead when storing/transmitting many DOTs

**What does NOT belong here:** relay logic, chain scoring.

---

### `@dot-protocol/qr`

**Physical DOTs.** Falooda Protocol. Depends on core.

- `encodeBinary()` / `decodeBinary()` — pack DOTs into QR binary data
- `encodeSteganographic()` / `decodeSteganographic()` — hide DOTs in PNG pixels
- `encodeNested()` / `decodeNested()` — chain-linked QR sequences
- `selectQRSpec()` — choose appropriate QR version for N DOTs
- `verifyPhysicalDOTs()` — verify signatures + chain from scanned DOTs
- Constants: `QR_CAPACITY` (maxBytesPerCode: 2953, dotsPerCode: 19)

**What does NOT belong here:** relay, chain scoring, prediction logic.

---

### `@dot-protocol/arena`

**Prediction + reputation.** Elo engine and blind evaluation. Depends on core + chain.

- `resolveSession()` — evaluate predictions against oracle resolution
- `verifyPrediction()` / `verifyResolution()` — DOT-level verification
- `hashPredictionDOT()` — commitment scheme (hash before reveal)
- `computeEloFromMatches()` — bulk Elo from match history
- `computeEloPercentile()` — where a rating falls in a distribution
- `rankLeaderboard()` — sort entries by Elo

**What does NOT belong here:** relay, QR encoding, wire format.

---

### `@dot-protocol/wrapper`

**Legacy bridge.** Wrap any binary data as a DOT chain. Depends on core.

- `wrap()` — chunk arbitrary bytes into a DOT chain
- `unwrap()` — reconstruct original bytes from DOT chain
- Useful for making existing binary formats DOT-compatible

---

### `dot-protocol` (engine)

**The high-level API.** One-liner for common workflows. Depends on all packages.

- `DOT.boot()` — initialize identity + relay connection
- `DOT.create()` — create a DOT (simple API over core)
- `DOT.on()` — event listener for incoming DOTs
- `DOT.seal()` / `DOT.verifySeal()` — sealed envelope pattern
- `DOT.decryptDot()` — ECDH decrypt a PRIVATE DOT
- `DOT.stats()` / `DOT.health()` — runtime metrics
- `DOT.shutdown()` — clean teardown

**This is the recommended entry point for new projects.** Use lower-level packages only when you need specific control.

---

### `@dot-protocol/sdk`

**Everything in one install.** Re-exports all packages. Use when you want one `npm install` to get everything.

```js
import { DOT, createDOT, WorldLine, RelayClient, encodeBinary, resolveSession } from '@dot-protocol/sdk';
```

---

## What Goes Where — Decision Guide

| You want to... | Use |
|---|---|
| Create and verify DOTs | `@dot-protocol/core` |
| Build a chain / worldline | `@dot-protocol/chain` |
| Connect to CHORUS relay | `@dot-protocol/relay` |
| Store keypairs on disk | `@dot-protocol/identity` |
| Pack many DOTs efficiently | `@dot-protocol/compression` |
| Encode DOTs into QR codes | `@dot-protocol/qr` |
| Run prediction evaluation | `@dot-protocol/arena` |
| Wrap existing binary data | `@dot-protocol/wrapper` |
| Build an app quickly | `dot-protocol` (engine) |
| Install everything | `@dot-protocol/sdk` |

---

## The Transform Layer (v0.3.0)

Transforms are deterministic state transitions. They live in `@dot-protocol/core`.

```
Input DOT ──── Transform ──── Output DOT
                   │
                   ▼
              TransformRegistry
              (named, pure, total, re-executable)
```

**Constraints:**
- **Named** — transforms have stable string identifiers
- **Pure** — same input always produces same output
- **Total** — defined for all valid inputs (no partial functions)
- **Re-executable** — running a transform twice = same result (idempotent)
- **No Turing-completeness** — transforms cannot loop, recurse, or halt

Built-in transforms:
- `time-capsule` — reveal at timestamp
- `signer-approval` — reveal when key signs approval
- `chain-depth-gate` — reveal at chain depth N

Register custom transforms with `TransformRegistry.register()`. The registry is global per runtime.

---

## The Face Architecture (v0.3.0)

12 named faces form a composable bitfield. The 13th face (`Transformer`) is the production rule.

```
DOTFace.QR          = 0x001   Physical QR representation
DOTFace.Container   = 0x002   Wraps other DOTs
DOTFace.Microdot    = 0x004   Microdot format
DOTFace.Stream      = 0x008   Part of a media stream
DOTFace.Prediction  = 0x010   Arena prediction
DOTFace.Resolution  = 0x020   Arena resolution
DOTFace.Attestation = 0x040   Media attestation
DOTFace.PING        = 0x080   Presence signal
DOTFace.Genesis     = 0x100   First in chain
DOTFace.Ephemeral   = 0x200   Dissolves after receipt
DOTFace.TEACH       = 0x400   Royalty-bearing
DOTFace.Contact     = 0x800   Two-party handshake
DOTFace.Transformer = 0x1000  (13th) — applies a transform
```

Faces are stored in the DOT's payload prefix (first 2 bytes) or in a side channel. They are advisory — they do not change the wire format.

---

## Deployment Patterns

### Relay topology

```
Client A ──┐
Client B ──┼──► CHORUS relay ──► all connected clients (type 0x00 PUBLIC)
Client C ──┘                 ──► recipient only (type 0x02 PRIVATE)
                             ──► circle members only (type 0x01 CIRCLE)
```

CHORUS is stateless. It does not store DOTs. It does not read payloads.

### Offline / air-gapped

```
Device A ──► QR encode (×19 DOTs per code) ──► print
                                                │
                                              scan
                                                │
Device B ──► QR decode ──► verify signatures ──► chain validated
```

### Peer-to-peer (no relay)

```
Device A ──► Bluetooth/NFC ──► 153 bytes ──► Device B
Device A ──► LoRa packet ──────────────────► Device B
Device A ──► HTTP POST ────────────────────► Device B
```

All patterns produce/consume the same 153-byte wire format.

---

## Testing Strategy

Each package has its own test suite. Run all:

```bash
pnpm -r test
```

Or per package:

```bash
pnpm --filter @dot-protocol/core test
pnpm --filter @dot-protocol/chain test
pnpm --filter @dot-protocol/qr test
pnpm --filter @dot-protocol/arena test
```

**Cross-language interop:**

Any DOT created in JS must verify in Python and vice versa. The wire format is the contract.

```python
# Python verifier
from dot_protocol import from_bytes, verify_dot
dot = from_bytes(bytes_from_js)
assert verify_dot(dot)
```

---

## Contributing

### Adding a new package

1. Create `packages/<name>/` with `package.json`, `src/index.ts`, `tsconfig.json`
2. Set `"type": "module"` and build target to `dist/`
3. Add to root `pnpm-workspace.yaml` (already includes `packages/*`)
4. Add to `@dot-protocol/sdk` dependencies and re-exports
5. Keep `@dot-protocol/core` as a dependency only — never create circular deps

### Adding a new transform

1. Register in `@dot-protocol/core` via `TransformRegistry.register()`
2. Implement `verify(input, output)` — pure, deterministic
3. Add built-in tests in `packages/core/src/tests/transform.test.ts`
4. Document in `docs/api.md` under TransformRegistry

### Wire format is frozen

The 153-byte layout is immutable. No new fields. No variable-length additions. If you need more data, it goes in the payload pointer (pointing to external storage) or in a new chain DOT.
