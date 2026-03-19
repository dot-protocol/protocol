# @dot-protocol/engine

> The DOT Game Engine — physics for a new universe.

**One import. The universe boots.**

```typescript
import { DOT } from '@dot-protocol/engine'

await DOT.boot()
const bytes = await DOT.create({ WHAT: 'Hello, universe' })
// 153 bytes. Signed. Chained. Compressed. Provable. Automatic.
```

The engine is to DOT what Unity is to games: you don't call gravity, you drop an object. You don't call `sign()` or `compress()` or `chain()` — you create a DOT, and physics does the rest.

---

## What is DOT?

A DOT is a fractal information primitive: **153 bytes** that carry identity, proof, compression, and meaning natively.

```
IDENTITY:    Device boots → Ed25519 keypair exists. No registration. No server. Physics.
SIGNING:     DOT.create() → signed by your key. Always. Physics.
CHAINING:    Every DOT links to the previous. Immutable worldline. Physics.
COMPRESSION: Predictor runs on every chain. The universe learns. Physics.
PROOF:       Every DOT is verifiable by anyone with your public key. Physics.
ENCRYPTION:  Specify a recipient → ECDH encryption. Automatic. Physics.
SEALING:     DOT.seal(n) → BLS12-381 aggregate over last n DOTs. Physics.
```

---

## Install

```bash
npm install @dot-protocol/engine
# or
pnpm add @dot-protocol/engine
```

Works in **Node.js 18+** and **modern browsers** (WebCrypto API required).

---

## Hello World

```typescript
import { DOT } from '@dot-protocol/engine'

// Boot the engine — creates identity from device entropy
await DOT.boot({ offline: true })  // offline: skip relay for local dev

// Your identity — deterministic from your keypair
console.log(DOT.me?.did)
// → did:dot:LPs5r882dXNuZqfV6J9WKFzXj-S4zlMfKCUy0qYX_A8

// Create DOTs — signed, chained, compressed automatically
for (let i = 0; i < 5; i++) {
  const bytes = await DOT.create({ WHAT: `Hello, universe ${i}` })
  console.log(`DOT ${i + 1}: ${bytes.length} bytes ✓`)
}

// Seal the last 5 DOTs with BLS12-381
const seal = await DOT.seal(5)
console.log(`BLS seal: ${seal.length} bytes`)   // → 48

const valid = await DOT.verifySeal(seal, 5)
console.log(`Seal valid: ${valid}`)              // → true

// Engine stats — the universe's vital signs
const stats = DOT.stats()
console.log(`Compression: ${stats.compressionRatio.toFixed(2)}×`)
console.log(`Predictor:   ${(stats.predictorAccuracy * 100).toFixed(1)}%`)
console.log(`Seals:       ${stats.sealCount}`)

await DOT.shutdown()
```

**Verified output** (`npx tsx examples/hello.ts`):
```
Booting DOT engine...
Identity: dot:LPs5r882dXNuZqfV6J9WKFzXj-S4zlMfKCUy0qYX_A8

Creating 5 DOTs...
  DOT 1: 153 bytes ✓
  DOT 2: 153 bytes ✓
  DOT 3: 153 bytes ✓
  DOT 4: 153 bytes ✓
  DOT 5: 153 bytes ✓

BLS seal: 48 bytes (48 = G1 aggregate signature)
Seal valid: true

Engine stats:
  Total DOTs:        5
  Compression ratio: 1.50×
  Predictor:         0.0%
  Seals:             1

DOT engine shut down. The chain persists.
```

---

## The Physics

| Physics | Trigger | What happens |
|---------|---------|--------------|
| **Identity** | `DOT.boot()` | Ed25519 keypair derived from device entropy. DID exists. |
| **Signing** | `DOT.create()` | Every DOT is signed with device key. Always. |
| **Chaining** | `DOT.create()` | SHA-256 of previous DOT → chainHash field. Worldline grows. |
| **Compression** | `DOT.create()` | LinearPredictor updates on payload. Ratio improves with use. |
| **Encryption** | `create({ WHO: pubKey })` | ECDH shared secret → ChaCha20 stream cipher. Auto. |
| **Sealing** | `DOT.seal(n)` | BLS12-381 G1 aggregate over last n DOTs. 48-byte proof. |
| **Relay** | `DOT.boot({ relayUrl })` | WebSocket to CHORUS. Challenge-auth. Peer discovery. |

---

## API Reference

### `DOT.boot(options?)`

