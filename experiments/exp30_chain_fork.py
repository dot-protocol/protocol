"""
Experiment 30: Chain Fork (Byzantine Observer)
Alice creates two valid DOT #10s with the same prev_hash but different payloads.
Bob and Carol each see one. Is there any protocol mechanism to detect/resolve the fork?
Expected: FAIL — DOT has no fork-choice rule.
"""

import sys
import os
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── Setup ────────────────────────────────────────────────────────────────────
alice_kp = crypto.generate_keypair(hashlib.sha256(b"exp30-alice").digest())
BASE_TS  = 1741564800_000_000

print("=" * 70)
print("  EXPERIMENT 30: CHAIN FORK (BYZANTINE OBSERVER)")
print("=" * 70)
print()

# ─── Build 9 legitimate DOTs ──────────────────────────────────────────────────
chain = []
for i in range(9):
    prev = chain[-1] if chain else None
    d = create(
        payload=f"legitimate DOT {i}".encode(),
        keypair=alice_kp,
        timestamp_us=BASE_TS + i,
        parent=prev,
    )
    chain.append(d)

dot9 = chain[-1]
prev_hash_of_9 = crypto.dot_hash(dot9)

print(f"  Chain built: DOTs #0-#8 ({len(chain)} DOTs)")
print(f"  DOT #9 will be forked at prev_hash: {prev_hash_of_9.hex()[:16]}...")
print()

# ─── Fork: Two valid DOT #10s from the same parent ────────────────────────────
dot10_honest = create(
    payload=b"honest message: Alice says hello",
    keypair=alice_kp,
    timestamp_us=BASE_TS + 9,
    parent=dot9,
)

dot10_evil = create(
    payload=b"EVIL message: Alice authorises transfer of all funds",
    keypair=alice_kp,
    timestamp_us=BASE_TS + 9,   # same timestamp — or could differ
    parent=dot9,                 # same parent → same prev_hash
)

# ─── Verify both are individually valid ───────────────────────────────────────
vr_honest = verify(dot10_honest)
vr_evil   = verify(dot10_evil)

print(f"  DOT #10 (honest):   verified={vr_honest.verified}, size={len(dot10_honest)}B")
print(f"  DOT #10b (evil):    verified={vr_evil.verified},   size={len(dot10_evil)}B")
print()

both_valid = vr_honest.verified and vr_evil.verified

# ─── Both have the same parent hash ───────────────────────────────────────────
r_honest = dot_open(dot10_honest)
r_evil   = dot_open(dot10_evil)

same_parent = r_honest.parent_hash == r_evil.parent_hash
different_payload = r_honest.payload != r_evil.payload
different_hash = crypto.dot_hash(dot10_honest) != crypto.dot_hash(dot10_evil)

print(f"  Same parent_hash:        {same_parent}")
print(f"  Different payloads:      {different_payload}")
print(f"  Different DOT hashes:    {different_hash}")
print()

# ─── Bob gets honest, Carol gets evil — can they detect the fork? ─────────────
# Bob's view: chain + dot10_honest
bobs_chain = chain + [dot10_honest]
# Carol's view: chain + dot10_evil
carols_chain = chain + [dot10_evil]

def verify_chain_integrity(c, label):
    """Verify each DOT in the chain links correctly to its predecessor."""
    for i in range(1, len(c)):
        r = dot_open(c[i])
        expected_parent = crypto.dot_hash(c[i-1])
        if r.parent_hash != expected_parent:
            return False, f"Chain broken at position {i}"
    return True, "chain intact"

bobs_ok, bobs_msg   = verify_chain_integrity(bobs_chain, "Bob")
carols_ok, carols_msg = verify_chain_integrity(carols_chain, "Carol")

print(f"  Bob's chain integrity:   {bobs_msg} → {'✓' if bobs_ok else '✗'}")
print(f"  Carol's chain integrity: {carols_msg} → {'✓' if carols_ok else '✗'}")
print()

# ─── Is there any protocol mechanism to detect or resolve the fork? ────────────
# DOT protocol checks:
# 1. Both DOTs have valid signatures (creator = Alice's key)
# 2. Both have valid parent_hash (same parent)
# 3. Both are independently well-formed
# There is NO chain_height field, NO fork_id, NO longest-chain rule in the protocol.

protocol_can_detect_fork  = False
protocol_can_resolve_fork = False

# The ONLY way to detect: compare chain states between peers (out-of-band)
# If Bob and Carol exchange their DOT #10 hashes, they can see the mismatch.
bobs_tip_hash   = crypto.dot_hash(dot10_honest).hex()
carols_tip_hash = crypto.dot_hash(dot10_evil).hex()
detectable_via_gossip = (bobs_tip_hash != carols_tip_hash)

print(f"  Protocol-level fork detection:  {'YES' if protocol_can_detect_fork else 'NO'}")
print(f"  Protocol-level fork resolution: {'YES' if protocol_can_resolve_fork else 'NO'}")
print(f"  Detectable via peer gossip:     {'YES' if detectable_via_gossip else 'NO'}")
print(f"    (Bob tip: {bobs_tip_hash[:16]}...)")
print(f"    (Carol tip: {carols_tip_hash[:16]}...)")
print()

print(f"  FORK ANALYSIS:")
print(f"    Alice produced two valid DOTs with the same parent_hash.")
print(f"    Both have a valid Ed25519 signature from Alice's key.")
print(f"    DOT protocol has no fork-choice rule (no Nakamoto consensus,")
print(f"    no longest-chain preference, no fork height field).")
print(f"    Bob and Carol each have a valid, internally consistent chain.")
print(f"    They cannot discover the contradiction without out-of-band communication.")
print()
print(f"  KNOWN LIMITATION (by design):")
print(f"    DOT is a file format, not a consensus protocol.")
print(f"    Fork-choice is a transport/relay layer concern, not a DOT concern.")
print(f"    Nostr relay: publish both; higher-layer apps (e.g., Kin) choose tip.")
print(f"    Mitigations: relay dedup by creator+timestamp, app-level fork detection.")
print()

print(f"  Result: FAIL (by design)")
print(f"  Failure mode: No fork-choice rule in DOT protocol. Both DOT #10 variants")
print(f"  are individually valid. The protocol cannot detect or resolve forks.")
print(f"  Severity: MEDIUM (known limitation, not a bug)")
print(f"  Mitigation: Transport layer (Nostr relays) detect same creator+timestamp")
print(f"  with different hashes. Application layer: last-writer-wins or longest-chain")
print(f"  heuristic. Protocol layer: add chain_sequence_number TLV extension.")
print(f"  Fixed in: OPEN (transport/application layer concern)")
print()
print("  ❌ EXP-30: FAIL (known limitation, documented)")
print("=" * 70)
