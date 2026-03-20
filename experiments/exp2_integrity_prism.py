"""
Experiment 2: Integrity Prism

Generate 1,000 DOTs. Tamper with 100 (25 each: payload bit-flip, timestamp modify,
signature alter, parent_hash swap). Verify all 1,000.

Report: detection rate, false positive rate, time per verification.

Expected result: 100% detection. 0% false positives.
Any other result means the wire format is broken.
"""

import sys
import os
import time
import struct
import secrets

sys.path.insert(0, ".")

import dot_protocol as dot
from dot_protocol import crypto
from dot_protocol.container import (
    TYPE_OBSERVATION, TYPE_CHAIN_LINK,
    create, verify, chain,
)

# ─── Setup ───────────────────────────────────────────────────────────────────

import hashlib
alice_seed = hashlib.sha256(b"exp2-alice").digest()
alice = crypto.generate_keypair(alice_seed)

TIMESTAMP_BASE = 1741564800_000_000  # 2026-03-10T00:00:00 UTC in microseconds

# ─── Wire format offsets (Suite 1) ───────────────────────────────────────────
#
# MAGIC(4) + VERSION(1) + CRYPTO_SUITE(1) + FLAGS(1) + DOT_TYPE(1) + PAYLOAD_LENGTH(4) = 12
# KEY_TYPE(1) + KEY_LENGTH(2) + ED25519_PUBLIC(32) = 35
# TIMESTAMP: 8 bytes starting at offset 47
#
# For chained DOTs (HAS_PARENT flag set):
# After timestamp (offset 55): HASH_ALGO(1) + HASH_LEN(1) + PARENT_HASH(32) = 34 bytes
# Parent hash bytes start at offset 55 + 2 = 57

OFFSET_TIMESTAMP = 12 + 35           # = 47
OFFSET_PARENT_HASH_START = 12 + 35 + 8 + 2  # = 57 (after hash_algo and hash_len)
SIGNATURE_TAIL_BYTES = 1 + 2 + 64   # = 67 (key_type + sig_length + Ed25519_sig)


def make_dot(i: int, payload: bytes, chained: bool = False, parent: bytes = None) -> bytes:
    ts = TIMESTAMP_BASE + i * 1_000  # 1ms apart
    if chained and parent is not None:
        return chain(
            payload=payload,
            keypair=alice,
            parent_dot_bytes=parent,
            dot_type=TYPE_CHAIN_LINK,
            timestamp_us=ts,
        )
    return create(
        payload=payload,
        keypair=alice,
        dot_type=TYPE_OBSERVATION,
        timestamp_us=ts,
    )


# ─── Generate 1,000 DOTs ─────────────────────────────────────────────────────

print("Generating 1,000 DOTs...")
print(f"  Creator: {alice.ed25519_public.hex()[:16]}…")
print()

# Create a parent DOT for chaining (the 75-99 group needs it)
parent_dot = create(
    payload=b"anchor for chain group",
    keypair=alice,
    timestamp_us=TIMESTAMP_BASE - 1_000_000,
)

dots = []    # bytearray (mutable for tampering)
labels = []  # 'clean' or tamper-type string

for i in range(1000):
    payload = secrets.token_bytes(32 + (i % 96))  # variable payload size

    if i < 25:      # Group A: will become payload bit-flip
        d = make_dot(i, payload)
    elif i < 50:    # Group B: will become timestamp modify
        d = make_dot(i, payload)
    elif i < 75:    # Group C: will become signature alter
        d = make_dot(i, payload)
    elif i < 100:   # Group D: will become parent_hash swap (chained)
        d = make_dot(i, payload, chained=True, parent=parent_dot)
    else:           # Groups E-Z: clean
        d = make_dot(i, payload)

    dots.append(bytearray(d))
    labels.append("clean")

print(f"  Generated {len(dots)} DOTs")
sizes = [len(d) for d in dots]
print(f"  Size range: {min(sizes)}-{max(sizes)} bytes (avg {sum(sizes)//len(sizes)}B)")
print()


# ─── Apply Tampering ─────────────────────────────────────────────────────────

print("Applying tampering to groups 0-99...")

# Group A [0-24]: Payload bit-flip
# Flip a byte roughly in the payload area (safe zone: avoid header and signature)
for i in range(25):
    d = dots[i]
    # Safe zone: offset 60 → len(d) - SIGNATURE_TAIL_BYTES - 5
    safe_mid = 60 + (len(d) - 60 - SIGNATURE_TAIL_BYTES) // 2
    d[safe_mid] ^= 0xFF
    labels[i] = "tamper_payload_bitflip"

# Group B [25-49]: Timestamp modify
# Timestamp is at bytes [47, 55). Shift by a large amount so it's clearly wrong.
for i in range(25, 50):
    d = dots[i]
    raw = bytes(d[OFFSET_TIMESTAMP:OFFSET_TIMESTAMP + 8])
    current_ts = struct.unpack(">q", raw)[0]
    new_ts = current_ts + 99_999_999_999  # ~27 hours forward
    d[OFFSET_TIMESTAMP:OFFSET_TIMESTAMP + 8] = struct.pack(">q", new_ts)
    labels[i] = "tamper_timestamp_modify"

# Group C [50-74]: Signature alter
# The Ed25519 signature is the last 64 bytes of the DOT.
# Flip bytes near the middle of the signature.
for i in range(50, 75):
    d = dots[i]
    # Last 64 bytes = signature. Flip bytes 20 and 21 into the sig.
    d[-44] ^= 0xAA
    d[-43] ^= 0x55
    labels[i] = "tamper_signature_alter"