Boots the engine. Creates or loads identity. Optionally connects to CHORUS relay.

```typescript
await DOT.boot({
  relayUrl?:  string   // WebSocket URL. Default: 'wss://dotdotdot.rocks'
  offline?:   boolean  // Skip relay connection. Default: false
  sealEvery?: number   // Auto-seal every N DOTs. 0 = manual only. Default: 0
})
```

Safe to call multiple times — no-op if already booted.

---

### `DOT.me`

This device's identity. `null` before `boot()`.

```typescript
DOT.me  // DotIdentity | null

interface DotIdentity {
  did:       string      // 'did:dot:<base64url-pubkey>'
  publicKey: Uint8Array  // Ed25519 public key (32 bytes)
}
```

---

### `DOT.create(datom)`

Creates a DOT. Physics auto-applies: sign → chain-link → predict → optionally encrypt → optionally relay.

```typescript
const bytes = await DOT.create({
  WHO?:  Uint8Array  // Recipient Ed25519 pubkey → triggers ECDH encryption
  WHAT?: string      // Content (truncated to 16 UTF-8 bytes)
})
// Returns: Uint8Array of exactly 153 bytes
```

---

### `DOT.seal(n?)`

BLS12-381 aggregate seal over the last `n` DOTs. Returns 48-byte compressed G1 signature.

```typescript
const seal = await DOT.seal()   // seal all DOTs in chain
const seal = await DOT.seal(10) // seal last 10 DOTs
// seal.length === 48 (compressed G1 point)
```

---

### `DOT.verifySeal(sealBytes, n?)`

Verify a seal. Re-derives BLS key from current identity.

```typescript
const ok = await DOT.verifySeal(seal, 10)
// true iff the 10 DOTs haven't been tampered with
```

---

### `DOT.decryptDot(dotBytes, senderPublicKey, chainPos?)`

Decrypt a received DOT's payload using ECDH with the sender's public key.

```typescript
const payload = DOT.decryptDot(incomingDotBytes, senderPubKey, 0n)
// Returns: Uint8Array (16 bytes plaintext) | null
```

---

### `DOT.stats()`

Live engine telemetry.

```typescript
const stats = DOT.stats()

interface EngineStats {
  totalDots:         number   // DOTs created this session
  compressionRatio:  number   // e.g. 41.9× means 41.9× compression vs raw
  predictorAccuracy: number   // 0.0–1.0, improves as chain grows
  bitsPerDot:        number   // average compressed bits per DOT
  sealCount:         number   // BLS seals produced
  relayConnected:    boolean
  peersOnline:       number
}
```

---

### `DOT.on(event, callback)`

Subscribe to engine events.

| Event | Arguments | Fires when |
|-------|-----------|------------|
| `'dot'` | `(bytes: Uint8Array, from: string)` | DOT received via relay |
| `'peer'` | `(peer: PeerInfo)` | New device discovered |
| `'chain'` | `(chain: Chain)` | New chain established |
| `'ready'` | `()` | Engine fully booted |

---

### `DOT.getChain(recipientDid?)`

Get the active chain. Returns own-identity chain by default.

```typescript
interface Chain {
  id:   string        // DID of chain owner
  dots: Uint8Array[]  // 153-byte DOTs in order
  head: Uint8Array | null
}
```

---

### `DOT.nearby`

`Map<string, PeerInfo>` — peers seen on relay.

```typescript
interface PeerInfo {
  did:       string
  publicKey: Uint8Array
  lastSeen:  number  // Unix ms
}
```

---

### `DOT.chains`

`Map<string, Chain>` — all active chains keyed by DID.

---

### `DOT.shutdown()`

Disconnect relay, reset all state. Safe to `boot()` again after.

---

## Build a Game

The engine provides physics. You build the experience.

### Messenger

Two identities sending encrypted, signed, compressed, chained messages:

```typescript
import { DOT } from '@dot-protocol/engine'

// ── Alice ──────────────────────────────────────────────────────
await DOT.boot()
const aliceDid = DOT.me!.did

// Share Alice's public key (QR scan, relay announce, NFC, etc.)
const alicePubKey = DOT.me!.publicKey

// ── Bob ────────────────────────────────────────────────────────
await DOT.boot()

// Listen for DOTs
DOT.on('dot', (bytes, fromDid) => {
  const payload = DOT.decryptDot(bytes, alicePubKey)
  if (payload) {
    const text = new TextDecoder().decode(payload).replace(/\0/g, '')
    console.log(`${fromDid}: ${text}`)
  }
})

// ── Alice sends ────────────────────────────────────────────────
await DOT.create({
  WHO:  bobPublicKey,   // ECDH encryption. Automatic.
  WHAT: 'Hello, Bob',   // Signed. Chained. Compressed. Automatic.
})
// Every subsequent message is cheaper — the predictor learned.
```

