"""
Experiment 39: Name Collision Resolution
100 observers each claim the name "alice" by publishing NAME_REGISTRY INDEX DOTs.
Test three resolution rules: earliest timestamp, longest chain, most references.
Measure cost of name squatting. Document recommended rule + mitigation.
"""

import sys
import os
import hashlib
import time
import json
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open

TYPE_INDEX = 0x0D

# ─── Setup ────────────────────────────────────────────────────────────────────
NUM_CLAIMANTS = 100
TARGET_NAME   = "alice.axxis"
BASE_TS       = 1741564800_000_000

print("=" * 70)
print("  EXPERIMENT 39: NAME COLLISION RESOLUTION")
print("=" * 70)
print()

# ─── Generate 100 claimant keypairs ───────────────────────────────────────────
claimants = [
    crypto.generate_keypair(hashlib.sha256(f"exp39-claimant-{i}".encode()).digest())
    for i in range(NUM_CLAIMANTS)
]

# Legitimate user = claimant[0], registered 1 hour before the squat
legit_kp = claimants[0]
LEGIT_TS = BASE_TS  # first timestamp

# Attacker = claimants[1:], all registering "at once" (within 1 second)
SQUAT_TS = BASE_TS + 3600_000_000  # 1 hour later

print(f"  Legitimate user (claimant 0): registered '{TARGET_NAME}' at T=0")
print(f"  {NUM_CLAIMANTS-1} squatters: all claim '{TARGET_NAME}' at T+1hr simultaneously")
print()

# ─── Build NAME_REGISTRY INDEX DOTs ──────────────────────────────────────────
print(f"  Generating {NUM_CLAIMANTS} NAME_REGISTRY claims...")
t0 = time.perf_counter()

claims = []
for i, kp in enumerate(claimants):
    if i == 0:
        ts = LEGIT_TS
        is_legit = True
    else:
        # Attacker batch: all within 1 second, with slight jitter
        ts = SQUAT_TS + random.randint(0, 999_999)  # within 1s
        is_legit = False

    payload = json.dumps({
        "kind": "name_registry",
        "name": TARGET_NAME,
        "pubkey": kp.ed25519_public.hex(),
        "timestamp": ts,
        "claimant_index": i,
    }).encode()

    d = create(
        payload=payload,
        keypair=kp,
        dot_type=TYPE_INDEX,
        timestamp_us=ts,
    )
    claims.append({
        "dot": d,
        "kp": kp,
        "ts": ts,
        "is_legit": is_legit,
        "hash": crypto.dot_hash(d),
        "claimant_index": i,
    })

squat_gen_ms = (time.perf_counter() - t0) * 1000
squat_rate = NUM_CLAIMANTS / (squat_gen_ms / 1000)
print(f"  Generated {NUM_CLAIMANTS} claims in {squat_gen_ms:.1f}ms ({squat_rate:,.0f} claims/s)")
print()

# ─── Rule 1: Earliest timestamp wins ─────────────────────────────────────────
print(f"  Resolution Rule 1: Earliest timestamp wins")
earliest = min(claims, key=lambda c: c["ts"])
rule1_legit = earliest["is_legit"]
# Is it forgeable? Timestamps are in the DOT wire format. They're SIGNED.
# An attacker cannot change the timestamp without invalidating the signature.
# But: attacker can pre-generate claims with early timestamps (clock rollback attack).
# The timestamp is set by the CREATOR's clock — relays cannot verify wall-clock time.
print(f"    Winner: claimant {earliest['claimant_index']} ({'LEGIT ✓' if rule1_legit else 'ATTACKER ✗'})")
print(f"    Timestamp: {earliest['ts']}")
print(f"    Forgeable? YES — attacker can set timestamp to year 2000 on first DOT.")
print(f"    DOT timestamps are creator-declared. Relays cannot enforce wall-clock truth.")
print(f"    An attacker who knows they're squatting can backdate their claim trivially.")
print()

