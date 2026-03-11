# DOT Protocol Specification
## Version 1.0 — Canonical

**Status:** Final
**Locked:** Round 155, Council of Minds, March 10, 2026
**Reference implementation:** Python (`dot_protocol/`)
**Canonical test vectors:** `test_vectors/test_vectors.json`

---

> "The act of observation leaves its dot."

---

## 0. Reconciliation Note

`state_transfer_v7.md` (Rounds 149-154) described an earlier wire format.
The following values from that document are **retired** as of Round 155:

| Field | state_transfer_v7 | This spec (canonical) | Decision |
|-------|------------------|-----------------------|---------|
| Hashing for chain | BLAKE3 | SHA-256 | Round 155: SHA-256 is battle-tested, no extra dependency |
| Header size | 10 bytes (with TLV_count) | 12 bytes (no TLV_count) | TLV_count removed; count implicit from sentinel |
| FLAGS field | 2 bytes | 1 byte | 1 byte sufficient for v1 flags |
| TLV length | 2 bytes | 4 bytes | 4-byte length allows payloads >65KB |
| IDENTITY type byte | 0x01 | 0x02 | OBSERVATION is the default type, gets 0x01 |
| OBSERVATION type byte | 0x02 | 0x01 | See above |

Everything in this document supersedes state_transfer_v7.

---

## 1. What is a DOT?

A DOT is a cryptographically signed, optionally encrypted, content-addressable
container for any payload. It is a **file format**, not an app — like `.pdf`,
`.git`, or `.zip`. The ecosystem builds on top.

A DOT answers three questions about any piece of information:

1. **Who** created it? (Ed25519 public key = creator identity)
2. **When** was it created? (Microsecond UTC timestamp)
3. **Has it been tampered with?** (Ed25519 signature over the entire wire format)

DOTs are designed to survive untrusted infrastructure — files, Bluetooth, email,
QR codes, WhatsApp — and remain verifiable at the destination.

**Two human operations:** SEAL (create) and OPEN (verify).
**Five library functions:** `create`, `open`, `verify`, `chain`, `rotate`.
**Zero server required.**

---

## 2. Wire Format

### 2.1 Overview

```
DOT = HEADER + BODY + SIGNATURE
```

The signature covers `HEADER + BODY`. The signature section is always last.

### 2.2 HEADER (12 bytes, fixed)

```
Offset  Size  Field           Value
0       4     MAGIC           \x89DOT  (0x89 0x44 0x4F 0x54)
4       1     VERSION         0x01
5       1     CRYPTO_SUITE    0x01
6       1     FLAGS           bitmask (see §2.3)
7       1     DOT_TYPE        see §2.4
8       4     PAYLOAD_LENGTH  uint32 big-endian, length of PAYLOAD section in bytes
```

**MAGIC:** `\x89DOT`. The high byte `\x89` mirrors PNG's convention — it guards
against 7-bit ASCII stripping in legacy transport. If magic bytes don't match,
reject immediately. Do not attempt to decode.

**VERSION:** Must be `0x01` for this spec. Decoders that receive a higher version
MUST emit `UnsupportedVersionError`. A v1 decoder cannot safely decode v2 DOTs.

**CRYPTO_SUITE:** Must be `0x01` for this spec. See §4.

**PAYLOAD_LENGTH:** Length of the payload bytes in the PAYLOAD section.
For encrypted DOTs, this is the length of the ciphertext (nonce + ciphertext + tag),
not the plaintext.

### 2.3 FLAGS Byte

```
Bit 0 (0x01)  ENCRYPTED      Payload is AES-256-GCM encrypted
Bit 1 (0x02)  HAS_RECIPIENT  RECIPIENTS section is present
Bit 2 (0x04)  HAS_EXTENSIONS TLV_EXTENSIONS section is present
Bit 3 (0x08)  HAS_PARENT     PARENT_HASH section is present
Bit 4 (0x10)  IS_ANTI_DOT    This DOT is a deletion signal
Bit 5 (0x20)  IS_ROSETTA     Payload contains Rosetta VM bytecode (Phase 3)
Bits 6-7      Reserved       MUST be zero in v1; decoders MUST ignore
```