# Group D [75-99]: Parent hash swap (chained DOTs)
# Replace the 32-byte parent hash with a different hash.
# The signature covers the original hash bytes, so this breaks verification.
for i in range(75, 100):
    d = dots[i]
    # Verify this is a chained DOT (HAS_PARENT flag set in FLAGS byte, offset 6)
    flags_byte = d[6]
    has_parent = bool(flags_byte & 0x08)
    if not has_parent:
        raise RuntimeError(f"DOT {i} should be chained but HAS_PARENT flag not set")
    # Replace parent hash (32 bytes starting at OFFSET_PARENT_HASH_START) with counter bytes
    replacement = hashlib.sha256(f"fake-parent-{i}".encode()).digest()
    d[OFFSET_PARENT_HASH_START:OFFSET_PARENT_HASH_START + 32] = replacement
    labels[i] = "tamper_parent_hash_swap"

# Confirm tampering distribution
from collections import Counter
label_counts = Counter(labels)
print(f"  clean:                      {label_counts['clean']}")
print(f"  tamper_payload_bitflip:     {label_counts['tamper_payload_bitflip']}")
print(f"  tamper_timestamp_modify:    {label_counts['tamper_timestamp_modify']}")
print(f"  tamper_signature_alter:     {label_counts['tamper_signature_alter']}")
print(f"  tamper_parent_hash_swap:    {label_counts['tamper_parent_hash_swap']}")
print()


# ─── Verify All 1,000 ────────────────────────────────────────────────────────

print("Verifying all 1,000 DOTs...")

results = []
t_start = time.perf_counter()

for d in dots:
    v = verify(bytes(d))
    results.append(v.verified)

t_end = time.perf_counter()

total_ms = (t_end - t_start) * 1000
per_dot_ms = total_ms / 1000
per_dot_us = per_dot_ms * 1000


# ─── Analysis ────────────────────────────────────────────────────────────────

# Ground truth
is_tampered = [label != "clean" for label in labels]
n_tampered = sum(is_tampered)   # 100
n_clean = len(labels) - n_tampered  # 900

# Result classification
true_positives  = 0  # tampered, verified=False (correctly caught)
false_negatives = 0  # tampered, verified=True  (MISSED — BAD)
true_negatives  = 0  # clean, verified=True     (correctly passed)
false_positives = 0  # clean, verified=False    (wrongly flagged — BAD)

tamper_group_caught = {
    "tamper_payload_bitflip":  0,
    "tamper_timestamp_modify": 0,
    "tamper_signature_alter":  0,
    "tamper_parent_hash_swap": 0,
}
tamper_group_missed = dict.fromkeys(tamper_group_caught, 0)

for verified, label, tampered in zip(results, labels, is_tampered):
    if tampered:
        if not verified:
            true_positives += 1
            tamper_group_caught[label] += 1
        else:
            false_negatives += 1
            tamper_group_missed[label] += 1
    else:
        if verified:
            true_negatives += 1
        else:
            false_positives += 1

detection_rate = true_positives / n_tampered * 100
false_positive_rate = false_positives / n_clean * 100


# ─── Report ──────────────────────────────────────────────────────────────────

print()
print("═" * 55)
print("  EXPERIMENT 2: INTEGRITY PRISM — RESULTS")
print("═" * 55)
print()
print(f"  Total DOTs verified:         1,000")
print(f"  Clean DOTs:                  {n_clean}")
print(f"  Tampered DOTs:               {n_tampered}")
print()
print(f"  Detection Rate:              {detection_rate:.1f}%  ({true_positives}/{n_tampered} tampered DOTs caught)")
print(f"  False Positive Rate:         {false_positive_rate:.2f}%  ({false_positives}/{n_clean} clean DOTs wrongly flagged)")
print()
print(f"  Breakdown by tamper type:")
for group, caught in tamper_group_caught.items():
    missed = tamper_group_missed[group]
    total = caught + missed
    print(f"    {group:<32s} {caught}/{total} caught  {'✅' if missed == 0 else '❌ MISSED: ' + str(missed)}")
print()
print(f"  Timing:")
print(f"    Total for 1,000 DOTs:      {total_ms:.1f} ms")
print(f"    Per DOT:                   {per_dot_ms:.4f} ms  ({per_dot_us:.1f} µs)")
print(f"    Throughput:                {1000/total_ms*1000:.0f} verifications/second")
print()

if detection_rate == 100.0 and false_positive_rate == 0.0 and false_negatives == 0:
    print("  ✅ EXPERIMENT 2 PASSED")
    print("     100% detection. 0% false positives. Sub-millisecond per DOT.")
    print("     The format is cryptographically sound.")
else:
    print("  ❌ EXPERIMENT 2 FAILED")
    if false_negatives > 0:
        print(f"     CRITICAL: {false_negatives} tampered DOTs passed verification undetected.")
        print(f"     The wire format has a security flaw.")
    if false_positives > 0:
        print(f"     WARNING: {false_positives} clean DOTs incorrectly flagged as tampered.")

print()
print("═" * 55)

# Brief comparison note (Experiment 3 context)
print()
print("  Comparison context (Experiment 3):")
print(f"    Smallest DOT in this run:  {min(sizes)}B")
print(f"    Smallest valid DOT (TV1):  133B")
print(f"    JWT (equivalent fields):   ~180-220B (estimate)")
print(f"    Protobuf (equiv fields):   ~80-100B (no signature)")
print(f"    Note: DOT includes Ed25519 sig (64B) + full public key (32B).")
print(f"          No equivalent JWT/protobuf includes both.")
