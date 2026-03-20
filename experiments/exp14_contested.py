"""
Experiment 14: Contested Knowledge Graph
Two observers with conflicting claims. Disagreement IS data.
"""

import sys
import os
import json
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION, TYPE_ATTESTATION

TS_BASE = 1741564800_000_000

# Two keypairs
alice_seed = hashlib.sha256(b"contested-alice").digest()
bob_seed = hashlib.sha256(b"contested-bob").digest()
alice = crypto.generate_keypair(alice_seed)
bob = crypto.generate_keypair(bob_seed)

# Build chain lengths (establishes "weight")
# Alice: chain of 5 DOTs
alice_chain = []
prev = None
for i in range(5):
    payload = f"Alice observation {i}: building trust through consistent recording.".encode()
    if prev is None:
        d = create(payload=payload, keypair=alice, dot_type=TYPE_OBSERVATION,
                   timestamp_us=TS_BASE + i * 1000)
    else:
        d = create(payload=payload, keypair=alice, dot_type=TYPE_OBSERVATION,
                   timestamp_us=TS_BASE + i * 1000, parent=prev)
    alice_chain.append(d)
    prev = d

# Bob: chain of 3 DOTs
bob_chain = []
prev = None
for i in range(3):
    payload = f"Bob observation {i}: providing independent verification.".encode()
    if prev is None:
        d = create(payload=payload, keypair=bob, dot_type=TYPE_OBSERVATION,
                   timestamp_us=TS_BASE + i * 2000)
    else:
        d = create(payload=payload, keypair=bob, dot_type=TYPE_OBSERVATION,
                   timestamp_us=TS_BASE + i * 2000, parent=prev)
    bob_chain.append(d)
    prev = d

# Alice's claim: Newton INFLUENCED Einstein
alice_claim_payload = json.dumps({
    "from": "Newton",
    "to": "Einstein",
    "relation": "INFLUENCED",
    "evidence": "Einstein cited Newton's Principia in 1905"
}).encode()
alice_claim = create(
    payload=alice_claim_payload,
    keypair=alice,
    dot_type=TYPE_ATTESTATION,
    timestamp_us=TS_BASE + 10000,
    parent=alice_chain[-1],
)

# Bob's claim: Newton DID_NOT_INFLUENCE Einstein
bob_claim_payload = json.dumps({
    "from": "Newton",
    "to": "Einstein",
    "relation": "DID_NOT_INFLUENCE",
    "evidence": "Einstein's special relativity arose independently from Lorentz/Poincare"
}).encode()
bob_claim = create(
    payload=bob_claim_payload,
    keypair=bob,
    dot_type=TYPE_ATTESTATION,
    timestamp_us=TS_BASE + 10000,
    parent=bob_chain[-1],
)

# "Graph" = all observations
graph = {
    "alice_chain": alice_chain,
    "bob_chain": bob_chain,
    "alice_claim": alice_claim,
    "bob_claim": bob_claim,
}

# Query: "What is the relationship between Newton and Einstein?"
query_subject = ("Newton", "Einstein")
contested_observations = []

from dot_protocol.container import open as dot_open
for owner, dot_bytes in [("Alice", alice_claim), ("Bob", bob_claim)]:
    vr = verify(dot_bytes)
    result = dot_open(dot_bytes)
    claim_data = json.loads(result.payload)
    chain_len = len(alice_chain) if owner == "Alice" else len(bob_chain)
    contested_observations.append({
        "owner": owner,
        "creator_key": vr.creator_key_hex[:16],
        "relation": claim_data["relation"],
        "evidence": claim_data["evidence"],
        "chain_length": chain_len,
        "verified": vr.verified,
    })

# Weighted consensus
total_weight = sum(o["chain_length"] for o in contested_observations)
for obs in contested_observations:
    obs["weight"] = obs["chain_length"] / total_weight
    obs["weight_pct"] = obs["weight"] * 100

# Verify all DOTs
all_dots = alice_chain + bob_chain + [alice_claim, bob_claim]
all_verified = all(verify(d).verified for d in all_dots)

print("=" * 70)
print("  EXPERIMENT 14: CONTESTED KNOWLEDGE GRAPH")
print("=" * 70)
print()
print(f"  Query: Newton → Einstein relationship")
print()
print(f"  TWO COEXISTING OBSERVATIONS (no conflict error):")
for obs in contested_observations:
    print(f"  ─── {obs['owner']} ({'verified' if obs['verified'] else 'INVALID'}) ───")
    print(f"    Creator key:  {obs['creator_key']}...")
    print(f"    Relation:     {obs['relation']}")
    print(f"    Evidence:     {obs['evidence']}")
    print(f"    Chain length: {obs['chain_length']} DOTs (trust weight)")
print()
print(f"  WEIGHTED CONSENSUS (chain length = trust weight):")
for obs in contested_observations:
    bar = "█" * int(obs['weight_pct'] / 5)
    print(f"    {obs['owner']:<10s}: {obs['weight_pct']:5.1f}%  {bar}  ({obs['relation']})")
print()
print(f"  Total weight: {total_weight} (Alice: {alice_chain.__len__()}, Bob: {bob_chain.__len__()})")
print()
print(f"  All DOTs verifiable: {all_verified}")
print(f"  Total DOTs: {len(all_dots)}")
print()
print(f"  KEY INSIGHT: Both claims coexist. No conflict error.")
print(f"  Disagreement IS data. The protocol records truth AND contradiction.")
print()
print("  EXPERIMENT 14 PASSED" if all_verified else "  EXPERIMENT 14 FAILED")
print("=" * 70)
