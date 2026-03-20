"""
Experiment 5: Chain 10K
Build 10,000 sequential DOTs, verify chain integrity.
Uses create() with parent= (not chain()) to avoid O(n²) double-verify.
"""

import sys
import os
import time
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_CHAIN_LINK, TYPE_OBSERVATION

WORDS = [
    "ancient", "bright", "crystal", "dark", "ethereal", "floating", "golden", "hidden",
    "infinite", "jade", "keen", "luminous", "mystic", "noble", "obscure", "pristine",
    "quiet", "radiant", "silver", "timeless", "unique", "vast", "wandering", "xenial",
    "yearning", "zenith", "beyond", "cascading", "drifting", "emerald", "flowing",
    "glacial", "horizon", "ivory", "jeweled", "kinetic", "latent", "molten", "nebula",
]

N = 10_000
TIMESTAMP_BASE = 1741564800_000_000

seed = b"chain-observer-exp05" + b"\x00" * 12
kp = crypto.generate_keypair(seed[:32])

print("=" * 60)
print("  EXPERIMENT 05: CHAIN 10K — RESULTS")
print("=" * 60)
print()
print(f"  Building chain of {N:,} DOTs...")

dots = []
t_build_start = time.perf_counter()

# Genesis DOT
genesis_payload = b"Genesis: the chain begins here."
genesis = create(
    payload=genesis_payload,
    keypair=kp,
    dot_type=TYPE_OBSERVATION,
    timestamp_us=TIMESTAMP_BASE,
)
dots.append(genesis)

for i in range(1, N):
    phrase = " ".join(random.choice(WORDS) for _ in range(8))
    payload = f"Observation {i}: {phrase}".encode()
    ts = TIMESTAMP_BASE + i * 1_000  # 1ms apart

    d = create(
        payload=payload,
        keypair=kp,
        dot_type=TYPE_CHAIN_LINK,
        timestamp_us=ts,
        parent=dots[-1],  # parent= avoids O(n²) verify overhead
    )
    dots.append(d)

t_build_end = time.perf_counter()
build_ms = (t_build_end - t_build_start) * 1000
build_per_dot = build_ms / N

print(f"  Build complete: {build_ms:.1f} ms total, {build_per_dot:.3f} ms/DOT")
print(f"  Verifying chain integrity...")

# Verify chain
import hashlib

t_verify_start = time.perf_counter()
chain_valid = True
errors = []

for i, d in enumerate(dots):
    vr = verify(d)
    if not vr.verified:
        chain_valid = False
        errors.append(f"DOT {i}: signature invalid")
        continue

    if i > 0:
        # Check parent hash
        expected_parent_hash = hashlib.sha256(dots[i-1]).digest()
        # Parse parent hash from this DOT
        # Header=12, KeySection=35, Timestamp=8 → pos=55
        # HAS_PARENT flag is 0x08 at offset 6
        flags = d[6]
        if not (flags & 0x08):
            chain_valid = False
            errors.append(f"DOT {i}: HAS_PARENT flag not set")
            continue
        # Parent hash: hash_algo(1) + hash_len(1) + hash(32) at offset 55
        stored_parent_hash = d[57:89]
        if stored_parent_hash != expected_parent_hash:
            chain_valid = False
            errors.append(f"DOT {i}: parent hash mismatch")

t_verify_end = time.perf_counter()
verify_ms = (t_verify_end - t_verify_start) * 1000
verify_per_dot = verify_ms / N

total_bytes = sum(len(d) for d in dots)

print()
print(f"  BUILD STATS:")
print(f"    Total build time:    {build_ms:.1f} ms")
print(f"    Build per DOT:       {build_per_dot:.4f} ms ({build_per_dot*1000:.1f} µs)")
print(f"    Throughput:          {N/build_ms*1000:.0f} DOTs/second")
print()
print(f"  VERIFY STATS:")
print(f"    Total verify time:   {verify_ms:.1f} ms")
print(f"    Verify per DOT:      {verify_per_dot:.4f} ms ({verify_per_dot*1000:.1f} µs)")
print(f"    Throughput:          {N/verify_ms*1000:.0f} verifications/second")
print()
print(f"  CHAIN STATS:")
print(f"    Total DOTs:          {N:,}")
print(f"    Total chain size:    {total_bytes:,} bytes ({total_bytes/1024/1024:.2f} MB)")
print(f"    Avg DOT size:        {total_bytes//N} bytes")
print(f"    Chain valid:         {chain_valid}")
if errors:
    print(f"    Errors: {errors[:5]}")
print()
print("  EXPERIMENT 05 PASSED" if chain_valid else "  EXPERIMENT 05 FAILED")
print("=" * 60)