`ENCRYPTED` and `HAS_RECIPIENT` always appear together. A DOT cannot be
encrypted without recipients (there would be no one who could open it).

### 2.4 DOT_TYPE Byte

```
0x01  OBSERVATION    A signed observation (the default type)
0x02  IDENTITY       Declares an observer exists (genesis is always this type)
0x03  ROTATION       Key succession from old keypair to new keypair
0x04  ATTESTATION    Attests to a fact about another DOT or entity
0x05  ANTI_DOT       Deletion signal; payload = SHA-256 of target DOT
0x06  SEALED_LETTER  Encrypted message to specific recipient(s)
0x07  CHAIN_LINK     Explicitly links to a parent DOT
0x0D  INDEX          Content-addressed lookup table for DOT hashes (see §2.8)
```

When `IS_ANTI_DOT` flag is set, DOT_TYPE is forced to `0x05`.

### 2.5 BODY (variable)

The body follows the header immediately and contains these sections in order:

```
CREATOR_KEY_SECTION  (always present)
TIMESTAMP_SECTION    (always present)
[PARENT_HASH_SECTION] (if HAS_PARENT flag set)
[RECIPIENTS_SECTION]  (if HAS_RECIPIENT flag set)
PAYLOAD_SECTION      (always present, length = PAYLOAD_LENGTH from header)
[TLV_EXTENSIONS]     (if HAS_EXTENSIONS flag set)
```

#### 2.5.1 CREATOR_KEY_SECTION

```
KEY_TYPE    1 byte   0x01 = Ed25519
KEY_LENGTH  2 bytes  uint16 big-endian (always 32 for Suite 1)
PUBLIC_KEY  32 bytes Ed25519 public key — this IS the creator's identity
```

Only Ed25519 public keys appear in DOT headers. X25519 keys are derived
at OPEN time (see §4.2). This saves 32 bytes per DOT.

#### 2.5.2 TIMESTAMP_SECTION

```
TIMESTAMP   8 bytes  int64 big-endian, microseconds since Unix epoch (UTC)
```

Negative timestamps are invalid. Maximum value: 9_223_372_036_854_775_807
(year 292,277 — safely future-proof).

#### 2.5.3 PARENT_HASH_SECTION (optional)

Present when `HAS_PARENT` flag is set.

```
HASH_ALGO   1 byte   0x01 = SHA-256
HASH_LEN    1 byte   32 (length of the hash that follows)
HASH        32 bytes SHA-256(parent_dot_bytes)
```

The hash is computed over the complete parent DOT bytes (header + body + signature).
This creates a Merkle chain of verifiable history. See `dot.chain()`.

#### 2.5.4 RECIPIENTS_SECTION (optional)

Present when `HAS_RECIPIENT` flag is set. Maximum 255 recipients.

```
COUNT       1 byte   number of recipient entries (1-255)

For each recipient:
  KEY_TYPE           1 byte   0x01 = Ed25519
  KEY_LENGTH         2 bytes  uint16 big-endian (always 32 for Suite 1)
  PUBLIC_KEY         32 bytes recipient's Ed25519 public key
  ENCRYPTED_SK       60 bytes encrypted session key:
                              NONCE(12) + AES-256-GCM(session_key)(32) + AUTH_TAG(16)
```

Each recipient entry is 95 bytes (1 + 2 + 32 + 60 = 95).

#### 2.5.5 PAYLOAD_SECTION

```
PAYLOAD     PAYLOAD_LENGTH bytes  raw bytes (or AES-256-GCM ciphertext if encrypted)
```

For encrypted DOTs, the payload is laid out as:
```
NONCE       12 bytes  AES-256-GCM nonce (random, per-DOT)
CIPHERTEXT  (PAYLOAD_LENGTH - 28) bytes  encrypted plaintext
AUTH_TAG    16 bytes  AES-256-GCM authentication tag
```
So PAYLOAD_LENGTH = 12 + len(plaintext) + 16 for encrypted DOTs.

