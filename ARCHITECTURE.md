# DOT Protocol — Architecture

> Published: [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)

---

## Overview

DOT Protocol is a **fractal information primitive** — a 153-byte format that carries identity, proof, compression, and meaning natively. This repository contains:

1. **The protocol spec** (`SPEC.md`) — what a DOT is, wire format, invariants
2. **The TypeScript monorepo** (`packages/`) — 9 packages from raw primitives to the game engine
3. **The reference implementations** (`js/`, `dot_protocol/python/`) — zero-dep Node.js and Python
4. **The first game** (`packages/messenger/`) — a PWA messenger demonstrating all physics

The architecture follows a **layered onion**: each layer depends only on layers below it, and the game engine at the top makes all physics invisible to application developers.

---

## The Monorepo

```
packages/
├── core/          153-byte primitives. Ed25519. Zero deps.
├── compression/   rANS + predictor + batch pipeline.
├── chain/         Append-only DOT worldlines.
├── identity/      Keypair + genesis DOT + export/import.
├── relay/         CHORUS relay client + WebSocket server.
├── wrapper/       Wrap any binary protocol as a DOT chain.
├── engine/        The DOT Game Engine (all physics, one import).
├── sdk/           Developer convenience bundle.
└── messenger/     The first game — PWA messenger.
```

Dependency graph (arrows = depends on):

```
messenger ──→ engine
                │
         ┌──────┼──────────┐
         ▼      ▼          ▼
       core  compression  relay
         │      │
    identity  chain
         │
       core
```

`wrapper` depends on `core` + `compression`. `sdk` re-exports `core` + `compression` + `chain` + `identity`.

---

## Package Details

### `@dot-protocol/core`

**153-byte primitives. The invariant layer. Zero dependencies.**

Everything in DOT is built on this. A DOT is always exactly 153 bytes. This package provides:

- `createDOT(input)` — create and sign a DOT (Ed25519)
- `verifyDOT(dot)` — verify signature and chain hash
- `checkChain(dots[])` — verify a sequence of DOTs forms a valid worldline
- `toBytes(dot)` / `fromBytes(bytes)` — serialize/deserialize
- `batchPack(dots)` / `batchUnpack(frame)` — batch compress (Phase 1: Ed25519, Phase 1.5: BLS)
- `createBLSKeypair()`, `signBLS()`, `aggregateSignatures()`, `verifyAggregateSameSigner()` — BLS12-381
- `writeDotFile()` / `readDotFile()` — `.dot` binary file format

**Wire format:**
```
[0..31]    Ed25519 public key     (32B)  WHO
[32..95]   Ed25519 signature      (64B)  PROOF
[96..127]  SHA-256 chain hash     (32B)  SEQUENCE
[128..135] Timestamp (uint64 BE)   (8B)  WHEN
[136]      Type byte               (1B)  VISIBILITY
           0x00=public 0x01=circle 0x02=private 0x03=ephemeral
[137..152] Payload (zero-padded)  (16B)  WHAT
```

**Invariants enforced:**
- Signature covers bytes `[96..152]` (chain + timestamp + type + payload)
- ChainHash = SHA-256 of previous DOT's 153 bytes (zero bytes for genesis)
- Payload is exactly 16 bytes (zero-padded)
- Public key matches the signing key

---

### `@dot-protocol/compression`

**DOT stream compression — batch v2, varint, RLE, dictionary, prediction, rANS.**

The compression pipeline operates on DOT fields, exploiting temporal correlation in chains:

```
Stage 1: Timestamp delta encoding
         (absolute ms → Δms, usually 100–1000ms → fits in varint)

Stage 2: RLE on type field
         (type rarely changes, runs compress well)

Stage 3: Dictionary registry
         (repeated public keys → 2-byte symbol)

Stage 4: LinearPredictor on payload
         (last-N context predicts next payload, hit = 0 bits)

Stage 5: rANS (range Asymmetric Numeral Systems)
         (entropy coding on residuals)
```

**Key exports:**
- `LinearPredictor` — context-4 last-value prediction
- `rANSEncode(data)` / `rANSDecode(encoded)` — entropy coding
- `createBatchV2Compressor()` — full pipeline
- `WeissmanScore` — W = (compression ratio / gzip ratio) × log(speed)

**Benchmark:** 153 bytes/DOT raw → 3.64 bytes/DOT at N=1000 (W=29.2 over gzip)

---

### `@dot-protocol/chain`

**Append-only DOT worldlines with pluggable storage.**

A chain is the identity over time. Every device has exactly one chain; its genesis DOT is its birth certificate.