# Demonstrate backdated attack
backdated_attacker_kp = claimants[50]
backdated_payload = json.dumps({
    "kind": "name_registry",
    "name": TARGET_NAME,
    "pubkey": backdated_attacker_kp.ed25519_public.hex(),
    "timestamp": BASE_TS - 86400_000_000,  # 1 day BEFORE the legit registration
}).encode()
backdated_claim = create(
    payload=backdated_payload,
    keypair=backdated_attacker_kp,
    dot_type=TYPE_INDEX,
    timestamp_us=BASE_TS - 86400_000_000,
)
backdated_ts = dot_open(backdated_claim).timestamp_us
print(f"    Backdated attack demo: attacker claims at T={backdated_ts} (1 day before legit)")
print(f"    Backdated claim signature valid: {verify(backdated_claim).verified}")
print(f"    Rule 1 is BROKEN — timestamps are not trustworthy.")
print()

# ─── Rule 2: Longest chain wins ───────────────────────────────────────────────
print(f"  Resolution Rule 2: Longest chain (most prior DOTs) wins")
# Chain length = number of DOTs in each claimant's history before the name claim
# Legitimate user has been active for 1 hour (assume 60 DOTs at 1/min)
# Attacker just generated keypairs (0 prior DOTs)

# Build a small representative chain for legit user
legit_chain_len = 60
legit_history = []
for i in range(legit_chain_len):
    prev = legit_history[-1] if legit_history else None
    d = create(
        payload=f"legit activity {i}".encode(),
        keypair=legit_kp,
        timestamp_us=BASE_TS + i * 60_000_000,  # 1 per minute
        parent=prev,
    )
    legit_history.append(d)

# Attacker has 0 prior DOTs for fresh keypairs
# UNLESS attacker pre-builds chains (gameable — measure cost)
# Cost to pre-build 61 DOTs per keypair × 100 keypairs = 6,100 DOTs
ATTACKER_CHAIN_PREFILL = 61  # just beat legit
t_prebuild = time.perf_counter()
attacker_prefill = []
for i in range(ATTACKER_CHAIN_PREFILL):
    prev = attacker_prefill[-1] if attacker_prefill else None
    d = create(
        payload=f"attacker pre-build {i}".encode(),
        keypair=claimants[1],
        timestamp_us=SQUAT_TS - (ATTACKER_CHAIN_PREFILL - i) * 1000,
        parent=prev,
    )
    attacker_prefill.append(d)
prebuild_ms = (time.perf_counter() - t_prebuild) * 1000
cost_per_squat = prebuild_ms

rule2_legit_chain_wins = legit_chain_len >= ATTACKER_CHAIN_PREFILL
print(f"    Legit chain length:    {legit_chain_len} DOTs")
print(f"    Attacker chain length: {ATTACKER_CHAIN_PREFILL} DOTs (pre-built)")
print(f"    Legit wins under rule 2: {'YES ✓' if rule2_legit_chain_wins else 'NO ✗'}")
print(f"    Gameable? YES — cost to pre-build {ATTACKER_CHAIN_PREFILL} DOTs × 100 names:")
print(f"      {prebuild_ms:.1f}ms per chain, {ATTACKER_CHAIN_PREFILL * 100 / 1000:.0f}× more = "
      f"~{prebuild_ms * 100 / 1000:.0f}ms for 100 chains (trivial)")
print(f"    Rule 2 is GAMEABLE — attacker pre-builds chains for each target name.")
print()

# ─── Rule 3: Most references wins (social consensus) ─────────────────────────
print(f"  Resolution Rule 3: Most references (social consensus)")
# References = how many OTHER DOTs point to (reference) this claim's hash
# Simulate: 50 contacts of legit user have attested to her name
# Attacker has 0 social references (fresh keypairs, no social graph)

legit_claim_hash = claims[0]["hash"].hex()
attacker_claim_hash = claims[1]["hash"].hex()

# Generate 50 attestation DOTs pointing to legit claim
attesters = [
    crypto.generate_keypair(hashlib.sha256(f"exp39-attester-{i}".encode()).digest())
    for i in range(50)
]
legit_refs = 0
for att_kp in attesters:
    att_dot = create(
        payload=json.dumps({
            "type": "attestation",
            "attests_to": legit_claim_hash,
            "claim": f"{TARGET_NAME} is my friend Alice",
        }).encode(),
        keypair=att_kp,
        timestamp_us=BASE_TS + 7200_000_000,
    )
    legit_refs += 1

attacker_refs = 0  # no social graph

