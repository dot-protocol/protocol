# DOT Protocol

**153 bytes. The minimum viable fact.**

DOT is a cryptographic observation format. A contact between two things that changes both. Ed25519 signatures. SHA-256 chain hashing. No variable-length fields. No configuration.

> *The act of contact leaves its DOT.*

[![npm](https://img.shields.io/npm/v/dot-protocol)](https://www.npmjs.com/package/dot-protocol)
[![license](https://img.shields.io/npm/l/dot-protocol)](LICENSE)
[![doi](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.18946074-blue)](https://doi.org/10.5281/zenodo.18946074)

---

## Wire format

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────┬──────────────┐
│  0 – 31      │  32 – 95     │  96 – 127    │  128 – 135   │  136     │  137 – 152   │
│  Public key  │  Signature   │  Chain hash  │  Timestamp   │  Type    │  Payload     │
│  Ed25519 32B │  Ed25519 64B │  SHA-256 32B │  Unix ms 8B  │  1B      │  16B         │
│  WHO         │  PROOF       │  SEQUENCE    │  WHEN        │  VISIBILITY│  WHAT      │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────┴──────────────┘
                                                                     153 bytes. Always.
```

- **153 bytes. Always.** No variable-length. No extensions.
- **Payload is a pointer, not a prison.** 16 bytes can hold a content hash pointing to anything stored anywhere.
- **The empty DOT is a PING.** Content is the exception. Presence is the default.
- **Ed25519 signing. SHA-256 hashing. No alternatives.**

---

## Packages

| Package | Install | Purpose |
|---|---|---|
| [`dot-protocol`](packages/engine) | `npm i dot-protocol` | **One-liner API** — boot, create, verify. Start here. |
| [`@dot-protocol/core`](packages/core) | `npm i @dot-protocol/core` | Raw primitives — keypair, sign, verify, bytes |
| [`@dot-protocol/chain`](packages/chain) | `npm i @dot-protocol/chain` | Append-only worldlines + scoring |
| [`@dot-protocol/relay`](packages/relay) | `npm i @dot-protocol/relay` | CHORUS relay client — WebSocket transport |
| [`@dot-protocol/identity`](packages/identity) | `npm i @dot-protocol/identity` | Persistent keypair + DID |
| [`@dot-protocol/compression`](packages/compression) | `npm i @dot-protocol/compression` | Batch packing — Ed25519 + BLS12-381 |
| [`@dot-protocol/wrapper`](packages/wrapper) | `npm i @dot-protocol/wrapper` | Wrap any binary as DOT chain |
| [`@dot-protocol/qr`](packages/qr) | `npm i @dot-protocol/qr` | Physical DOT — encode/decode QR codes |
| [`@dot-protocol/arena`](packages/arena) | `npm i @dot-protocol/arena` | Elo engine + blind prediction evaluation |
| [`@dot-protocol/sdk`](packages/sdk) | `npm i @dot-protocol/sdk` | Everything re-exported from one install |

---

## Quick start

### The engine (recommended)

```js
import { DOT } from 'dot-protocol';

await DOT.boot({ offline: true });

const bytes = await DOT.create({ WHAT: 'hello' });
// Uint8Array(153) — signed, chained, 153 bytes

console.log(bytes.length); // 153
```

### Connected to a relay

```js
import { DOT } from 'dot-protocol';

await DOT.boot(); // connects to wss://dotdotdot.rocks

DOT.on('dot', (bytes, from) => {
  console.log(`153-byte DOT from ${from}`);
});

await DOT.create({ WHAT: 'visible to all' });
await DOT.create({ WHAT: 'private message', WHO: recipientPublicKey });
```

### Low-level core primitives

```js
import { createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes } from '@dot-protocol/core';

const keypair = await createKeypair();
const genesis = await createDOT({ keypair });
const next    = await createDOT({ keypair, payload: 'hello', previous: genesis });

const ok    = await verifyDOT(next);                 // true
const chain = await checkChain([genesis, next]);      // { valid: true }
const buf   = toBytes(genesis);                       // Uint8Array(153)
const dot   = fromBytes(buf);                         // reconstructed
```

---

## Core concepts

### The worldline

Every DOT contains a `chain` field — the SHA-256 hash of the previous DOT's wire bytes. This creates an append-only chain:

```
Genesis DOT → chain: 32 zero bytes
Next DOT    → chain: SHA-256(toBytes(genesis))
Next DOT    → chain: SHA-256(toBytes(prev))
```

Tamper with any DOT and all future links break — instantly detectable by anyone.

### PING

The empty DOT. Zero payload. The default. Presence without content.

```js
const ping = await DOT.create({}); // 153 bytes, payload all zeros
```

### Contact

When two devices meet, each creates a DOT whose payload contains the other's public key (first 16 bytes). Two DOTs, two chains, each now containing the other.

```js
// Alice
const contact = await DOT.create({ WHAT: bobKey.slice(0, 16) });
// Bob — same moment, different chain
const contact = await DOT.create({ WHAT: aliceKey.slice(0, 16) });
```

### Type byte

| Value | Name | Meaning |
|---|---|---|
| `0x00` | `PUBLIC` | Visible to anyone |
| `0x01` | `CIRCLE` | Visible to circle members |
| `0x02` | `PRIVATE` | Encrypted, recipient-only |
| `0x03` | `EPHEMERAL` | Dissolves after receipt |

```js
import { DotType, createDOT } from '@dot-protocol/core';
const dot = await createDOT({ keypair, type: DotType.PRIVATE });
```

---

## Transport

DOT is transport-agnostic. 153 bytes go anywhere:

| Transport | How |
|---|---|
| WebSocket / CHORUS | Built-in via `DOT.boot()` |
| HTTP | POST `Uint8Array(153)` as binary body |
| QR code | `@dot-protocol/qr` — ~19 DOTs per standard QR |
| Bluetooth / NFC | Standard BLE/NFC data channel |
| LoRa | 153 bytes fits comfortably |
| SMS / paper | Hex encode (306 chars) |
| Sound, Li-Fi, IR | Any binary channel works |

The relay knows nothing. It forwards 153 bytes without reading them.

---

## v0.3.0

### Transform registry — DOT is a lens, not a thermometer

DOTs can now describe deterministic, verifiable state transitions. Three built-ins:

```js
import { TransformRegistry, serializeTransformCondition } from '@dot-protocol/core';

// time-capsule: reveal at a timestamp
// signer-approval: reveal when a key signs
// chain-depth-gate: reveal at chain depth N

const spec = TransformRegistry.get('time-capsule');
const valid = spec.verify(inputDOT, outputDOT); // deterministic
```

### 12+1 face architecture

Composable bitfield faces declare what a DOT is:

```js
import { composeFaces, hasFace, activeFaces, DOTFace } from '@dot-protocol/core';

const mask = composeFaces(DOTFace.QR, DOTFace.Container, DOTFace.Microdot);
hasFace(mask, DOTFace.QR);  // true
activeFaces(mask);           // ['QR', 'Container', 'Microdot']
```

### Four-score system

Protocol-native reputation — no platform assigns it:

```js
import { buildScores, computeTier } from '@dot-protocol/chain';

const scores = buildScores({ chainLength: 500, branchedChainCount: 25 });
computeTier(scores); // 'observer' | 'contributor' | 'architect' | 'luminary'
```

### Physical DOT (QR / Falooda Protocol)

```js
import { encodeBinary, decodeBinary, selectQRSpec } from '@dot-protocol/qr';

const spec  = selectQRSpec(5, 'binary');  // 5 DOTs, QR version auto-selected
const bytes = encodeBinary(dots);          // feed to any QR library
const back  = decodeBinary(bytes);         // reconstruct DOTs
```

### Arena (Elo + blind prediction evaluation)

```js
import { resolveSession, rankLeaderboard, ELO_DEFAULT } from '@dot-protocol/arena';

const { matches } = await resolveSession(session, resolutionDOT);
const board = rankLeaderboard('prediction', entries);
```

---

## Docs

- **[API Reference](docs/api.md)** — every function, every field
- **[Building Patterns](docs/patterns.md)** — chat, DMs, streams, bots, media, reputation
- **[Architecture](docs/architecture.md)** — how packages relate, what belongs where

---

## Constraints (hard rules)

- DOT is always exactly **153 bytes**. No exceptions.
- **Ed25519** for signing. **SHA-256** for hashing. No pluggable crypto.
- **No Turing-completeness** in transforms — total, pure, named, re-executable only.
- **No self-referential DOTs** — a DOT cannot reference itself (Gödel constraint).
- **Backwards compatible** — every v0.2.0 DOT is a valid v0.3.0 DOT.
- **MIT license. Always.**

---

## Philosophy

153 bytes is the tax humans pay for being the only known species that can lie. The tree communicates for free. The protocol exists to let a lying species speak truth again.

DOT is a lens, not a thermometer. It transforms what passes through it according to fixed laws. Anyone with the same lens and the same light gets the same result.

The destination is not better code. The destination is no code — machines that sign by existing, chain by growing, contact by touching, and verify by physics.

*The plant in Nashik soil is already there.*

---

MIT © DOT Protocol — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)