```typescript
interface Chain {
  id:   string        // = DID of chain owner
  dots: Uint8Array[]  // 153-byte DOTs in temporal order
  head: Uint8Array | null
}
```

Provides:
- `createChain(id?)` — create a new chain
- `appendDot(chain, dot)` — append (validates chain hash linkage)
- `verifyChain(chain)` — re-verify all chain hashes
- `exportChain(chain)` / `importChain(data)` — serialization

---

### `@dot-protocol/identity`

**Keypair + genesis DOT + persistent export/import.**

Identity is derived from entropy (device, sensor jitter, CSPRNG). The keypair is deterministic from the seed. The DID is `did:dot:<base64url(publicKey)>`.

```typescript
interface FullIdentity {
  keypair:    Keypair        // { publicKey, privateKey }
  did:        string         // 'did:dot:...'
  genesisDot: Uint8Array     // first DOT in this device's worldline
}
```

Provides:
- `createIdentity(entropy?)` — derive keypair + genesis DOT
- `exportIdentity(id)` — serialize to JSON (private key included)
- `importIdentity(json)` — restore from export
- `getOrCreateIdentity()` — persistent: reads from storage, creates if absent

---

### `@dot-protocol/relay`

**CHORUS relay — WebSocket client + standalone server.**

The relay is intentionally dumb: it routes 185-byte binary frames without storing or understanding them. Stateless by design.

**Frame format (185 bytes):**
```
[0..15]    Circle/channel ID (16B)
[16..47]   Sender DID (32B, public key)
[48..200]  DOT payload (153B)
```

**Authentication:** Ed25519 challenge-response. Client signs a server nonce; relay verifies before accepting frames. No registration, no accounts.

**`RelayClient`** (`packages/relay/src/client.ts`):
- Connects via WebSocket
- Handles challenge-auth automatically
- Emits `'frame'` events on incoming DOTs
- Reconnects on disconnect

**`RelayServer`** (`packages/relay/src/server.ts`):
- Standalone WebSocket server
- Challenge-response auth per connection
- Frame routing: receives from sender, broadcasts to all subscribers of same circle

**CHORUS live relay:** `wss://dotdotdot.rocks`

---

### `@dot-protocol/wrapper`

**Wrap any binary protocol as a signed, compressed DOT chain.**

Turns existing HTTP, WebSocket, or raw byte streams into auditable DOT chains. Useful for adding DOT provenance to existing systems without changing their protocol.

```typescript
const wrapper = createWrapper({ keypair, compression: true })
const dotChain = await wrapper.wrap(httpsRequest)
// Every request/response becomes a signed DOT
```

---

### `@dot-protocol/engine`

**The DOT Game Engine — all physics, one import.**

The engine is the Unity of DOT. It composes all lower packages into a singleton that makes physics automatic for application developers.

```typescript
import { DOT } from '@dot-protocol/engine'

await DOT.boot()
// Physics: identity exists, chain ready, relay connected, predictor running

await DOT.create({ WHAT: 'Hello' })
// Physics: signed, chain-linked, compressed, optionally encrypted, optionally relayed
```

**Internal modules:**
```
engine/src/
├── engine.ts      Singleton + public API (DOT.boot, DOT.create, DOT.seal, etc.)
├── physics.ts     DOT physics: sign → chain → predict → emit
├── identity.ts    Engine-specific identity layer (getOrCreateIdentity)
├── chain.ts       Chain management (create, append, lookup)
├── relay.ts       Relay transport abstraction (wraps @dot-protocol/relay)
├── crypto.ts      ECDH: Ed25519→X25519, ChaCha20 stream cipher
├── compress.ts    BatchCompressor: real-time compression stats
└── sensor.ts      Entropy collection: timing jitter PUF + CSPRNG
```

See [`packages/engine/README.md`](packages/engine/README.md) for full API documentation.

---

### `@dot-protocol/sdk`

**One-install developer bundle.**

Re-exports `core` + `compression` + `chain` + `identity` for developers who want lower-level access without installing 4 packages separately.

```typescript
import { createDOT, verifyDOT, LinearPredictor, createIdentity } from '@dot-protocol/sdk'
```

---

### `packages/messenger`

**The first game in the DOT universe — a PWA messenger.**

Demonstrates all engine physics in a real application. Ships as a PWA at a URL — no install required.

