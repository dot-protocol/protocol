"""
Experiment 32: Nostr Relay Censorship Simulation
3 relays (dicts). Alice publishes to all 3. Bob subscribes to all 3.
Tests relay censorship, out-of-order delivery, and duplicate handling.
"""

import sys
import os
import hashlib
import random
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── Setup ────────────────────────────────────────────────────────────────────
alice_kp = crypto.generate_keypair(hashlib.sha256(b"exp32-alice").digest())
bob_kp   = crypto.generate_keypair(hashlib.sha256(b"exp32-bob").digest())
BASE_TS  = 1741564800_000_000

print("=" * 70)
print("  EXPERIMENT 32: NOSTR RELAY CENSORSHIP SIMULATION")
print("=" * 70)
print()

# ─── Build 10 Alice DOTs ──────────────────────────────────────────────────────
alice_chain = []
for i in range(10):
    prev = alice_chain[-1] if alice_chain else None
    d = create(
        payload=f"Alice message {i}".encode(),
        keypair=alice_kp,
        timestamp_us=BASE_TS + i * 1_000_000,
        parent=prev,
    )
    alice_chain.append(d)

# Relay: dict of hash → dot_bytes
relay1 = {}
relay2 = {}
relay3 = {}

def publish(dot_bytes, *relays):
    h = crypto.dot_hash(dot_bytes)
    for relay in relays:
        relay[h] = dot_bytes

def subscribe(relays):
    """Merge all DOTs from given relays, dedup by hash."""
    seen = {}
    for relay in relays:
        for h, d in relay.items():
            seen[h] = d
    return seen

# ─── Scenario 1: Relay #2 drops all Alice DOTs ────────────────────────────────
print(f"  Scenario 1: Relay #2 censors Alice")
for d in alice_chain:
    publish(d, relay1, relay3)        # NOT relay2
    # relay2 intentionally gets nothing

bobs_received = subscribe([relay1, relay2, relay3])
scenario1_ok = len(bobs_received) == len(alice_chain)
print(f"    Alice sent: {len(alice_chain)} DOTs to relays 1+3")
print(f"    Bob received: {len(bobs_received)} DOTs (via all 3 relays)")
print(f"    Censorship survived: {'YES ✓' if scenario1_ok else 'NO ✗'}")
print()

# ─── Reset relays ─────────────────────────────────────────────────────────────
relay1.clear(); relay2.clear(); relay3.clear()

# ─── Scenario 2: Relays #1 and #2 both drop Alice DOTs ───────────────────────
print(f"  Scenario 2: Relays #1 and #2 censor Alice (only relay #3 works)")
for d in alice_chain:
    publish(d, relay3)               # Only relay3 gets them

bobs_received = subscribe([relay1, relay2, relay3])
scenario2_ok = len(bobs_received) == len(alice_chain)
print(f"    Alice sent: {len(alice_chain)} DOTs to relay 3 only")
print(f"    Bob received: {len(bobs_received)} DOTs")
print(f"    Single relay survives: {'YES ✓' if scenario2_ok else 'NO ✗'}")
print()

# ─── Scenario 3: All 3 relays drop Alice DOTs ─────────────────────────────────
relay1.clear(); relay2.clear(); relay3.clear()
print(f"  Scenario 3: All 3 relays censor Alice")
# Don't publish to any relay
bobs_received = subscribe([relay1, relay2, relay3])
scenario3_fail = len(bobs_received) == 0
print(f"    Alice sent: {len(alice_chain)} DOTs, 0 relays accepted")
print(f"    Bob received: {len(bobs_received)} DOTs")
print(f"    No delivery (expected): {'YES ✓' if scenario3_fail else 'NO ✗'}")
print()

# ─── Scenario 4: Out-of-order delivery ───────────────────────────────────────
relay1.clear(); relay2.clear(); relay3.clear()
print(f"  Scenario 4: Out-of-order delivery")

