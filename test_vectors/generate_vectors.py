"""
DOT Protocol — Test Vector Generator

Canonical cross-language test vectors generated from the Python reference implementation.
These vectors ARE the truth. If any other language implementation produces different bytes
for the same input, THAT implementation is wrong.

Generated once. Committed forever. Never regenerated (unless the spec changes with a
new version bump).

Run from the project root:
    PYTHONPATH=. python3 test_vectors/generate_vectors.py
"""

import sys
import json
import struct
import hashlib
import copy

sys.path.insert(0, ".")

import dot_protocol as dot
from dot_protocol import crypto
from dot_protocol.container import (
    TLV_CONTENT_TYPE, TLV_LANGUAGE, TLV_DESCRIPTION,
    TLV_NAMESPACE,
    TYPE_IDENTITY, TYPE_OBSERVATION, TYPE_ANTI_DOT,
    TYPE_ROTATION, TYPE_CHAIN_LINK,
    MAGIC, VERSION_1, CRYPTO_SUITE_1,
    FLAG_ENCRYPTED, FLAG_HAS_RECIPIENT, FLAG_HAS_EXTENSIONS,
    FLAG_HAS_PARENT, FLAG_IS_ANTI_DOT,
    UnknownCriticalExtensionError, SignatureVerificationError,
    InvalidMagicError,
    create, open as dot_open, verify, chain, rotate,
)
from unittest.mock import patch


# ─── Deterministic Seeds ──────────────────────────────────────────────────────

def _seed(n: int) -> bytes:
    """Generate a deterministic 32-byte seed from an integer."""
    return hashlib.sha256(f"DOT-test-seed-{n}".encode()).digest()


SEED_ALICE = _seed(1)  # Alice — primary actor
SEED_BOB   = _seed(2)  # Bob   — recipient
SEED_OLD   = _seed(10) # Old keypair for rotation
SEED_NEW   = _seed(11) # New keypair for rotation


# ─── Deterministic os.urandom ─────────────────────────────────────────────────

def _rand_pool(label: str, size: int = 256) -> bytes:
    """
    Generate a deterministic pool of 'random' bytes derived from a label.
    Each test case that needs os.urandom gets its own labeled pool.
    """
    chunks = []
    i = 0
    while len(b"".join(chunks)) < size:
        chunks.append(hashlib.sha256(f"DOT-rand-{label}-{i}".encode()).digest())
        i += 1
    return b"".join(chunks)[:size]


class _DeterministicRandom:
    """Reads sequentially from a fixed byte pool. Replaces os.urandom."""
    def __init__(self, label: str):
        self._pool = _rand_pool(label)
        self._pos = 0

    def __call__(self, n: int) -> bytes:
        if self._pos + n > len(self._pool):
            raise RuntimeError(
                f"DeterministicRandom pool exhausted at pos {self._pos} (need {n} more bytes). "
                f"Increase pool size."
            )
        chunk = self._pool[self._pos:self._pos + n]
        self._pos += n
        return chunk


# ─── Fixed Timestamp ──────────────────────────────────────────────────────────

# 2026-03-10T00:00:00.000000 UTC
TIMESTAMP_US = 1741564800_000000


# ─── Test Vector Builder ──────────────────────────────────────────────────────

vectors = []


def tv(
    id: str,
    description: str,
    dot_hex: str,
    inputs: dict,
    expect: dict,
):
    vectors.append({
        "id": id,
        "description": description,
        "dot_hex": dot_hex,
        "inputs": inputs,
        "expect": expect,
    })


# ─── TV1: Minimal unencrypted OBSERVATION ────────────────────────────────────

alice = crypto.generate_keypair(SEED_ALICE)

d = create(
    payload=b"hello world",
    keypair=alice,
    dot_type=TYPE_OBSERVATION,
    timestamp_us=TIMESTAMP_US,
)

r = dot_open(d)
v = verify(d)

tv(
    id="TV1",
    description="Minimal unencrypted OBSERVATION DOT. No extensions, no parent, no recipients.",
    dot_hex=d.hex(),
    inputs={
        "payload_hex": b"hello world".hex(),
        "payload_ascii": "hello world",
        "seed_alice_hex": SEED_ALICE.hex(),
        "dot_type": "OBSERVATION",
        "dot_type_byte": TYPE_OBSERVATION,
        "timestamp_us": TIMESTAMP_US,
    },
    expect={
        "dot_size_bytes": len(d),
        "dot_hash_hex": crypto.dot_hash_hex(d),
        "creator_key_hex": alice.ed25519_public.hex(),
        "verified": True,
        "encrypted": False,
        "dot_type_name": "OBSERVATION",
        "payload_hex": b"hello world".hex(),
        "has_parent": False,
        "extensions": {},
    },
)