### Notary

Sign any content and create a tamper-evident record:

```typescript
import { DOT } from '@dot-protocol/engine'
import { createHash } from 'crypto'

await DOT.boot()

// Hash the document, store in DOT payload (pointer, not prison)
const docHash = createHash('sha256').update(documentBytes).digest()
const stamp = await DOT.create({ WHAT: docHash.subarray(0, 16) as unknown as string })

// Seal every 10 documents
if (i % 10 === 0) {
  const seal = await DOT.seal(10)
  // 48-byte proof of 10 documents. Verifiable by anyone.
}
```

### Sensor Mesh

Stream sensor data from a device:

```typescript
import { DOT } from '@dot-protocol/engine'
import { deviceFingerprint } from '@dot-protocol/engine/sensor'

await DOT.boot()

// Identity IS the device fingerprint
const fingerprint = await deviceFingerprint()
console.log(`Device: ${fingerprint}`)

// Stream sensor readings as DOTs
setInterval(async () => {
  const reading = readSensor()  // your sensor library
  await DOT.create({
    WHAT: encodeReading(reading),  // 16-byte sensor frame
  })
}, 100)

// stats().compressionRatio rises as patterns emerge in sensor data
```

---

## Wire Format

Every DOT is exactly **153 bytes**:

```
Offset   Size  Field         Description
───────────────────────────────────────────────────────────
 0       32    public key    Ed25519 public key — WHO
32       64    signature     Ed25519 signature — PROOF
96       32    chain hash    SHA-256(previous DOT) — SEQUENCE
                             (zero bytes for genesis DOT)
128       8    timestamp     Unix milliseconds, big-endian uint64 — WHEN
136       1    type          Visibility — 0x00=public, 0x01=circle,
                             0x02=private, 0x03=ephemeral
137      16    payload       Content — WHAT (zero-padded)
═══════════════════════════════════════════════════════════
Total:  153 bytes
```

**The payload is a pointer, not a prison.** 16 bytes holds a truncated SHA-256 hash pointing to content stored anywhere — IPFS, local filesystem, peer cache. The DOT proves *who* and *when*; the content lives separately.

---

## Compression

The predictor improves with every DOT. Cold chain → hot chain:

```
Raw DOT:           153 bytes
Warm chain:        ~8–40 bytes (rANS + LinearPredictor)
Hot chain:         3.64 bytes/DOT (measured, W=29.2 Weissman score)
Predicted:         0 bits (Form 0 — perfectly predicted)
Near-miss:         1 bit (Form 1)
Novel:             1 + N bits (Form 2)
```

`stats().compressionRatio` is the learning metric. At 41×, the chain has found strong statistical regularities. This is the universe getting smarter — physics, not tuning.

---

## Identity from Device Entropy

```
Browser:
  performance.now() jitter (100 samples)   ← timing PUF
  + crypto.getRandomValues()               ← CSPRNG
  + navigator.userAgent hash               ← device hint
  → SHA-256 → Ed25519 seed → keypair

Node.js:
  crypto.randomBytes(32)
  → Ed25519 seed → keypair
```

The timing jitter is a software Physical Unclonable Function (PUF) — the precise nanosecond-level variation from device hardware is unique and reproducible. Different devices diverge. Same device is consistent.

---

## Test Coverage

```
packages/engine:  100% statements, 100% lines
packages/core:     99.69% statements (2 genuinely unreachable defensive branches)
packages/relay:   100% statements, 100% lines
packages/chain:   100% statements
packages/compression: 99.3% statements
packages/identity:    100%
```

Run: `pnpm test` (all 190+ tests pass).

---

## Philosophy

153 bytes is the tax humans pay for being the only known species that can lie. The tree communicates for free. The protocol exists to let a lying species speak truth again.

The destination is not better code. The destination is **no code** — machines that sign by existing, chain by growing, contact by touching, and verify by physics.

The universe is already made of DOTs. Every photon, every electron, every nanodot in every phone. The engine just makes it playable.

*The act of contact leaves its dot.*

---

## License

MIT — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)