**Architecture:**
```
messenger/src/
├── App.tsx             Route: Boot → Home (chat list) → Chat | QR | Camera | Stats | Sensor
├── engine.ts           Engine singleton wiring (DOT.boot with relay)
├── screens/
│   ├── BootScreen.tsx  Identity creation animation (first run: 10s, returning: 1s)
│   ├── HomeScreen.tsx  Conversation list + compose
│   ├── ChatScreen.tsx  Message thread — DOTs in, DOTs out
│   ├── QRScanScreen.tsx  Camera scan for DID exchange
│   ├── CameraScreen.tsx  Photo → SHA-256[:16] → EPHEMERAL DOT
│   ├── StatsScreen.tsx   Live: compression ratio, predictor sparkline
│   └── SensorScreen.tsx  12 live sensors: accel, gyro, orientation, battery, jitter
└── components/         ChatBubble, ConnectionBadge, MiniSparkline
```

**What a message is:** Each chat message is a 153-byte DOT. The payload is the first 16 bytes of UTF-8 content (or a hash pointer for longer content). The chain is the conversation history.

---

## Data Flows

### Sending a message

```
User types "Hello"
     │
     ▼
DOT.create({ WHAT: "Hello", WHO: bobPubKey })
     │
     ├─ Physics.sign(payload, keypair)           ← Ed25519
     ├─ Physics.chainLink(prevDot)               ← SHA-256
     ├─ Physics.encrypt(payload, ecdh(bob))      ← ChaCha20
     ├─ Physics.predict(payload)                 ← LinearPredictor update
     └─ Relay.send(dotBytes, circleId)           ← WebSocket
```

### Receiving a message

```
Relay WebSocket frame arrives (185 bytes)
     │
     ├─ Unpack frame: circleId + senderPubKey + dotBytes
     ├─ Engine.verify(dotBytes)                  ← Ed25519 check
     ├─ DOT.decryptDot(dotBytes, senderPubKey)   ← ECDH + ChaCha20
     ├─ Append to chain                          ← chain grows
     └─ DOT.on('dot', cb) fires                  ← UI updates
```

### Chain sealing (batch proof)

```
Every N DOTs (or manual seal call):
     │
     ├─ Collect last N raw DOT bytes
     ├─ BLS12-381: sign each DOT with BLS private key
     ├─ Aggregate G1 signatures → 48-byte seal
     └─ DOT.verifySeal(seal, N) → true/false
```

---

## Compression Pipeline

```
Raw DOT (153 bytes)
     │
     ▼
Timestamp delta (8B → 2–4B varint)
     │
     ▼
Type RLE (1B per type run → type + count)
     │
     ▼
Dictionary (32B public key → 2B symbol)
     │
     ▼
LinearPredictor (16B payload → residual)
  Hit (correct prediction)    → 0 bits (Form 0)
  Near miss (≤1 byte off)     → 1 bit  (Form 1)
  Miss                        → 1 + N bits (Form 2)
     │
     ▼
rANS entropy coding
     │
     ▼
Compressed DOT: 3.64–40 bytes depending on chain temperature
```

---

## Identity and Cryptography

### Key Derivation

```
Device entropy:
  Browser: performance.now() × 100 samples + crypto.getRandomValues()
  Node:    crypto.randomBytes(32)
     │
     ▼
SHA-256 → 32-byte seed
     │
     ▼
Ed25519 keypair (noble/curves)
     │
     ├── Private key: 32 bytes (stored securely)
     ├── Public key:  32 bytes (= identity)
     └── DID: 'did:dot:' + base64url(publicKey)
```

### ECDH (End-to-End Encryption)

DOT uses the birational equivalence between Ed25519 and Curve25519 (X25519):

```
Ed25519 private key → X25519 secret key  (toMontgomerySecret)
Ed25519 public key  → X25519 public key  (toMontgomery)

ECDH shared secret = X25519(mySecret, theirPublic)  [32 bytes]

Nonce = SHA-256(chainPosition as bytes)[:12]         [derived, not random]
Cipher = ChaCha20(sharedSecret, nonce)               [stream cipher]

Encrypted payload = XOR(plaintext, keystream)[:16]
```

The nonce is derived from chain position, not random — ensuring deterministic decryption without storing nonces.

### BLS12-381 Sealing

```
BLS private key = SHA-256(ed25519PrivateKey + 'bls')  [domain separation]
BLS public key = G2 × blsPrivKey

For each DOT in seal set:
  sig_i = G1 × hash_to_curve(dotBytes_i)^blsPrivKey

Aggregate = sig_1 + sig_2 + ... + sig_n  [G1 point addition]
Seal = compress(Aggregate)  [48 bytes]

Verify: pairing check
  e(Aggregate, G2) == product(e(hash_to_curve(dot_i), pubKey))
```