print(f"TV1 ✓  size={len(d)}B  hash={crypto.dot_hash_hex(d)[:16]}…")


# ─── TV2: Identity DOT ────────────────────────────────────────────────────────

identity_payload = json.dumps({
    "name": "Amara",
    "born": "1998-03-15",
    "origin": "Aleppo",
}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

d2 = create(
    payload=identity_payload,
    keypair=alice,
    dot_type=TYPE_IDENTITY,
    timestamp_us=TIMESTAMP_US,
    extensions={
        TLV_CONTENT_TYPE: b"application/json",
        TLV_LANGUAGE: b"ar",
    },
)

r2 = dot_open(d2)

tv(
    id="TV2",
    description=(
        "Identity DOT. Amara's refugee identity: name, birthdate, origin city. "
        "Arabic language extension. No encryption — identity is public by design. "
        "The genesis use case of the DOT protocol."
    ),
    dot_hex=d2.hex(),
    inputs={
        "payload_hex": identity_payload.hex(),
        "payload_utf8": identity_payload.decode("utf-8"),
        "seed_alice_hex": SEED_ALICE.hex(),
        "dot_type": "IDENTITY",
        "dot_type_byte": TYPE_IDENTITY,
        "timestamp_us": TIMESTAMP_US,
        "extensions": {
            "TLV_CONTENT_TYPE": {
                "tag_hex": "0001",
                "value_hex": b"application/json".hex(),
                "value_ascii": "application/json",
            },
            "TLV_LANGUAGE": {
                "tag_hex": "0006",
                "value_hex": b"ar".hex(),
                "value_ascii": "ar",
            },
        },
    },
    expect={
        "dot_size_bytes": len(d2),
        "dot_hash_hex": crypto.dot_hash_hex(d2),
        "creator_key_hex": alice.ed25519_public.hex(),
        "verified": True,
        "encrypted": False,
        "dot_type_name": "IDENTITY",
        "payload_hex": identity_payload.hex(),
        "payload_parsed": {"name": "Amara", "born": "1998-03-15", "origin": "Aleppo"},
        "has_parent": False,
        "extensions": {
            "1": b"application/json".hex(),   # TLV_CONTENT_TYPE = 0x0001 = 1
            "6": b"ar".hex(),                 # TLV_LANGUAGE     = 0x0006 = 6
        },
    },
)

print(f"TV2 ✓  size={len(d2)}B  hash={crypto.dot_hash_hex(d2)[:16]}…")


# ─── TV3: Sealed Letter (encrypted, 1 recipient) ──────────────────────────────

bob = crypto.generate_keypair(SEED_BOB)
sealed_payload = b"For Bob's eyes only."

rand3 = _DeterministicRandom("TV3")
with patch("os.urandom", rand3):
    d3 = create(
        payload=sealed_payload,
        keypair=alice,
        dot_type=0x06,  # TYPE_SEALED_LETTER
        recipient_keys=[bob.ed25519_public],
        timestamp_us=TIMESTAMP_US,
    )

# Verify we can open it as Bob
r3 = dot_open(d3, keypair=bob)
assert r3.payload == sealed_payload, "TV3 decryption mismatch"
assert r3.verified is True
assert r3.encrypted is True

tv(
    id="TV3",
    description=(
        "Sealed Letter. Encrypted with AES-256-GCM session key. "
        "Alice sends to Bob. Bob can decrypt; anyone else sees only ciphertext. "
        "Session key is sealed with X25519 ECDH + HKDF-SHA256 + AES-256-GCM."
    ),
    dot_hex=d3.hex(),
    inputs={
        "payload_hex": sealed_payload.hex(),
        "payload_ascii": "For Bob's eyes only.",
        "seed_alice_hex": SEED_ALICE.hex(),
        "seed_bob_hex": SEED_BOB.hex(),
        "dot_type": "SEALED_LETTER",
        "dot_type_byte": 0x06,
        "timestamp_us": TIMESTAMP_US,
        "urandom_pool_label": "TV3",
        "urandom_pool_hex": _rand_pool("TV3")[:56].hex(),  # session_key(32) + seal_nonce(12) + payload_nonce(12)
    },
    expect={
        "dot_size_bytes": len(d3),
        "dot_hash_hex": crypto.dot_hash_hex(d3),
        "creator_key_hex": alice.ed25519_public.hex(),
        "recipient_key_hex": bob.ed25519_public.hex(),
        "verified": True,
        "encrypted": True,
        "dot_type_name": "SEALED_LETTER",
        "plaintext_hex": sealed_payload.hex(),
        "open_without_keypair": "raises NotAddressedToYouError",
        "open_with_alice_keypair": "raises NotAddressedToYouError",
        "open_with_bob_keypair": "returns plaintext",
        "has_parent": False,
    },
)

print(f"TV3 ✓  size={len(d3)}B  hash={crypto.dot_hash_hex(d3)[:16]}…")


# ─── TV4: Chained DOT ─────────────────────────────────────────────────────────

chain_payload = b"This follows TV1."

d4 = chain(
    payload=chain_payload,
    keypair=alice,
    parent_dot_bytes=d,   # TV1 is the parent
    dot_type=TYPE_CHAIN_LINK,
    timestamp_us=TIMESTAMP_US + 1_000_000,  # 1 second later
)

r4 = dot_open(d4)
assert r4.parent_hash_hex == crypto.dot_hash_hex(d), "TV4 parent hash mismatch"

tv(
    id="TV4",
    description=(
        "Chained DOT. TV4 references TV1 as parent via SHA-256 hash. "
        "Creates a Merkle chain of verifiable history. "
        "Parent hash in PARENT_HASH section must equal SHA-256(TV1 bytes)."
    ),
    dot_hex=d4.hex(),
    inputs={
        "payload_hex": chain_payload.hex(),
        "payload_ascii": "This follows TV1.",
        "seed_alice_hex": SEED_ALICE.hex(),
        "dot_type": "CHAIN_LINK",
        "dot_type_byte": TYPE_CHAIN_LINK,
        "timestamp_us": TIMESTAMP_US + 1_000_000,
        "parent_dot_hex": d.hex(),
    },
    expect={
        "dot_size_bytes": len(d4),
        "dot_hash_hex": crypto.dot_hash_hex(d4),
        "creator_key_hex": alice.ed25519_public.hex(),
        "verified": True,
        "encrypted": False,
        "dot_type_name": "CHAIN_LINK",
        "payload_hex": chain_payload.hex(),
        "has_parent": True,
        "parent_hash_hex": crypto.dot_hash_hex(d),  # SHA-256 of TV1
        "parent_hash_algo_byte": 0x01,  # HASH_SHA256
    },
)

print(f"TV4 ✓  size={len(d4)}B  hash={crypto.dot_hash_hex(d4)[:16]}…")


# ─── TV5: Key Rotation ────────────────────────────────────────────────────────

old_kp = crypto.generate_keypair(SEED_OLD)
new_kp = crypto.generate_keypair(SEED_NEW)

d5 = rotate(
    old_keypair=old_kp,
    new_keypair=new_kp,
    timestamp_us=TIMESTAMP_US,
)

r5 = dot_open(d5)
rotation_data = json.loads(r5.payload.decode("utf-8"))
assert rotation_data["old_public_key"] == old_kp.ed25519_public.hex()
assert rotation_data["new_public_key"] == new_kp.ed25519_public.hex()
# Verify rotation_proof: old_key signed new_public_key
assert crypto.verify_signature(
    new_kp.ed25519_public,
    bytes.fromhex(rotation_data["rotation_proof"]),
    old_kp.ed25519_public,
), "TV5 rotation proof invalid"

tv(
    id="TV5",
    description=(
        "Key Rotation DOT. Signed by the NEW key. "
        "Payload contains JSON with old_public_key, new_public_key, and rotation_proof. "
        "rotation_proof = Ed25519 signature of new_public_key bytes by old_private_key. "
        "Verifiers: check creator_key == new_public_key, "
        "then verify rotation_proof with old_public_key over new_public_key bytes."
    ),
    dot_hex=d5.hex(),
    inputs={
        "seed_old_hex": SEED_OLD.hex(),
        "seed_new_hex": SEED_NEW.hex(),
        "old_public_key_hex": old_kp.ed25519_public.hex(),
        "new_public_key_hex": new_kp.ed25519_public.hex(),
        "timestamp_us": TIMESTAMP_US,
    },
    expect={
        "dot_size_bytes": len(d5),
        "dot_hash_hex": crypto.dot_hash_hex(d5),
        "creator_key_hex": new_kp.ed25519_public.hex(),  # Signed by NEW key
        "verified": True,
        "encrypted": False,
        "dot_type_name": "ROTATION",
        "payload_json": rotation_data,
        "rotation_proof_verifies": True,
        "rotation_proof_message_hex": new_kp.ed25519_public.hex(),
        "has_parent": False,
    },
)

print(f"TV5 ✓  size={len(d5)}B  hash={crypto.dot_hash_hex(d5)[:16]}…")


# ─── TV6: Anti-DOT (deletion signal) ─────────────────────────────────────────

# Anti-DOT targets TV1 by hash
target_hash = crypto.dot_hash(d)
anti_payload = target_hash  # Payload IS the target DOT hash

d6 = create(
    payload=anti_payload,
    keypair=alice,
    is_anti_dot=True,
    timestamp_us=TIMESTAMP_US,
)

r6 = dot_open(d6)

tv(
    id="TV6",
    description=(
        "Anti-DOT. Deletion signal targeting TV1. "
        "Payload = SHA-256 of the target DOT bytes (32 bytes, binary). "
        "FLAG_IS_ANTI_DOT (0x10) set in FLAGS byte. DOT_TYPE forced to ANTI_DOT (0x05). "
        "Relay nodes tombstone the target upon receipt. "
        "1.237× amplification factor is Layer 2 (trust graph propagation) — "
        "Layer 1 (this wire format) only carries the tombstone signal."
    ),
    dot_hex=d6.hex(),
    inputs={
        "target_dot_hex": d.hex(),
        "target_dot_hash_hex": target_hash.hex(),
        "payload_hex": anti_payload.hex(),
        "seed_alice_hex": SEED_ALICE.hex(),
        "timestamp_us": TIMESTAMP_US,
    },
    expect={
        "dot_size_bytes": len(d6),
        "dot_hash_hex": crypto.dot_hash_hex(d6),
        "creator_key_hex": alice.ed25519_public.hex(),
        "verified": True,
        "encrypted": False,
        "dot_type_name": "ANTI_DOT",
        "flags_is_anti_dot_bit": True,
        "payload_hex": anti_payload.hex(),
        "payload_interpretation": "SHA-256 of target DOT to tombstone",
        "has_parent": False,
    },
)

print(f"TV6 ✓  size={len(d6)}B  hash={crypto.dot_hash_hex(d6)[:16]}…")


# ─── TV7: Unknown optional extension (should open normally) ───────────────────

UNKNOWN_OPTIONAL_TAG = 0x00FF  # High bit clear = optional

d7 = create(
    payload=b"Has unknown optional extension.",
    keypair=alice,
    dot_type=TYPE_OBSERVATION,
    timestamp_us=TIMESTAMP_US,
    extensions={
        TLV_CONTENT_TYPE: b"text/plain",
        UNKNOWN_OPTIONAL_TAG: b"future-feature-data",
    },
)

r7 = dot_open(d7)
assert r7.verified is True, "TV7 should open successfully"
assert UNKNOWN_OPTIONAL_TAG in r7.extensions, "Unknown optional extension should be present in result"

tv(
    id="TV7",
    description=(
        "Unknown optional TLV extension (tag 0x00FF). "
        "High bit of tag byte is CLEAR → extension is optional. "
        "Decoders that don't know this tag MUST silently skip it and continue. "
        "verified=True, payload accessible, extension value preserved."
    ),
    dot_hex=d7.hex(),
    inputs={
        "payload_hex": b"Has unknown optional extension.".hex(),
        "payload_ascii": "Has unknown optional extension.",
        "seed_alice_hex": SEED_ALICE.hex(),
        "timestamp_us": TIMESTAMP_US,
        "extensions": {
            "TLV_CONTENT_TYPE_0x0001": b"text/plain".hex(),
            "UNKNOWN_OPTIONAL_0x00FF": b"future-feature-data".hex(),
        },
    },
    expect={
        "dot_size_bytes": len(d7),
        "dot_hash_hex": crypto.dot_hash_hex(d7),
        "creator_key_hex": alice.ed25519_public.hex(),
        "verified": True,
        "encrypted": False,
        "dot_type_name": "OBSERVATION",
        "unknown_tag_handling": "silently_skip",
        "extensions_include_unknown": True,
        "extensions": {
            "1":   b"text/plain".hex(),
            "255": b"future-feature-data".hex(),
        },
    },
)

print(f"TV7 ✓  size={len(d7)}B  hash={crypto.dot_hash_hex(d7)[:16]}…")


# ─── TV8: Unknown critical extension (must raise error) ───────────────────────

UNKNOWN_CRITICAL_TAG = 0x80FF  # High bit SET = critical

try:
    d8 = create(
        payload=b"Has unknown critical extension.",
        keypair=alice,
        dot_type=TYPE_OBSERVATION,
        timestamp_us=TIMESTAMP_US,
        extensions={
            UNKNOWN_CRITICAL_TAG: b"mandatory-future-data",
        },
    )

    try:
        r8 = dot_open(d8)
        raise AssertionError("TV8: Should have raised UnknownCriticalExtensionError")
    except UnknownCriticalExtensionError as e:
        pass  # Expected

    tv(
        id="TV8",
        description=(
            "Unknown critical TLV extension (tag 0x80FF). "
            "High bit of tag byte is SET → extension is critical. "
            "Decoders that don't know this tag MUST raise UnknownCriticalExtensionError "
            "and refuse to process the DOT. "
            "This is the forward-compatibility safety mechanism."
        ),
        dot_hex=d8.hex(),
        inputs={
            "payload_hex": b"Has unknown critical extension.".hex(),
            "payload_ascii": "Has unknown critical extension.",
            "seed_alice_hex": SEED_ALICE.hex(),
            "timestamp_us": TIMESTAMP_US,
            "extensions": {
                "UNKNOWN_CRITICAL_0x80FF": b"mandatory-future-data".hex(),
            },
        },
        expect={
            "dot_size_bytes": len(d8),
            "dot_hash_hex": crypto.dot_hash_hex(d8),
            "creator_key_hex": alice.ed25519_public.hex(),
            "verified": "unknown — raises before verification in some implementations",
            "encrypted": False,
            "open_behavior": "raises UnknownCriticalExtensionError",
            "verify_behavior": "may succeed (signature check) but open MUST refuse",
            "unknown_critical_tag_handling": "reject",
        },
    )

    print(f"TV8 ✓  size={len(d8)}B  hash={crypto.dot_hash_hex(d8)[:16]}…")

except Exception as e:
    print(f"TV8 ERROR: {e}")
    raise


# ─── TV9: Corrupted signature ────────────────────────────────────────────────

d9_orig = d  # Start from TV1

# Flip a bit in the signature section (last 67 bytes: key_type(1) + length(2) + sig(64))
d9 = bytearray(d9_orig)
# Corrupt byte at offset -30 (within the Ed25519 signature bytes)
d9[-30] ^= 0xFF
d9 = bytes(d9)

v9 = verify(d9)
assert v9.verified is False, "TV9: corrupted signature should fail verify"

tv(
    id="TV9",
    description=(
        "Corrupted signature. TV1 bytes with one byte flipped in the Ed25519 signature section. "
        "verify() MUST return verified=False. "
        "open() MUST raise SignatureVerificationError. "
        "The exact error type and message may vary, but verified=False is required."
    ),
    dot_hex=d9.hex(),
    inputs={
        "source": "TV1 with byte at offset -30 XORed with 0xFF",
        "original_dot_hex": d9_orig.hex(),
        "corruption_offset_from_end": 30,
        "corruption_xor": "0xFF",
    },
    expect={
        "dot_size_bytes": len(d9),
        "verify_result_verified": False,
        "open_behavior": "raises SignatureVerificationError",
        "dot_hash_hex": crypto.dot_hash_hex(d9),  # Hash of corrupted bytes (different from TV1)
    },
)

print(f"TV9 ✓  verified=False as expected  hash={crypto.dot_hash_hex(d9)[:16]}…")


# ─── TV10: Corrupted payload (encrypted DOT, ciphertext tampered) ─────────────

d10_orig = d3  # Start from TV3 (encrypted)

# Flip a bit in the encrypted payload section
# Header is 12 bytes, creator key section: 1+2+32=35, timestamp=8
# After header+key+timestamp, possibly recipients section...
# Easier: just flip near the middle of the DOT, avoiding header and sig
mid = len(d10_orig) // 2
d10 = bytearray(d10_orig)
d10[mid] ^= 0x42
d10 = bytes(d10)

v10 = verify(d10)

tv(
    id="TV10",
    description=(
        "Corrupted payload in an encrypted DOT. TV3 bytes with one byte flipped in the middle. "
        "Behavior depends on WHAT was corrupted: "
        "if signature section: verify()=False, open() raises SignatureVerificationError. "
        "if ciphertext payload: verify() may succeed (sig over ciphertext), "
        "but open() raises ValueError (AES-GCM authentication failure). "
        "Either way: tampering is detected. Authentication is non-negotiable."
    ),
    dot_hex=d10.hex(),
    inputs={
        "source": "TV3 with byte at offset len//2 XORed with 0x42",
        "original_dot_hex": d3.hex(),
        "corruption_offset": mid,
        "corruption_xor": "0x42",
    },
    expect={
        "dot_size_bytes": len(d10),
        "verify_result_verified": v10.verified,
        "open_behavior": "raises SignatureVerificationError or ValueError",
        "dot_hash_hex": crypto.dot_hash_hex(d10),
        "note": (
            "If verify_result_verified=True, the signature was over the ciphertext "
            "and the corruption hit the ciphertext. open() will still fail on AES-GCM auth tag."
        ),
    },
)

print(f"TV10 ✓  verify.verified={v10.verified}  corruption detected via open()")

# Confirm open() raises
try:
    dot_open(d10, keypair=bob)
    raise AssertionError("TV10: Should have raised an error")
except (SignatureVerificationError, ValueError) as e:
    print(f"TV10 ✓  open() raised {type(e).__name__} as expected")


# ─── Write JSON ──────────────────────────────────────────────────────────────

output = {
    "meta": {
        "protocol": "DOT",
        "version": "1.0",
        "crypto_suite": 1,
        "crypto_suite_description": "Ed25519 + X25519 + AES-256-GCM + SHA-256 + HKDF-SHA256",
        "generated_by": "dot_protocol Python reference implementation",
        "generated_at": "2026-03-10T00:00:00Z",
        "canonical": True,
        "note": (
            "These vectors ARE the truth. "
            "If Python and any other language produce different bytes for the same inputs, "
            "the other language is wrong."
        ),
    },
    "fixed_seeds": {
        "SEED_ALICE": SEED_ALICE.hex(),
        "SEED_BOB":   SEED_BOB.hex(),
        "SEED_OLD":   SEED_OLD.hex(),
        "SEED_NEW":   SEED_NEW.hex(),
        "derivation": "sha256('DOT-test-seed-{n}') where n is the seed index (1=Alice, 2=Bob, 10=Old, 11=New)",
    },
    "fixed_timestamp_us": TIMESTAMP_US,
    "fixed_timestamp_iso": "2026-03-10T00:00:00.000000Z",
    "key_material": {
        "alice": {
            "seed_hex": SEED_ALICE.hex(),
            "ed25519_public_hex": alice.ed25519_public.hex(),
            "x25519_public_hex": alice.x25519_public.hex(),
        },
        "bob": {
            "seed_hex": SEED_BOB.hex(),
            "ed25519_public_hex": bob.ed25519_public.hex(),
            "x25519_public_hex": bob.x25519_public.hex(),
        },
        "old_keypair": {
            "seed_hex": SEED_OLD.hex(),
            "ed25519_public_hex": old_kp.ed25519_public.hex(),
            "x25519_public_hex": old_kp.x25519_public.hex(),
        },
        "new_keypair": {
            "seed_hex": SEED_NEW.hex(),
            "ed25519_public_hex": new_kp.ed25519_public.hex(),
            "x25519_public_hex": new_kp.x25519_public.hex(),
        },
    },
    "vectors": vectors,
}

output_path = "test_vectors/test_vectors.json"
with open(output_path, "w") as f:
    json.dump(output, f, indent=2)
    f.write("\n")

print()
print(f"✓ Wrote {len(vectors)} test vectors to {output_path}")
total_bytes = sum(len(bytes.fromhex(v["dot_hex"])) for v in vectors)
print(f"  Total DOT bytes across all vectors: {total_bytes}")
print()
for v in vectors:
    dot_bytes = bytes.fromhex(v["dot_hex"])
    print(f"  {v['id']:5s}  {len(dot_bytes):4d}B  {crypto.dot_hash_hex(dot_bytes)[:32]}…  {v['description'][:60]}")
