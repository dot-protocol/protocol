"""
Experiment 7: Multi-Observer Chain
5 observers, 50 DOTs total (10 per observer, round-robin), shared chain.
"""

import sys
import os
import hashlib
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_CHAIN_LINK, TYPE_OBSERVATION

TIMESTAMP_BASE = 1741564800_000_000
N = 50

# Generate 5 deterministic keypairs
names = ["alice", "bob", "carol", "dave", "eve"]
observers = {}
for name in names:
    seed = hashlib.sha256(name.encode()).digest()
    observers[name] = crypto.generate_keypair(seed)

print("=" * 60)
print("  EXPERIMENT 07: MULTI-OBSERVER CHAIN — RESULTS")
print("=" * 60)
print()
print(f"  Observers: {', '.join(names)}")
print(f"  Chain length: {N} DOTs")
print()

dots = []
creator_names = []

# Genesis DOT by alice
genesis = create(
    payload=b"Multi-observer chain genesis",
    keypair=observers["alice"],
    dot_type=TYPE_OBSERVATION,
    timestamp_us=TIMESTAMP_BASE,
)
dots.append(genesis)
creator_names.append("alice")

for i in range(1, N):
    observer_name = names[i % len(names)]
    kp = observers[observer_name]
    payload = f"Observer {observer_name}: step {i} in shared chain".encode()
    ts = TIMESTAMP_BASE + i * 1000

    d = create(
        payload=payload,
        keypair=kp,
        dot_type=TYPE_CHAIN_LINK,
        timestamp_us=ts,
        parent=dots[-1],
    )
    dots.append(d)
    creator_names.append(observer_name)

# Verify chain
chain_valid = True
errors = []

for i, (d, creator_name) in enumerate(zip(dots, creator_names)):
    vr = verify(d)
    if not vr.verified:
        chain_valid = False
        errors.append(f"DOT {i}: signature invalid")
        continue

    expected_key = observers[creator_name].ed25519_public
    if vr.creator_key != expected_key:
        chain_valid = False
        errors.append(f"DOT {i}: wrong creator key")
        continue

    if i > 0:
        expected_parent_hash = hashlib.sha256(dots[i-1]).digest()
        flags = d[6]
        if not (flags & 0x08):
            chain_valid = False
            errors.append(f"DOT {i}: HAS_PARENT flag not set")
            continue
        stored_parent_hash = d[57:89]
        if stored_parent_hash != expected_parent_hash:
            chain_valid = False
            errors.append(f"DOT {i}: parent hash mismatch")

distribution = Counter(creator_names)
total_bytes = sum(len(d) for d in dots)

print(f"  Chain valid:     {chain_valid}")
if errors:
    for e in errors[:5]:
        print(f"  ERROR: {e}")
print()
print(f"  Observer distribution:")
for name in names:
    count = distribution[name]
    bar = "█" * count
    print(f"    {name:<8s}: {count:2d} DOTs  {bar}")
print()
print(f"  Total size:      {total_bytes:,} bytes ({total_bytes/1024:.1f} KB)")
print(f"  Avg DOT size:    {total_bytes // N} bytes")
print()
print("  EXPERIMENT 07 PASSED" if chain_valid else "  EXPERIMENT 07 FAILED")
print("=" * 60)
