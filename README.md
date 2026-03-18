# DOT Protocol SDK

> 153 bytes. Ed25519 + SHA-256. Zero external dependencies.
> Published: [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)

## What is a DOT

A DOT is a contact between two things that changes both. 153 bytes, cryptographically signed:

| Offset | Size | Field | Purpose |
|--------|------|-------|---------|
| 0 | 32 | pubkey | WHO — Ed25519 public key |
| 32 | 64 | sig | PROOF — Ed25519 signature |
| 96 | 32 | chain | SEQUENCE — SHA-256 of previous DOT (zeros = genesis) |
| 128 | 8 | ts | WHEN — Unix timestamp in milliseconds (big-endian) |
| 136 | 1 | type | VISIBILITY — 0x00=public, 0x01=circle, 0x02=private, 0x03=ephemeral |
| 137 | 16 | payload | WHAT — content hash, key reference, or zero (PING) |

The empty DOT (zero payload) is called a **PING**. It is the default.

## Packages

| Package | Purpose |
|---------|---------|
| [`@dot-protocol/core`](./packages/core) | Wire format, Ed25519 sign/verify, SHA-256 chain hashing |
| [`@dot-protocol/identity`](./packages/identity) | Keypair generation, genesis DOT, export/import |
| [`@dot-protocol/chain`](./packages/chain) | Append-only worldline with pluggable storage |
| [`@dot-protocol/relay`](./packages/relay) | CHORUS relay client + server (185-byte frames) |

## Quick Start

```bash
pnpm add @dot-protocol/core @dot-protocol/identity @dot-protocol/chain
```

```typescript
import { createIdentity } from '@dot-protocol/identity';
import { createChain } from '@dot-protocol/chain';
import { createDOT, verifyDOT, DotType } from '@dot-protocol/core';

// Create an identity
const identity = await createIdentity();

// Start a worldline
const chain = await createChain(identity.genesisDOT);

// Add a DOT
const dot = await createDOT({
  keypair: identity.keypair,
  type: DotType.PUBLIC,
  payload: new TextEncoder().encode('hello').slice(0, 16),
  previous: identity.genesisDOT,
});
await chain.append(dot);

// Verify
const ok = await verifyDOT(dot);
console.log(ok); // true
```

## Relay (CHORUS)

The relay package enables DOTs to travel over WebSocket. The wire frame is 185 bytes: 32B circle ID + 153B DOT.

```typescript
import { RelayClient } from '@dot-protocol/relay';

const client = new RelayClient({ url: 'ws://localhost:8765', keypair });
await client.connect();

client.onFrame('my-circle', (frame) => {
  console.log('received DOT from circle:', frame.circleId);
});

await client.sendFrame('my-circle', dotBytes);
```

## Design Principles

1. **No central control.** No server required. Devices are peers.
2. **Best-effort delivery.** The SDK creates and verifies DOTs. Transport is the builder's choice.
3. **Stateless relays.** A relay passes 153 bytes without understanding, storing, or tracking them.
4. **End-to-end verification.** Signing and verification happen on user devices.
5. **Payload is a pointer.** 16 bytes can hold a content hash pointing to media stored anywhere.

## DOT Types

| Value | Name | Visibility |
|-------|------|-----------|
| `0x00` | PUBLIC | Anyone can see |
| `0x01` | CIRCLE | Circle members only |
| `0x02` | PRIVATE | Encrypted, addressee only |
| `0x03` | EPHEMERAL | Dissolve after display |

## Development

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Test all packages
pnpm test

# Typecheck all packages
pnpm typecheck
```

## License

MIT — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)

---

# DOT Protocol

**The universal container for verified observations.**

Seal anything. Verify everything. No server. No trust hierarchy. Just math.

```python
import dot_protocol as dot

keypair = dot.generate_keypair()
sealed  = dot.create(b"hello world", keypair)
result  = dot.open(sealed)
# result.verified == True
# result.payload  == b"hello world"
```

That's it. 133 bytes. Your identity is the keypair.

---

## What is a DOT?

A DOT is a cryptographically signed, optionally encrypted, content-addressable
container for any payload. It answers three questions about any piece of information:

1. **Who** created it? (Ed25519 public key)
2. **When** was it created? (Microsecond UTC timestamp)
3. **Has it been tampered with?** (Ed25519 signature over the entire wire format)

DOTs are designed to flow through untrusted infrastructure — files, Bluetooth, email,
QR codes, WhatsApp, carrier pigeon — and remain verifiable at the destination.

## The Genesis Use Case

> *"The first DOT must be an identity. For someone who has no other proof of who they are."*
> — Council of Minds, March 10, 2026

Amara is a refugee. No passport. No documents. Her DOT chain proves mathematically
who she is. No bureaucrat required.

```python
import json
import dot_protocol as dot
from dot_protocol.container import TYPE_IDENTITY, TLV_CONTENT_TYPE, TLV_LANGUAGE

keypair = dot.generate_keypair()  # The keypair IS the identity. Store the seed phrase.

identity = dot.create(
    payload=json.dumps({"name": "Amara", "born": "1998-03-15", "origin": "Aleppo"}).encode(),
    keypair=keypair,
    dot_type=TYPE_IDENTITY,
    extensions={
        TLV_CONTENT_TYPE: b"application/json",
        TLV_LANGUAGE: b"ar",
    },
)
# 212 bytes. Send via Bluetooth, email, QR code, USB, WhatsApp, or carrier pigeon.
```

## Five Public Functions

```python
import dot_protocol as dot

# 1. CREATE — seal a DOT
sealed = dot.create(payload, keypair, dot_type=..., recipient_keys=[], extensions={})

