"""
Experiment 27: One Writer Per Chain (Satoshi's Conjecture)
Each observer owns its own chain. No locks needed. Graph-layer merges via RELATION DOTs.
"""

import sys
import os
import hashlib
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── 5 independent observers, each with their own keypair ────────────────────
NUM_WRITERS = 5
DOTS_PER_WRITER = 100
BASE_TS = 1741564800_000_000

keypairs = [
    crypto.generate_keypair(hashlib.sha256(f"writer-exp27-{i}".encode()).digest())
    for i in range(NUM_WRITERS)
]

# Each writer maintains its own private chain list — no sharing, no lock
chains = [[] for _ in range(NUM_WRITERS)]
corruption_counts = [0] * NUM_WRITERS
write_times = []


def write_chain(writer_id, kp, chain, count):
    """Single writer, single chain — no contention possible."""
    for i in range(count):
        prev = chain[-1] if chain else None
        d = create(
            payload=f"Writer {writer_id} dot {i}".encode(),
            keypair=kp,
            timestamp_us=BASE_TS + writer_id * 1_000_000 + i,
            parent=prev,
        )
        chain.append(d)


# ─── Phase 1: Concurrent writes, independent chains ──────────────────────────
t0 = time.perf_counter()

threads = [
    threading.Thread(
        target=write_chain,
        args=(i, keypairs[i], chains[i], DOTS_PER_WRITER)
    )
    for i in range(NUM_WRITERS)
]
for t in threads:
    t.start()
for t in threads:
    t.join()

elapsed = time.perf_counter() - t0
total_dots = sum(len(c) for c in chains)
throughput = total_dots / elapsed if elapsed > 0 else 0

# ─── Validate all 5 independent chains ───────────────────────────────────────
corruption = 0
for writer_id, chain in enumerate(chains):
    for i, dot_bytes in enumerate(chain):
        vr = verify(dot_bytes)
        if not vr.verified:
            corruption += 1
            continue
        if i > 0:
            r = dot_open(dot_bytes)
            expected = crypto.dot_hash(chain[i - 1])
            if r.parent_hash != expected:
                corruption += 1

# ─── EXP-23 reference throughput (locked, from RESULTS.md) ───────────────────
# EXP-23: 5 observers, 20 DOTs each (100 total), 36.2ms locked
EXP23_TOTAL_DOTS = 100
EXP23_LOCKED_MS = 36.2
exp23_throughput = EXP23_TOTAL_DOTS / (EXP23_LOCKED_MS / 1000.0)
speedup = throughput / exp23_throughput if exp23_throughput > 0 else 0

# ─── Phase 2: Cross-chain RELATION DOTs ──────────────────────────────────────
# 20 RELATION DOTs: each references one DOT from one chain and one DOT from another.
# We use type byte 0x0A (RELATION, per EXP-11) and store the two referenced hashes
# as JSON in the payload.

import json

NUM_RELATIONS = 20
relation_dots = []
relation_resolved = 0

# Build a flat lookup: hash_hex -> chain_id
hash_to_chain = {}
for cid, chain in enumerate(chains):
    for dot_bytes in chain:
        h = crypto.dot_hash(dot_bytes).hex()
        hash_to_chain[h] = cid

# Create 20 RELATION DOTs, each signed by writer 0's keypair
# (relation authors pick any; using writer 0 for determinism)
rel_kp = keypairs[0]
for k in range(NUM_RELATIONS):
    # Pick two different chains
    chain_a_id = k % NUM_WRITERS
    chain_b_id = (k + 2) % NUM_WRITERS
    if chain_a_id == chain_b_id:
        chain_b_id = (chain_b_id + 1) % NUM_WRITERS

    dot_a = chains[chain_a_id][k % DOTS_PER_WRITER]
    dot_b = chains[chain_b_id][(k * 3) % DOTS_PER_WRITER]
    hash_a = crypto.dot_hash(dot_a).hex()
    hash_b = crypto.dot_hash(dot_b).hex()

    payload = json.dumps({
        "type": "CROSS_CHAIN_RELATION",
        "dot_a": hash_a,
        "chain_a": chain_a_id,
        "dot_b": hash_b,
        "chain_b": chain_b_id,
        "relation": "related_to",
    }).encode()

    rel_dot = create(
        payload=payload,
        keypair=rel_kp,
        dot_type=0x0A,  # RELATION
        timestamp_us=BASE_TS + 10_000_000 + k,
    )
    relation_dots.append(rel_dot)

# Verify all relation DOTs and check referenced hashes can be found
for rel_dot in relation_dots:
    vr = verify(rel_dot)
    if not vr.verified:
        continue
    r = dot_open(rel_dot)
    try:
        data = json.loads(r.payload)
        ha = data["dot_a"]
        hb = data["dot_b"]
        if ha in hash_to_chain and hb in hash_to_chain:
            relation_resolved += 1
    except Exception:
        pass

all_relations_resolve = (relation_resolved == NUM_RELATIONS)

# Query time: find all DOTs related to chain 0 (i.e., RELATION DOTs that reference chain 0)
t_q0 = time.perf_counter()
chain0_relations = []
for rel_dot in relation_dots:
    r = dot_open(rel_dot)
    try:
        data = json.loads(r.payload)
        if data.get("chain_a") == 0 or data.get("chain_b") == 0:
            chain0_relations.append(rel_dot)
    except Exception:
        pass
query_us = (time.perf_counter() - t_q0) * 1_000_000

# ─── Print results ────────────────────────────────────────────────────────────
print("=" * 70)
print("  EXPERIMENT 27: ONE WRITER PER CHAIN (SATOSHI'S CONJECTURE)")
print("=" * 70)
print()
print(f"  INDEPENDENT CHAINS (no lock):")
print(f"    Writers:            {NUM_WRITERS} concurrent")
print(f"    DOTs per chain:     {DOTS_PER_WRITER}")
print(f"    Total DOTs:         {total_dots}")
print(f"    Corruption:         {corruption}/{total_dots} (expect 0)")
print(f"    Throughput:         {throughput:,.0f} DOTs/s")
print(f"    vs EXP-23 locked:   {speedup:.1f}x faster")
print()
print(f"  CROSS-CHAIN RELATIONS:")
print(f"    Relations created:  {NUM_RELATIONS}")
print(f"    All resolve:        {'YES' if all_relations_resolve else 'NO'}")
print(f"      (resolved {relation_resolved}/{NUM_RELATIONS})")
print(f"    Query time (find related to chain 0): {query_us:.0f}µs")
print()

if corruption == 0 and all_relations_resolve:
    conclusion = "DOES"
else:
    conclusion = "DOES NOT"

print(f"  CONCLUSION: One-writer-per-chain {conclusion} eliminate concurrency problem.")
print()
print(f"  KEY INSIGHT:")
print(f"    Independent chains need zero coordination — each writer owns its chain.")
print(f"    The graph layer (RELATION DOTs) merges knowledge across chains after the fact.")
print(f"    This maps directly to distributed systems: each node owns its log,")
print(f"    references are resolved lazily at read time, not write time.")
print()
print("  ✅ EXP-27 COMPLETE" if corruption == 0 and all_relations_resolve else "  ❌ EXP-27 FAILED")
print("=" * 70)

assert corruption == 0, f"Expected 0 corruption, got {corruption}"
assert all_relations_resolve, f"Expected all {NUM_RELATIONS} relations to resolve"