# Shuffle the 10 DOTs and publish in random order across relays
shuffled = alice_chain.copy()
random.seed(42)
random.shuffle(shuffled)
for i, d in enumerate(shuffled):
    relay = [relay1, relay2, relay3][i % 3]
    relay[crypto.dot_hash(d)] = d

# Bob collects from all relays
bobs_received = subscribe([relay1, relay2, relay3])

# Reconstruct chain: sort by parent hash linkage
def reconstruct_chain(dots_dict):
    """Sort DOTs into chain order by following parent_hash links."""
    dots = list(dots_dict.values())
    by_hash = {crypto.dot_hash(d): d for d in dots}
    # Find genesis (no parent)
    genesis = None
    for d in dots:
        r = dot_open(d)
        if r.parent_hash is None:
            genesis = d
            break
    if genesis is None:
        return []
    ordered = [genesis]
    current_hash = crypto.dot_hash(genesis)
    while True:
        next_dot = None
        for h, d in by_hash.items():
            r = dot_open(d)
            if r.parent_hash == current_hash:
                next_dot = d
                break
        if next_dot is None:
            break
        ordered.append(next_dot)
        current_hash = crypto.dot_hash(next_dot)
    return ordered

reconstructed = reconstruct_chain(bobs_received)
scenario4_ok = len(reconstructed) == len(alice_chain)

print(f"    Published in shuffled order: {[alice_chain.index(d) for d in shuffled]}")
print(f"    Bob received: {len(bobs_received)} DOTs (unordered)")
print(f"    Reconstructed chain length: {len(reconstructed)}/{len(alice_chain)}")
print(f"    Order correct: {'YES ✓' if scenario4_ok else 'NO ✗'}")
print()

# ─── Scenario 5: Duplicate delivery ───────────────────────────────────────────
relay1.clear(); relay2.clear(); relay3.clear()
print(f"  Scenario 5: Duplicate delivery (same DOT on all 3 relays)")
for d in alice_chain:
    publish(d, relay1, relay2, relay3)  # tripled

bobs_received = subscribe([relay1, relay2, relay3])  # dedup by hash
scenario5_ok = len(bobs_received) == len(alice_chain)
print(f"    Each DOT published to all 3 relays")
print(f"    Bob received (after dedup): {len(bobs_received)} DOTs (expected {len(alice_chain)})")
print(f"    Dedup works: {'YES ✓' if scenario5_ok else 'NO ✗'}")
print()

# ─── Relay discovery problem ──────────────────────────────────────────────────
print(f"  RELAY DISCOVERY PROBLEM:")
print(f"    In Nostr, relay URLs are shared out-of-band (Twitter bios, DNS records).")
print(f"    A new user joining the DOT network faces: which relays do my contacts use?")
print(f"    DOT protocol has no relay discovery mechanism.")
print(f"    Options: hardcoded default relays, DNS _dot._tcp SRV records,")
print(f"    or a bootstrap relay that indexes relay-user mapping DOTs.")
print(f"    This is a SOCIAL problem, not a cryptographic one.")
print()

# ─── Minimum relay redundancy ─────────────────────────────────────────────────
print(f"  MINIMUM RELAY REDUNDANCY:")
print(f"    1 relay: SPOF. Any relay down = no delivery.")
print(f"    2 relays: Survives 1 failure. Not Byzantine-safe.")
print(f"    3 relays: Survives 2 failures (Scenario 2 above). Recommended minimum.")
print(f"    Recommendation: publish to ≥3 relays, subscribe to ≥3 relays.")
print()

all_pass = scenario1_ok and scenario2_ok and scenario3_fail and scenario4_ok and scenario5_ok
print(f"  Result: {'PASS' if all_pass else 'PARTIAL'}")
print(f"  Key finding: Hash-based dedup handles duplicates. Parent-hash linkage")
print(f"  enables chain reconstruction from out-of-order delivery. 3 relays minimum.")
print(f"  Open issue: relay discovery — no protocol-level solution.")
print()
print(f"  {'✅' if all_pass else '⚠️'} EXP-32: {'PASS' if all_pass else 'PARTIAL'} — relay censorship survived, discovery gap documented")
print("=" * 70)