#### 2.5.6 TLV_EXTENSIONS (optional)

Present when `HAS_EXTENSIONS` flag is set.

```
For each extension:
  TAG     2 bytes  uint16 big-endian
  LENGTH  4 bytes  uint32 big-endian
  VALUE   LENGTH bytes

Sentinel (terminates the extension list):
  TAG     2 bytes  0x0000
  LENGTH  4 bytes  0x00000000
```

**Must-understand bit:** If `TAG & 0x8000 != 0`, the extension is **critical**.
Decoders that don't recognize a critical tag MUST raise `UnknownCriticalExtensionError`.
Decoders that don't recognize an optional tag (high bit clear) MUST silently skip it.

### 2.6 SIGNATURE_SECTION (67 bytes, fixed)

```
SIG_TYPE    1 byte   0x01 = Ed25519
SIG_LENGTH  2 bytes  uint16 big-endian (always 64 for Suite 1)
SIGNATURE   64 bytes Ed25519 signature over (HEADER + BODY)
```

The signature covers everything before this section. The signed bytes are
`dot_bytes[:signature_section_start]`.

### 2.7 Minimum DOT Size

Suite 1, no encryption, no parent, no extensions, 1-byte payload:

```
HEADER              12 bytes
CREATOR_KEY_SECTION 35 bytes  (1 + 2 + 32)
TIMESTAMP_SECTION    8 bytes
PAYLOAD_SECTION      1 byte   (minimum meaningful payload)
SIGNATURE_SECTION   67 bytes  (1 + 2 + 64)
─────────────────────────────
MINIMUM             123 bytes
```

Observed minimum in practice: **133 bytes** (with `b"hello world"` payload, 11 bytes).
Feynman estimated 122 bytes — correct for 1-byte payload, 1 byte under for overhead.

### 2.8 INDEX DOT (type 0x0D)

Added in EXP-38 (March 2026). INDEX DOTs are content-addressed lookup tables
for sets of DOT hashes. They enable sub-millisecond queries over large DOT corpora
without full scans.

**Wire format:** Standard DOT wire format with `DOT_TYPE = 0x0D`.
No new header fields. Payload is a UTF-8 JSON object.

**Payload format:**

```json
{
  "kind": "relation_index" | "content_index" | "observer_index" | "<custom>",
  "version": 1,
  "shard": 0,
  "total_shards": 1,
  "entries": {
    "<key>": ["<dot_hash_hex>", "..."]
  }
}
```

**Fields:**

- `kind`: The index type. Defined kinds: `relation_index` (target_hash → relation DOTs),
  `content_index` (keyword → matching DOTs), `observer_index` (pubkey → their DOTs).
  Custom kinds are allowed.
- `version`: Always `1` for this spec.
- `shard` / `total_shards`: For large indexes, split across multiple INDEX DOTs.
  Clients must fetch all shards for a complete index.
- `entries`: Map of lookup key → list of DOT hash hex strings.

**Producer:** Any observer. The INDEX DOT is signed by its creator's keypair.
Clients should weight index trust by the creator's chain age and reputation.

**Consumer:** Clients query INDEX DOTs to resolve hashes without full-corpus scan.

**Sharding rule:** When a single INDEX DOT payload exceeds **1 MB**, split by
hash prefix (first N hex chars of the key) or timestamp range. Each shard is
an independent INDEX DOT pointing to the same `kind` and `total_shards` count.

**Performance (EXP-38, 150K DOT corpus):**

```
relation_index:  181x speedup vs full scan
observer_index:  2,595x speedup vs full scan
content_index:   5,484x speedup vs full scan
```

---

## 3. TLV Extension Tags

### 3.1 Optional Tags (safe to skip if unknown)