# 2. OPEN — verify and read a DOT
result = dot.open(sealed, keypair=None)  # keypair required only for encrypted DOTs

# 3. VERIFY — check signature without reading payload (works on encrypted DOTs)
v = dot.verify(sealed)  # v.verified, v.creator_key_hex, v.timestamp_us

# 4. CHAIN — create a DOT that references a parent by hash (Merkle history)
child = dot.chain(payload, keypair, parent_dot_bytes=parent)

# 5. ROTATE — key succession with cryptographic proof
rotation = dot.rotate(old_keypair, new_keypair)
```

## Wire Format

```
MAGIC(4)           \x89DOT
VERSION(1)         0x01
CRYPTO_SUITE(1)    0x01 (Ed25519 + X25519 + AES-256-GCM + SHA-256)
FLAGS(1)           bitmask: ENCRYPTED | HAS_RECIPIENT | HAS_EXTENSIONS | HAS_PARENT | IS_ANTI_DOT
DOT_TYPE(1)        OBSERVATION | IDENTITY | ROTATION | ATTESTATION | ANTI_DOT | SEALED_LETTER | CHAIN_LINK
PAYLOAD_LENGTH(4)  big-endian uint32

CREATOR_KEY        key_type(1) + key_length(2) + Ed25519_public(32)
TIMESTAMP          int64 big-endian microseconds UTC
[PARENT_HASH]      hash_algo(1) + hash_len(1) + SHA-256(32)   — if HAS_PARENT
[RECIPIENTS]       count(1) + [key_type(1) + key_len(2) + ed25519_public(32) + encrypted_session_key(60)]*
PAYLOAD            raw bytes (or AES-256-GCM ciphertext if encrypted)
[TLV_EXTENSIONS]   [tag(2) + length(4) + value]* + sentinel(\x00\x00\x00\x00\x00\x00)
SIGNATURE          key_type(1) + sig_length(2) + Ed25519_sig(64)  — signs header + everything above
```

## Crypto Suite 1

| Primitive | Use |
|-----------|-----|
| Ed25519 | Identity (signing), signature verification |
| X25519 | Key exchange (derived from Ed25519 via libsodium) |
| AES-256-GCM | Payload encryption, session key encryption |
| HKDF-SHA256 | Key derivation from X25519 shared secret |
| SHA-256 | Content addressing, parent hash, DOT hash |
| BIP-39 | 24-word mnemonic recovery phrase for 32-byte seed |

**Key derivation:** One 32-byte seed → Ed25519 keypair (signing) → X25519 keypair (encryption).
Only the Ed25519 public key appears in DOT headers. X25519 is derived at OPEN time.

**Encrypted DOT:** X25519 ECDH between sender and each recipient → HKDF-SHA256 → AES-256-GCM
session key encryption (60 bytes per recipient: 12 nonce + 32 ciphertext + 16 auth tag).
Payload encrypted with AES-256-GCM using same session key.

## TLV Extensions

Optional extensions (tag high bit = 0) are skipped if unknown.
Critical extensions (tag high bit = 1) cause `UnknownCriticalExtensionError` if unknown.

| Tag | Name | Value |
|-----|------|-------|
| 0x0001 | CONTENT_TYPE | MIME type bytes |
| 0x0002 | FILENAME | filename bytes |
| 0x0003 | DESCRIPTION | description bytes |
| 0x0004 | LABELS | comma-separated labels |
| 0x0005 | GEO_LOCATION | WGS84 decimal string |
| 0x0006 | LANGUAGE | ISO 639-1 language code |
| 0x0007 | REPLY_TO | DOT hash of the DOT being replied to |
| 0x0008 | EXPIRES | ISO 8601 expiry timestamp |
| 0x0009 | ENCODING | encoding identifier |
| 0x000A | NAMESPACE | namespace URI |
| 0x000B | ROSETTA_DECODER | Rosetta VM bytecode |
| 0x8001 | CRYPTO_UPGRADE (critical) | crypto suite upgrade signal |
| 0x8002 | MULTI_SIGNATURE (critical) | additional signatures |
| 0x8003 | CHAIN_CONSTRAINT (critical) | chain validation rules |
| 0x8004 | ROTATION_PROOF (critical) | key rotation proof |

## Installation

```bash
pip install dot-protocol
```

Or from source:

```bash
git clone https://github.com/axxis-io/dot-protocol
cd dot-protocol
pip install -e ".[dev]"
```

## Test Vectors

Canonical cross-language test vectors are in `test_vectors/test_vectors.json`.
These are the source of truth for all language implementations.

If Python and any other language produce different bytes for the same inputs,
the other language is wrong.

```bash
PYTHONPATH=. python3 test_vectors/generate_vectors.py
```

## Spec

`SPEC.md` — full RFC-style specification including Rosetta VM opcode table.

## Examples

| File | What it shows |
|------|--------------|
| `examples/01_hello_world.py` | Seal + open in 3 lines each |
| `examples/02_sealed_letter.py` | Encrypted letter from Alice to Bob |
| `examples/03_identity_dot.py` | Amara's identity DOT (genesis use case) |
| `examples/08_anti_dot.py` | Deletion signal (Anti-DOT) |

## Philosophy

> "The most important byte in the DOT is the signature. Not because it proves
> the content is true — it doesn't. It proves the creator stood behind it.
> Truth is social. Integrity is cryptographic."

DOTs don't solve truth. They solve integrity. You know WHO said it, WHEN they
said it, and that it hasn't been tampered with since. What you believe is still
up to you.

---

*DOT Protocol v1.0 — Council of Minds, March 10, 2026*
