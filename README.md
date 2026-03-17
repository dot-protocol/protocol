## Build 1 — iPhone DOT Web App

Single-file PWA. Run on any phone with a browser. No install. No app store.

**Files:** `dot_app.html` · `dot_core.js` · `sw.js`

### Setup

```bash
cd projects/dot-protocol
# For local desktop testing:
python3 -m http.server 8080
# Open: http://localhost:8080/dot_app.html

# For phone testing (HTTPS required for sensors on iOS):
npx serve --ssl --listen 8080 .
# Or: ngrok http 8080
```

### Test on 3 phones simultaneously

1. Serve files from a machine on your local network (or use ngrok/Vercel dev for HTTPS)
2. Open `dot_app.html` on 3 phones — each generates its own keypair on first launch
3. Each phone creates its genesis DOT on first "Begin" tap
4. **Connect two phones:**
   - Phone A: tap "Connect" tab → shows blue offer QR
   - Phone B: tap "Connect" → tap "Scan Peer QR" → scan Phone A's QR → shows green answer QR
   - Phone A: tap "Scan Peer QR" → scan Phone B's green QR → "connected" ✓
5. Repeat steps 4 for Phone C connecting to either A or B

### Expected output

- Each phone has unique public key (64 hex chars)
- Genesis DOT: chain field = 32 zero bytes
- Each "● DOT" tap creates a signed 153-byte DOT
- DOTs appear on peer's Connect screen within 1–2 seconds
- Chain verify passes 100% at all times

### Verify chain integrity (browser console)

```javascript
import('./dot_core.js').then(async ({ openDotDB, dbLoadChain, checkChain }) => {
  const db = await openDotDB();
  const chain = await dbLoadChain(db);
  const result = await checkChain(chain);
  console.log(`Chain: ${chain.length} DOTs, valid: ${result.valid}`);
});
```

### Run tests (Node.js)

```bash
node test_dot_core.mjs
# Expected: 136/136 PASS
```

### v2 trigger condition

After Build 1 produces a verified chain of **10+ DOTs on a physical device**, chain verification passes 100%, and at least one DOT is shared P2P to a second device → open the DOT Protocol v2 track (coordinated security pass across Python lib, ESP32 firmware, and web app).

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