| Tag (hex) | Tag (decimal) | Name | Value Format |
|-----------|---------------|------|-------------|
| `0x0001` | 1 | CONTENT_TYPE | MIME type as ASCII bytes (e.g., `text/plain`) |
| `0x0002` | 2 | FILENAME | Filename as UTF-8 bytes |
| `0x0003` | 3 | DESCRIPTION | Description as UTF-8 bytes |
| `0x0004` | 4 | LABELS | Comma-separated labels as ASCII bytes |
| `0x0005` | 5 | GEO_LOCATION | WGS84 decimal string (e.g., `13.0827,80.2707`) |
| `0x0006` | 6 | LANGUAGE | ISO 639-1 language code as ASCII bytes (e.g., `ar`, `en`) |
| `0x0007` | 7 | REPLY_TO | SHA-256 hash of the DOT being replied to (32 bytes, binary) |
| `0x0008` | 8 | EXPIRES | ISO 8601 expiry timestamp as ASCII bytes |
| `0x0009` | 9 | ENCODING | Encoding identifier as ASCII bytes (e.g., `base64`) |
| `0x000A` | 10 | NAMESPACE | Namespace URI as ASCII bytes |
| `0x000B` | 11 | ROSETTA_DECODER | Rosetta VM bytecode (see §6) |

### 3.2 Critical Tags (decoder MUST understand or reject)

| Tag (hex) | Tag (decimal) | Name | Value Format |
|-----------|---------------|------|-------------|
| `0x8001` | 32769 | CRYPTO_UPGRADE | Signals mandatory crypto upgrade; value = new suite ID |
| `0x8002` | 32770 | MULTI_SIGNATURE | Additional signatures; value = packed sig entries |
| `0x8003` | 32771 | CHAIN_CONSTRAINT | Chain validation rules; value = constraint bytecode |
| `0x8004` | 32772 | ROTATION_PROOF | Key rotation proof (redundant with ROTATION type; reserved) |

---

## 4. Cryptographic Suite 1

**Suite ID:** `0x01`
**Algorithms:** Ed25519 + X25519 + AES-256-GCM + HKDF-SHA256 + SHA-256

### 4.1 Key Generation

```
INPUT:  32-byte seed (cryptographically random, or BIP-39 derived)
OUTPUT: KeyPair

Ed25519 keypair = nacl.signing.SigningKey(seed)
  ed25519_private = bytes(signing_key)         # 64 bytes (libsodium: seed || public)
  ed25519_public  = bytes(signing_key.verify_key)  # 32 bytes — THIS IS THE IDENTITY

X25519 keypair (derived from Ed25519, libsodium standard):
  x25519_private = bytes(signing_key.to_curve25519_private_key())  # 32 bytes
  x25519_public  = bytes(x25519_key.public_key)                    # 32 bytes
```

**Implementation note:** Do NOT use `nacl.bindings.crypto_sign_ed25519_sk_to_curve25519()`.
In PyNaCl 1.6.2, `bytes(signing_key)` returns the 32-byte seed (not the 64-byte libsodium sk),
causing an "Invalid curve secret key" error. Use `signing_key.to_curve25519_private_key()`.

**Recovery:** The 32-byte seed encodes as a BIP-39 24-word mnemonic phrase.
From 24 words → seed → all keys. One phrase. One identity. Forever.

### 4.2 Public Key Derivation

Readers can derive a sender's X25519 public key from their Ed25519 public key:

```python
x25519_public = nacl.bindings.crypto_sign_ed25519_pk_to_curve25519(ed25519_public)
```

This is why only Ed25519 public keys appear in DOT headers — X25519 is derivable.

### 4.3 Signing

Ed25519 signing (RFC 8032):

```
SIGNED_BYTES = HEADER + BODY  (everything before SIGNATURE_SECTION)
SIGNATURE    = Ed25519_sign(SIGNED_BYTES, ed25519_private_key)  # 64 bytes
```

### 4.4 Verification

```
verified = Ed25519_verify(SIGNED_BYTES, SIGNATURE, creator_ed25519_public)
```

If `verified == False`: reject the DOT. Do not process the payload. Do not cache.

**Experiment 2 result (March 10, 2026):**
- 1,000 DOTs tested (900 clean, 100 tampered)
- Detection rate: **100.0%** (100/100 tampered DOTs caught)
- False positive rate: **0.00%** (0/900 clean DOTs wrongly flagged)
- All four tamper types detected: payload bit-flip, timestamp modify, signature alter, parent_hash swap
- Throughput: **1,755 verifications/second** (Python reference implementation, Apple Silicon)