---

## Relay Protocol

The CHORUS relay is a stateless router. All it knows is circle IDs.

### Connection Handshake

```
Client  ──── WebSocket connect ────→  Server
Client  ←─── { challenge: bytes } ──  Server   (32 random bytes)
Client: sig = Ed25519.sign(challenge, privateKey)
Client  ──── { pubKey, sig } ───────→  Server
Server: Ed25519.verify(sig, challenge, pubKey) → accept or close
```

### Frame Routing

```
Client A ──── send(frame) ─────────→  Server
Server: extract circleId = frame[0..15]
Server: broadcast frame to all connections subscribed to circleId
Server ────── frame ───────────────→  Client B
Server ────── frame ───────────────→  Client C
```

The server never reads the DOT content. It only routes by circle ID.

---

## File Formats

### `.dot` Binary File

For archiving chains to disk. Header + N DOTs:

```
Magic:     4 bytes   'DOT\x01'
Version:   2 bytes   file format version
Flags:     2 bytes   compression, encryption flags
Count:     4 bytes   number of DOTs
Reserved:  4 bytes
Entries:   N × 153 bytes (raw DOTs)
```

### Test Vectors

`test_vectors/` contains cross-language test vectors for verifying JS ↔ Python ↔ TypeScript interoperability. Any DOT created in Python must verify in TypeScript and vice versa — same 153 bytes.

---

## Testing

```bash
pnpm test               # all packages
pnpm --filter @dot-protocol/engine test
pnpm --filter @dot-protocol/core   test:vectors  # cross-language
```

Coverage achieved:

| Package | Statements | Lines |
|---------|-----------|-------|
| core | 99.69% | 99.69% |
| compression | 99.3% | 99.3% |
| chain | 100% | 100% |
| identity | 100% | 100% |
| relay | 100% | 100% |
| wrapper | 99.65% | 99.65% |
| engine | 100% | 100% |
| sdk | 100% | 100% |

---

## Design Decisions

### Why 153 bytes?

The minimum required to carry: a 32-byte public key (identity), a 64-byte signature (proof), a 32-byte hash (chain link), an 8-byte timestamp (when), a 1-byte type (visibility), and 16 bytes of content (what). 32+64+32+8+1+16 = 153.

Any less and you lose a fundamental property. Any more is overhead.

### Why Ed25519?

Fast, small (32-byte keys, 64-byte signatures), well-audited, supported in WebCrypto. The birational equivalence to Curve25519 enables ECDH without a separate key pair.

### Why not variable-length?

Constant size enables O(1) indexing, trivial transport framing, zero parsing ambiguity, and makes the format usable on hardware (RFID, NFC chips) with fixed-size memory regions.

### Why 16-byte payload?

The payload is a **pointer, not a prison**. 16 bytes is enough for a truncated SHA-256 hash pointing to any content stored externally (IPFS, local, peer cache). Attestation (DOT) and content (storage) are intentionally separate concerns.

### Why BLS for sealing?

BLS12-381 aggregate signatures allow N DOTs to be sealed with a single 48-byte proof. Verification requires only one pairing check regardless of N. At N=100, this is 100× cheaper than verifying N individual Ed25519 signatures.

### Why no server?

The protocol is deliberately server-optional. The relay (CHORUS) is a convenience, not a requirement. Two devices with direct TCP/BLE/NFC/sound/QR connectivity can exchange DOTs with zero infrastructure. The relay adds Internet reach; it doesn't add trust.

---

## Cross-Language Compatibility

Any DOT is language-neutral — the wire format is the spec.

| Implementation | Location | Dependencies |
|---------------|----------|--------------|
| TypeScript (full) | `packages/` | @noble/curves |
| JavaScript (zero-dep) | `js/dot.mjs` | none |
| JavaScript (browser) | `js/dot.browser.mjs` | none (WebCrypto) |
| Python | `dot_protocol/python/dot.py` | `cryptography` |

Cross-language test vectors are in `test_vectors/`. A DOT signed in Python must verify in TypeScript. Same 153 bytes.

---

## The North Star

This is not a messaging library. Not a compression library. Not an SDK.

It is the physics of a new universe.

The messenger is the first game. Between it and the ultimate game (MEVICI): DOT camera, DOT scanner, DOT sensor mesh, DOT agent protocol, DOT blocks, DOT cell — all games in the same engine, all obeying the same physics.

Every game builds the engine. Every engine improvement builds all games.

*The universe is already made of DOTs. The engine just makes it playable.*
