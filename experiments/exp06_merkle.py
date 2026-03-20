"""
Experiment 6: Merkle Tree vs Linear Chain
1024 DOTs. Build Merkle tree, compare proof verification vs linear chain.
"""

import sys
import os
import time
import hashlib
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

N = 1024
TARGET_IDX = 512

kp = crypto.generate_keypair(hashlib.sha256(b"merkle-exp06").digest())

# Create 1024 DOTs
print("=" * 60)
print("  EXPERIMENT 06: MERKLE TREE VS LINEAR CHAIN")
print("=" * 60)
print()
print(f"  Creating {N} DOTs...")

WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
         "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi"]

dots = []
for i in range(N):
    payload = f"Observation {i}: {random.choice(WORDS)} {random.choice(WORDS)} {i*7}".encode()
    d = create(payload=payload, keypair=kp, dot_type=TYPE_OBSERVATION,
               timestamp_us=1741564800_000_000 + i * 1000)
    dots.append(d)

dot_hashes = [hashlib.sha256(d).digest() for d in dots]

# Merkle tree functions
def merkle_build(hashes):
    level = hashes[:]
    tree = [level[:]]
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [hashlib.sha256(level[i] + level[i+1]).digest()
                 for i in range(0, len(level), 2)]
        tree.append(level[:])
    return tree

def merkle_proof(tree, idx):
    proof = []
    for level in tree[:-1]:
        if idx % 2 == 0:
            sibling = level[idx+1] if idx+1 < len(level) else level[idx]
            proof.append(('right', sibling))
        else:
            proof.append(('left', level[idx-1]))
        idx //= 2
    return proof

def merkle_verify_proof(leaf_hash, proof, root):
    h = leaf_hash
    for side, sibling in proof:
        if side == 'right':
            h = hashlib.sha256(h + sibling).digest()
        else:
            h = hashlib.sha256(sibling + h).digest()
    return h == root

# Build Merkle tree
t0 = time.perf_counter()
tree = merkle_build(dot_hashes)
root = tree[-1][0]
t1 = time.perf_counter()
merkle_build_ms = (t1 - t0) * 1000

# Generate proof for DOT #512
proof = merkle_proof(tree, TARGET_IDX)

# Measure Merkle proof verification time
N_MERKLE_ITERS = 10000
t0 = time.perf_counter()
for _ in range(N_MERKLE_ITERS):
    valid = merkle_verify_proof(dot_hashes[TARGET_IDX], proof, root)
t1 = time.perf_counter()
merkle_verify_ms = (t1 - t0) * 1000 / N_MERKLE_ITERS

assert valid, "Merkle proof verification failed!"

# Linear chain: measure time to hash DOTs #0-#511 to verify position
N_LINEAR_ITERS = 100
t0 = time.perf_counter()
for _ in range(N_LINEAR_ITERS):
    running_hash = dot_hashes[0]
    for j in range(1, TARGET_IDX + 1):
        running_hash = hashlib.sha256(running_hash + dot_hashes[j]).digest()
t1 = time.perf_counter()
linear_verify_ms = (t1 - t0) * 1000 / N_LINEAR_ITERS

speedup = linear_verify_ms / merkle_verify_ms

# Proof size in bytes
proof_bytes = sum(32 for _, _ in proof)  # each sibling is 32 bytes
proof_hops = len(proof)

print(f"  Merkle tree built over {N} DOTs")
print(f"  Tree depth: {len(tree)-1} levels")
print(f"  Root hash: {root.hex()[:32]}...")
print()
print(f"  LINEAR CHAIN (hash DOTs #0-#511):")
print(f"    Time:              {linear_verify_ms:.3f} ms")
print(f"    Operations:        {TARGET_IDX} hash operations")
print()
print(f"  MERKLE PROOF (DOT #512):")
print(f"    Time:              {merkle_verify_ms:.6f} ms ({merkle_verify_ms*1000:.2f} µs)")
print(f"    Proof hops:        {proof_hops} (log2({N}) = {proof_hops})")
print(f"    Proof size:        {proof_bytes} bytes ({proof_hops} × 32)")
print(f"    Proof valid:       {valid}")
print()
print(f"  SPEEDUP:             {speedup:.0f}x faster with Merkle")
print(f"  (Any DOT in {N}-DOT archive verifiable in {proof_hops} operations vs {TARGET_IDX})")
print()
print("  EXPERIMENT 06 PASSED")
print("=" * 60)