### 4.5 Session Key Encryption (for sealed DOTs)

When encrypting for one or more recipients:

1. Generate a random 32-byte session key: `session_key = os.urandom(32)`

2. Encrypt the session key for each recipient:
   ```
   a. Derive recipient's X25519 public key from their Ed25519 public key (see §4.2)
   b. X25519 ECDH: shared_secret = DH(sender_x25519_private, recipient_x25519_public)
   c. HKDF-SHA256: aes_key = HKDF(shared_secret, length=32, info=b"DOT-v1-session")
   d. AES-256-GCM: encrypted_sk = NONCE(12) || AES_GCM(aes_key, session_key) || TAG(16)
   ```
   Result: 60 bytes per recipient (12 nonce + 32 ciphertext + 16 auth tag)

3. Encrypt the payload:
   ```
   payload_nonce = os.urandom(12)
   encrypted_payload = payload_nonce || AES_GCM(session_key, plaintext) || TAG(16)
   ```

### 4.6 Session Key Decryption

Recipient opens a sealed DOT:

1. Find recipient entry matching `keypair.ed25519_public` in RECIPIENTS_SECTION
2. Derive X25519 from own Ed25519 keypair (see §4.1)
3. X25519 ECDH: `shared_secret = DH(recipient_x25519_private, sender_x25519_public)`
4. HKDF-SHA256 with same context `b"DOT-v1-session"` → `aes_key`
5. AES-256-GCM decrypt: `plaintext = AES_GCM_decrypt(aes_key, nonce, ciphertext, tag)`

### 4.7 Content Addressing

```
dot_hash = SHA-256(complete_dot_bytes)
```

The hash covers header + body + signature. This is the DOT's address in the
content-addressable sense. Used in PARENT_HASH_SECTION and Anti-DOT payload.

---

## 5. The Five Operations

### 5.1 `create(payload, keypair, **kwargs) → bytes`

Creates a DOT. The minimal call:

```python
dot_bytes = create(payload=b"hello", keypair=my_keypair)
```

Full signature:
```python
create(
    payload: bytes,              # required
    keypair: KeyPair,            # required
    dot_type: int = OBSERVATION, # DOT_TYPE byte
    recipient_keys: List[bytes], # Ed25519 public keys to encrypt for
    extensions: Dict[int, bytes],# TLV extensions
    parent: bytes,               # parent DOT bytes (not hash — hash is computed internally)
    timestamp_us: int,           # microseconds UTC (default: now)
    is_anti_dot: bool,           # if True, forces DOT_TYPE = ANTI_DOT
)
```

### 5.2 `open(dot_bytes, keypair=None) → DotResult`

Verifies signature and optionally decrypts payload.

- Raises `InvalidMagicError` if not a DOT
- Raises `UnsupportedVersionError` if version > 1
- Raises `SignatureVerificationError` if tampered
- Raises `NotAddressedToYouError` if encrypted and not your DOT
- Raises `UnknownCriticalExtensionError` if unknown critical TLV tag

Returns `DotResult`:
```
payload          bytes     decrypted plaintext
creator_key      bytes     Ed25519 public key (32 bytes)
creator_key_hex  str
timestamp_us     int       microseconds UTC
dot_type         int
dot_type_name    str       e.g., "OBSERVATION"
verified         bool      always True (raises on False)
encrypted        bool
parent_hash      bytes     SHA-256 of parent DOT (if HAS_PARENT)
extensions       dict      tag → value
dot_hash         bytes     SHA-256 of this DOT
```

### 5.3 `verify(dot_bytes) → VerifyResult`

Signature check without decrypting payload. Works on encrypted DOTs.
Never raises — returns `verified=False` on failure.

Use this when you want to know WHO created a DOT and WHEN, without
needing to read the contents.

### 5.4 `chain(payload, keypair, parent_dot_bytes, **kwargs) → bytes`