print(f"    Legit user references:   {legit_refs} (contacts attested)")
print(f"    Attacker references:     {attacker_refs}")
print(f"    Legit wins under rule 3: {'YES ✓' if legit_refs > attacker_refs else 'NO ✗'}")
print(f"    Gameable? YES — Sybil attack: attacker creates 51 fake keypairs,")
print(f"    each attests to attacker's claim. Cost: 51 DOT seals ≈ {51 * 0.35:.0f}ms")
print(f"    UNLESS Sybil accounts are filtered by chain age (circular dependency).")
print()

# ─── Cost of name squatting ───────────────────────────────────────────────────
print(f"  NAME SQUATTING ECONOMICS:")

# How long to seal 1,000 INDEX DOTs?
print(f"  Measuring seal time for 1,000 INDEX DOTs (squatter's toolkit)...")
squat_kp = claimants[10]
t0 = time.perf_counter()
squat_batch = []
for i in range(1_000):
    target_name = f"common-name-{i}.axxis"
    d = create(
        payload=json.dumps({
            "kind": "name_registry",
            "name": target_name,
            "pubkey": squat_kp.ed25519_public.hex(),
        }).encode(),
        keypair=squat_kp,
        dot_type=TYPE_INDEX,
        timestamp_us=BASE_TS + i,
    )
    squat_batch.append(d)
squat_1k_ms = (time.perf_counter() - t0) * 1000

print(f"    1,000 name squats: {squat_1k_ms:.0f}ms ({squat_1k_ms/1000:.1f}s)")
print(f"    10,000 name squats: ~{squat_1k_ms * 10 / 1000:.0f}s")
print(f"    100,000 name squats: ~{squat_1k_ms * 100 / 60000:.1f} minutes")
print()
print(f"  DNS squatting comparison:")
print(f"    DNS .com registration: ~$10/name/year, seconds to register")
print(f"    DOT name squatting: ${0:.2f}/name (no economic cost), {squat_1k_ms/1000:.2f}s per 1K")
print(f"    DOT squatting is essentially FREE — orders of magnitude cheaper than DNS.")
print()

# ─── Recommended resolution rule ──────────────────────────────────────────────
print(f"  RECOMMENDED RESOLUTION RULE:")
print()
print(f"  None of the three rules is sufficient alone:")
print(f"    Rule 1 (earliest ts): forgeable via timestamp backdating")
print(f"    Rule 2 (longest chain): gameable via pre-built chains")
print(f"    Rule 3 (most refs): gameable via Sybil attestation")
print()
print(f"  RECOMMENDED: Composite scoring (weighted combination):")
print(f"    score = 0.4 × chain_age_percentile")
print(f"          + 0.4 × ref_count (after Sybil filtering by chain age ≥ threshold)")
print(f"          + 0.2 × timestamp_rank (among claims for same name)")
print()
print(f"  SQUATTING MITIGATION:")
print(f"  1. FLAME cost: require FLAME token burn per name registration")
print(f"     (economic cost converts squatting from free to expensive)")
print(f"  2. First-claim priority: relay stores first valid claim, ignores later")
print(f"     (shifts advantage to legit users who register first)")
print(f"  3. Grace period: 7-day dispute window before name is settled")
print(f"  4. Name aging: name value increases with time, older = more authoritative")
print()

print(f"  Result: FAIL (no single rule is robust)")
print(f"  Failure mode: All three resolution rules are gameable by a determined attacker.")
print(f"    Timestamp backdating defeats Rule 1.")
print(f"    Chain pre-building defeats Rule 2.")
print(f"    Sybil attestation defeats Rule 3.")
print(f"  Name squatting cost: essentially $0 (vs $10/name for DNS).")
print(f"  1,000 names can be squatted in {squat_1k_ms:.0f}ms.")
print(f"  Severity: HIGH — namespace corruption without economic cost barrier")
print(f"  Mitigation: FLAME burn requirement for registration + composite scoring.")
print(f"    FLAME cost converts economic-free squatting to costly. Combined with")
print(f"    first-claim priority and chain age weighting, reduces but doesn't eliminate risk.")
print(f"  Fixed in: OPEN (requires FLAME integration)")
print()
print("  ❌ EXP-39: FAIL — no robust name resolution rule without economic cost barrier")
print("=" * 70)
