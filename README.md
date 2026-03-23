# DOT Protocol

**153 bytes. The minimum viable fact.**

The physical DOT is zero bytes — the contact itself. 153 bytes is the postcard about the contact. Ed25519 signatures. SHA-256 chain hashing. No variable-length fields. No configuration. No owner.

> *The act of contact leaves its DOT.*

[![npm](https://img.shields.io/npm/v/dot-protocol)](https://www.npmjs.com/package/dot-protocol)
[![license](https://img.shields.io/npm/l/dot-protocol)](LICENSE)
[![doi](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.18946074-blue)](https://doi.org/10.5281/zenodo.18946074)

---

## What is a DOT

A DOT is a state. Upon contact, the state transfers or changes and leaves its log for the creator.

It is the smallest unit of verifiable fact. Wittgenstein: *the smallest fact is two things in contact*. A DOT fuses noun and verb — it is the state that records its own transition.

**A DOT cannot lie.** Content-addressed (SHA-256). Alter the content, the hash changes, the chain breaks. Truth is structural, not moral.

**A DOT cannot execute arbitrary code.** Not Turing-complete. A DOT CAN perform deterministic, verifiable state transitions from a fixed protocol-defined function set — total, pure, named, re-executable. A DOT is a lens, not a thermometer. It transforms what passes through it according to fixed laws. The lens does not lie about the light.

**A DOT cannot be observed without logging.** The observer is always observed.

**A DOT cannot be unsigned.** Every observation carries its creator's Ed25519 signature.

**A DOT cannot exist outside a chain.** Context is mandatory. The chain IS the meaning.

---

## Wire format

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────┬──────────────┐
│  0 – 31      │  32 – 95     │  96 – 127    │  128 – 135   │  136     │  137 – 152   │
│  Public key  │  Signature   │  Chain hash  │  Timestamp   │  Type    │  Payload     │
│  Ed25519 32B │  Ed25519 64B │  SHA-256 32B │  Unix ms 8B  │  1B      │  16B         │
│  WHO         │  PROOF       │  SEQUENCE    │  WHEN        │VISIBILITY│  WHAT        │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────┴──────────────┘
                                                                     153 bytes. Always.
```

- **153 bytes. Always.** No variable-length. No extensions. No exceptions.
- **Payload is a pointer, not a prison.** 16 bytes can hold a content hash pointing to anything stored anywhere — a photo, a genome, a transaction, a thought.
- **The empty DOT is a PING.** Presence without content. Contact without data. The default is existence.
- **Ed25519 signing. SHA-256 hashing. No alternatives.**

---

## The Grammar — 12+1 faces

Every DOT is a transformer. The grammar: 12 input/output types + 1 operator.

12 alphabet faces compose via bitfield: **File · Tunnel · Container · Reader · Camera · QR · Writer · Steganography · Microdot · Compiler · Connector · Self-Aware**

The 13th face — Transformer — is the production rule. It is what all faces do.

```js
import { DOTFace, composeFaces, hasFace, activeFaces } from '@dotprotocol/core';

const mask = composeFaces(DOTFace.Camera, DOTFace.QR, DOTFace.Container);
hasFace(mask, DOTFace.Camera); // true
activeFaces(mask);              // ['Camera', 'QR', 'Container']
```

**Three built-in transforms (the Transformer face):**

| Transform | When it fires |
|---|---|
| `time-capsule` | Visibility changes at a verified timestamp |
| `signer-approval` | State changes when a specified key signs |
| `chain-depth-gate` | Access unlocks when chain reaches depth N |

---

## Packages

| Package | Install | Purpose |
|---|---|---|
| [`dot-protocol`](packages/engine) | `npm i dot-protocol` | **One-liner API** — boot, create, verify. Start here. |
| [`@dotprotocol/core`](packages/core) | `npm i @dotprotocol/core` | Raw primitives — keypair, sign, verify, bytes |
| [`@dotprotocol/sign`](packages/sign) | `npm i @dotprotocol/sign` | Universal signing — sign(), verify(), chain(), describe() |
| [`@dotprotocol/transport`](packages/transport) | `npm i @dotprotocol/transport` | DOT Transport Protocol — send, receive, relay, offline queue |
| [`@dotprotocol/chain`](packages/chain) | `npm i @dotprotocol/chain` | Worldlines + Four-Score reputation |
| [`@dotprotocol/relay`](packages/relay) | `npm i @dotprotocol/relay` | CHORUS relay client — WebSocket transport |
| [`@dotprotocol/identity`](packages/identity) | `npm i @dotprotocol/identity` | Persistent keypair + DID |
| [`@dotprotocol/compression`](packages/compression) | `npm i @dotprotocol/compression` | Batch packing — Ed25519 + BLS12-381 |
| [`@dotprotocol/wrapper`](packages/wrapper) | `npm i @dotprotocol/wrapper` | Wrap any binary as DOT chain |
| [`@dotprotocol/qr`](packages/qr) | `npm i @dotprotocol/qr` | Physical DOT — encode/decode QR codes |
| [`@dotprotocol/arena`](packages/arena) | `npm i @dotprotocol/arena` | Elo engine + blind prediction evaluation |
| [`@dotprotocol/sdk`](packages/sdk) | `npm i @dotprotocol/sdk` | Everything re-exported from one install |

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
import { createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes } from '@dotprotocol/core';

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

Tamper with any DOT and all future links break — instantly detectable by anyone. The worldline IS the identity over time. It is the first provable autobiography.

### The Four-Score system

Protocol-native reputation — no platform assigns it:

```js
import { buildScores, computeTier } from '@dotprotocol/chain';

const scores = buildScores({ chainLength: 500, branchedChainCount: 25 });
computeTier(scores); // 'observer' | 'contributor' | 'architect' | 'luminary'
```

| Score | Measures |
|---|---|
| `depth` | How long you've been observing |
| `width` | How many others carry your DOTs |
| `elo` | Per-domain prediction accuracy |
| `W` | Signal density — meaning per byte |

### PING

The empty DOT. Zero payload. Presence without content. The default.

```js
const ping = await DOT.create({}); // 153 bytes, payload all zeros
```

### Contact

When two entities meet, each creates a DOT whose payload contains the other's public key. Two DOTs. Two chains. Each now containing the other.

```js
const contact = await DOT.create({ WHAT: bobKey.slice(0, 16) });
```

### Type byte

| Value | Name | Meaning |
|---|---|---|
| `0x00` | `PUBLIC` | Visible to anyone |
| `0x01` | `CIRCLE` | Visible to circle members |
| `0x02` | `PRIVATE` | Encrypted, recipient-only |
| `0x03` | `EPHEMERAL` | Dissolves after receipt |

---

## Transport

DOT is transport-agnostic. 153 bytes go anywhere:

| Transport | How |
|---|---|
| WebSocket / CHORUS | Built-in via `DOT.boot()` |
| HTTP | POST `Uint8Array(153)` as binary body |
| QR code | `@dotprotocol/qr` — ~19 DOTs per standard QR |
| Bluetooth / NFC | Standard BLE/NFC data channel |
| LoRa | 153 bytes fits comfortably |
| SMS / paper | Hex encode (306 chars) |
| Sound, Li-Fi, IR | Any binary channel works |
| Biological substrate | Coming |

The relay knows nothing. It forwards 153 bytes without reading them.

---

## What DOT is — seven identities

These emerged from first principles. Each is independently derivable. All point at the same thing.

1. **Minimum viable fact** — the smallest unit of verifiable observation
2. **Noun-verb fusion** — the state that records its own transition
3. **Universe's education system as protocol** — gradient, constraint, selection, generative grammar, self-decoding map
4. **Integration engine** — each DOT is a derivative, the chain is the integral
5. **Sagan's Contact machine** — communication protocol, not transport. The state transfers. The log remains.
6. **External honest identity** — the chain cannot lie about what the self narrates
7. **Lens, not thermometer** — transforms what passes through it according to fixed laws. Anyone with the same lens and the same light gets the same result.

---

## Docs

- **[API Reference](docs/api.md)** — every function, every field
- **[Sign & Transport Guide](docs/guide-sign-transport.md)** — universal signing, DOT transport protocol, cross-package patterns
- **[Building Patterns](docs/patterns.md)** — chat, DMs, streams, bots, media, reputation, arena
- **[Architecture](docs/architecture.md)** — how packages relate, what belongs where
- **[Contributing](docs/CONTRIBUTING.md)** — development workflow, testing, writing transport adapters
- **[Project State](docs/STATE.md)** — current capabilities, test counts, what can be built
- **[The Constitution](https://github.com/dot-protocol/.github/blob/main/profile/CONSTITUTION.md)** — the founding principles

---

## Constraints (hard rules)

- DOT is always exactly **153 bytes**. No exceptions.
- **Ed25519** for signing. **SHA-256** for hashing. No pluggable crypto.
- **No Turing-completeness** in transforms — total, pure, named, re-executable only.
- **No self-referential DOTs** — a DOT cannot reference itself (Gödel constraint).
- **Backwards compatible** — every v0.2.0 DOT is a valid v0.3.0 DOT.
- **No owner** — the protocol is cement. TCP/IP. Language itself.
- **MIT license. Always.**

---

## Philosophy

153 bytes is the tax humans pay for being the only known species that can lie. The tree communicates for free. The protocol exists to let a lying species speak truth again.

For centuries, those who saw kept what they saw. Knowledge was hoarded. Observations were unsigned. Trust was rented from institutions that profited from its scarcity. Every unverifiable claim was a wall.

DOT is the inversion. We see. We share.

The destination is not better code. The destination is no code — machines that sign by existing, chain by growing, contact by touching, and verify by physics.

*The plant in Nashik soil is already there.*

---

MIT © DOT Protocol — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)