Creates a DOT that references a parent by hash (SHA-256 of parent bytes).
Calls `verify(parent_dot_bytes)` first — refuses to chain from an invalid parent.
Sets `HAS_PARENT` flag and writes PARENT_HASH_SECTION.

### 5.5 `rotate(old_keypair, new_keypair, timestamp_us=None) → bytes`

Creates a key rotation DOT proving succession:
- Signed by the **new** key (new key IS the creator)
- Payload: JSON `{old_public_key, new_public_key, rotation_proof}`
- `rotation_proof` = Ed25519 signature of `new_public_key` bytes by `old_private_key`

Verification procedure for a rotation DOT:
1. Check `creator_key == new_public_key`
2. Parse payload JSON
3. Verify `rotation_proof` with `old_public_key` over `new_public_key` bytes

---

## 6. Anti-DOT

An Anti-DOT is a deletion signal. It tells relay nodes to tombstone the target DOT.

**Payload:** 32 raw bytes = SHA-256 of the target DOT's complete bytes (not hex).

**Creator:** Must be the same Ed25519 key as the target DOT's creator for relay
nodes to honor the signal. (Note: relay enforcement of this is a Layer 2 concern;
Layer 1 — this spec — does not enforce creator matching.)

**Amplification:** The 1.237× amplification factor is a Layer 2 empirical property
of the trust graph. Layer 1 carries only the tombstone signal.

**What deletion means:** "Please stop propagating this." The original bytes remain
content-addressable forever. DOT does not support true erasure — only retraction.

---

## 7. Key Rotation

Key rotation is the process by which a new identity key succeeds an old one.

```
alice_old → alice_new
```

The rotation DOT is:
- **Signed by alice_new** — proves alice_new can sign
- **Payload contains rotation_proof** — Ed25519 sig by alice_old over alice_new's public key

Anyone with alice_old's public key (which is their identifier) can verify that
the holder of alice_old deliberately authorized this transition.

**After rotation:** New DOTs are signed by alice_new. The rotation DOT anchors
the chain of identity. Old DOTs remain valid — they were correctly signed at creation time.

---

## 8. Identity DOTs

An IDENTITY DOT (type `0x02`) declares that an observer exists.

The genesis DOT is always an IDENTITY DOT. Subsequent IDENTITY DOTs may add
attributes or establish presence on a new relay.

**The genesis use case:**

> Amara is a refugee. No passport. No documents. Her DOT chain proves
> mathematically who she is. No bureaucrat required.

```python
identity = create(
    payload=json.dumps({"name": "Amara", "born": "1998-03-15", "origin": "Aleppo"}).encode(),
    keypair=keypair,
    dot_type=TYPE_IDENTITY,
    extensions={
        TLV_CONTENT_TYPE: b"application/json",
        TLV_LANGUAGE: b"ar",
    },
)
# 212 bytes. Send via Bluetooth, email, QR, SMS, WhatsApp, or carrier pigeon.
```

---

## 9. Content Addressing and Hashing

Every DOT has a canonical hash: `SHA-256(complete_dot_bytes)`.

This hash IS the DOT's address. It is:
- Used in PARENT_HASH_SECTION to link chain elements
- Used in Anti-DOT payload to identify the target
- Used by relay nodes to deduplicate
- Used by any caching layer to retrieve DOTs

**The genesis DOT hash** (from v1 reference implementation):
```
419f103f0534c3c8929b26de8208702bdae6977d52041fc54609dfa3fdc5898c
```

---

## 10. Build Phases

### Phase 1: Files (COMPLETE)
- Python reference implementation
- Five public functions: create, open, verify, chain, rotate
- Canonical test vectors (`test_vectors/test_vectors.json`)
- Genesis DOT (`genesis.dot`)
- CLI: `dot seal` and `dot open` (pending)

### Phase 2: Relays (NEXT)
- Nostr bridge: DOTs as Nostr events (kind 1337)
- Simple relay protocol over HTTP/WebSocket
- DOT hash as Nostr event ID

### Phase 3: Mesh (LATER)
- BLE mesh networking
- Rosetta VM (see §11)
- Offline-first P2P sync

---

## 11. Rosetta VM (Phase 3 — Do Not Build Yet)

The Rosetta VM is a minimal, deterministically-terminating stack machine embedded
in a DOT (via the `ROSETTA_DECODER` TLV extension) that can validate, transform,
or describe its own contents.

Named for the Rosetta Stone — a self-describing artifact readable across languages
and centuries.

**Design:** Council of Minds, Round 155 (Turing's contribution)

### 11.1 Properties

- **20 opcodes** — Forth-like stack machine
- **Forward-only jumps** — guarantees termination (no infinite loops possible)
- **65,536 instruction limit** — hard ceiling on execution
- **No I/O** — no external calls; input/output is DOT bytes only
- **No memory** — only the stack and DOT bytes
- **Deterministic** — same input always produces same output

### 11.2 Opcode Table

```
0x00  NOP          No operation
0x01  PUSH u16     Push 2-byte unsigned int onto stack
0x02  POP          Discard top of stack
0x03  DUP          Duplicate top of stack
0x04  SWAP         Swap top two stack elements
0x05  ADD          Pop a, b; push a+b (mod 2^16)
0x06  SUB          Pop a, b; push a-b (mod 2^16)
0x07  AND          Pop a, b; push a & b (bitwise)
0x08  OR           Pop a, b; push a | b (bitwise)
0x09  XOR          Pop a, b; push a ^ b (bitwise)
0x0A  EQ           Pop a, b; push 1 if a==b else 0
0x0B  LT           Pop a, b; push 1 if a<b else 0
0x0C  JMP_FWD u16  Jump forward N instructions (from current position)
0x0D  JMP_IF u16   Pop condition; if truthy, jump forward N instructions
0x0E  LOAD u16     Load DOT byte at offset; push value (0-255)
0x0F  STORE u16    Pop value; write to DOT output buffer at offset
0x10  HASH_DOT     Compute SHA-256 of DOT bytes; push first 2 bytes of hash
0x11  VERIFY_SIG   Verify signature section; push 1 if valid else 0
0x12  EMIT u8      Write literal byte to output buffer
0x13  RETURN       Halt execution; return top of stack as result code
```

Opcodes `0x14`-`0xFF` are reserved. Encountering an unknown opcode MUST halt
execution with a fatal error.

### 11.3 Execution Model

- Stack: 256 elements max, each 16-bit unsigned integer
- Program counter: starts at 0, advances per opcode
- Instruction limit: 65,536 (halt with error if exceeded)
- Jump semantics: forward-only. `JMP_FWD 5` jumps 5 positions ahead. Backward jumps are rejected at parse time.
- Input: complete DOT bytes as a byte array
- Output: byte buffer populated by `STORE` and `EMIT` instructions

### 11.4 Use Cases (Phase 3)

- Self-describing DOTs that explain their own structure in any language
- Credential verification programs embedded in identity DOTs
- Chain validation rules
- The Quine DOT (Experiment 6): a DOT whose Rosetta program validates itself

---

## 12. Experiment Results

### Experiment 1: Genesis DOT (March 10, 2026)

```
Hash:    419f103f0534c3c8929b26de8208702bdae6977d52041fc54609dfa3fdc5898c
Key:     3dc34ef424e3ba05b410e34874d61497590ba22d69a76b19536f6781597f7801
Size:    398 bytes
Payload: {"protocol":"DOT","version":"1.0","genesis":true,...}
```

DOT became real when `genesis.dot` was sealed.
Bitcoin became real when the genesis block was mined.

### Experiment 2: Integrity Prism (March 10, 2026)

1,000 DOTs generated (900 clean, 100 tampered).

| Tamper Type | Caught | Missed |
|-------------|--------|--------|
| Payload bit-flip | 25/25 | 0 |
| Timestamp modify | 25/25 | 0 |
| Signature alter | 25/25 | 0 |
| Parent hash swap | 25/25 | 0 |
| **Total** | **100/100** | **0** |

Detection rate: **100.0%**. False positive rate: **0.00%**.
Throughput: **1,755 verifications/second** (Python, Apple Silicon).

### Experiment 3: Minimum Viable DOT

Measured minimum (v1 reference implementation): **133 bytes** (with `b"hello world"` payload).

| Format | Bytes | Includes signature? | Includes public key? |
|--------|-------|---------------------|----------------------|
| DOT v1 | 133 | ✅ 64B Ed25519 | ✅ 32B |
| JWT (HS256) | ~120 | ✅ 32B HMAC | ❌ (shared secret) |
| JWT (RS256) | ~400 | ✅ 256B RSA | ❌ (out-of-band) |
| Protobuf (equiv fields) | ~80 | ❌ | ❌ |
| Bitcoin tx (minimal) | ~190 | ✅ 64B ECDSA | ✅ 33B (compressed) |

DOT carries more intrinsic data than JWT or protobuf because it includes
both the signature AND the public key (no PKI lookup required).

### Experiment 4: Cold Open (March 10, 2026)

A fresh Claude instance (zero context, zero system prompt) received 182 bytes of
DOT hex and the question: "What is this file?"

**Results:**
- ✅ Magic bytes `\x89DOT` identified immediately, PNG convention recognized
- ✅ Content length field (38 bytes) precisely decoded
- ✅ Payload text extracted verbatim: *"The act of observation leaves its dot."*
- ✅ 32-byte field identified as Ed25519 public key
- ✅ 64-byte field identified as Ed25519 signature
- ✅ MIME type `text/plain` decoded from TLV section
- ⚠️ Timestamp bytes partially misidentified (read as "MAC-style nonce")
- ⚠️ FLAGS and DOT_TYPE bytes identified as "unknown" (no semantic interpretation)
- ⚠️ TLV structure not fully parsed (sentinel not recognized)

**Overall identification: ~75-80% correct from zero context.**

The Göbekli Tepe criterion passes. Magic bytes are immediately recognizable.
The format is substantially self-describing from first principles.

---

## 13. Design Principles

**Emissive, not defensive.** Your signature IS your shield. You don't protect the
DOT by hiding it — you protect it by signing it. Anyone can read it; no one can
fake it without your key.

**Immutable at the byte level, mutable at the chain level.** Individual DOTs are
permanent. New DOTs observe old DOTs — adding commentary, reinterpretation, forgiveness.
The chain evolves. The DOT is stone.

**The carrier that needs the least infrastructure to verify survives longest.**
DOT must be: durable like stone, portable like a parable.

**No hierarchy.** DOT has no concept of authority. A DOT from a refugee is as
cryptographically valid as a DOT from a government. The signature is the only
credential that matters.

---

## 14. Error Types

```
DotError                       Base error class
InvalidMagicError              First 4 bytes != \x89DOT
UnsupportedVersionError        VERSION byte > 1
UnsupportedCryptoSuiteError    CRYPTO_SUITE not supported
SignatureVerificationError     Ed25519 verify returned False
NotAddressedToYouError         Encrypted DOT not addressed to provided keypair
UnknownCriticalExtensionError  TLV tag with high bit set is not recognized
```

---

## 15. Test Vectors

Canonical test vectors: `test_vectors/test_vectors.json`

Generated from the Python reference implementation with deterministic seeds
and deterministic randomness. These vectors are the source of truth for all
language implementations.

**If Python and any other language produce different bytes for the same inputs,
the other language is wrong.**

| ID | Description | Size |
|----|-------------|------|
| TV1 | Minimal OBSERVATION | 133B |
| TV2 | Identity DOT (Amara) | 212B |
| TV3 | Sealed Letter (Alice→Bob) | 266B |
| TV4 | Chained DOT | 173B |
| TV5 | Key Rotation | 472B |
| TV6 | Anti-DOT | 154B |
| TV7 | Unknown optional extension | 200B |
| TV8 | Unknown critical extension | 186B |
| TV9 | Corrupted signature | 133B |
| TV10 | Corrupted ciphertext | 266B |

---

*DOT Protocol v1.0 — Council of Minds, March 10, 2026*
*"The act of observation leaves its dot."*
