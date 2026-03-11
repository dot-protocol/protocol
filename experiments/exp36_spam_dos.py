"""
Experiment 36: Spam / DoS on Public Channels
Attacker floods a public channel with valid DOTs at 100/second.
After 1 hour: 360,000 spam vs 4 legitimate DOTs.
Test filters. Find render latency threshold. Expected: FAIL (no protocol-level resistance).
"""

import sys
import os
import hashlib
import time
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── Setup ────────────────────────────────────────────────────────────────────
legit_kps = [
    crypto.generate_keypair(hashlib.sha256(f"exp36-legit-{i}".encode()).digest())
    for i in range(10)
]
attacker_kps = [
    crypto.generate_keypair(hashlib.sha256(f"exp36-attacker-{i}".encode()).digest())
    for i in range(5)  # attacker can generate many keypairs cheaply
]

BASE_TS = 1741564800_000_000
CHANNEL_TAG = b"public-channel-exp36"

print("=" * 70)
print("  EXPERIMENT 36: SPAM / DOS ON PUBLIC CHANNELS")
print("=" * 70)
print()

# ─── Simulate 1 hour of traffic ───────────────────────────────────────────────
# Legitimate: 10 observers, 100 DOTs/day ≈ 0.069 DOTs/min ≈ 100 DOTs over 24h
# In 1 hour: ~4 legitimate DOTs
# Attacker: 100 DOTs/second × 3600 seconds = 360,000 DOTs

LEGIT_IN_1H    = 4
SPAM_IN_1H     = 360_000  # simulated, not actually generated (would take minutes)
# For performance test, use a smaller N but extrapolate
SPAM_SAMPLE    = 10_000   # generate 10K spam DOTs for timing

print(f"  Legitimate traffic (1hr): {LEGIT_IN_1H} DOTs (10 users × 100 DOTs/day)")
print(f"  Spam traffic (1hr):       {SPAM_IN_1H:,} DOTs (attacker @ 100/s)")
print(f"  Signal-to-noise ratio:    {LEGIT_IN_1H}/{SPAM_IN_1H:,} = {LEGIT_IN_1H/SPAM_IN_1H*100:.4f}%")
print()

# ─── Generate legitimate DOTs ────────────────────────────────────────────────
legit_dots = []
for i in range(LEGIT_IN_1H):
    kp = legit_kps[i % len(legit_kps)]
    d = create(
        payload=f"legit message {i}: important discussion point".encode(),
        keypair=kp,
        timestamp_us=BASE_TS + i * 900_000_000,  # every 15 minutes
    )
    legit_dots.append(d)

# ─── Generate spam DOTs (sample set for timing) ───────────────────────────────
print(f"  Generating {SPAM_SAMPLE:,} spam DOTs (for timing)...")
t0 = time.perf_counter()
spam_dots = []
for i in range(SPAM_SAMPLE):
    kp = attacker_kps[i % len(attacker_kps)]
    d = create(
        payload=f"SPAM {i} buy now free money".encode(),
        keypair=kp,
        timestamp_us=BASE_TS + i * 10_000,  # 10ms apart = 100/s rate
    )
    spam_dots.append(d)
spam_gen_ms = (time.perf_counter() - t0) * 1000
spam_rate = SPAM_SAMPLE / (spam_gen_ms / 1000)

print(f"  Generated {SPAM_SAMPLE:,} spam DOTs in {spam_gen_ms:.0f}ms ({spam_rate:,.0f} DOTs/s)")
print()

# ─── All spam DOTs are VALID ──────────────────────────────────────────────────
sample_size = min(100, len(spam_dots))
valid_count = sum(1 for d in spam_dots[:sample_size] if verify(d).verified)
print(f"  Spam DOT validity check (sample {sample_size}): {valid_count}/{sample_size} valid")
print(f"  All spam DOTs have correct Ed25519 signatures — protocol cannot reject them.")
print()

# ─── Filter implementations ───────────────────────────────────────────────────
print(f"  FILTER TESTS:")
print()

all_dots = legit_dots + spam_dots  # total pool for filtering

# 1. Chain age filter
print(f"  Filter 1: Chain age (min chain length = 5 DOTs)")
# Legit users have chains; attacker used fresh keypairs with no prior history
# In simulation: we only have single DOTs per keypair. Legit would have history.
# Approximate: attacker keypairs have 0-2 prior DOTs (fresh); legit has 50+
LEGIT_CHAIN_AGE_MIN = 5  # require at least 5 prior DOTs from this key

# Our generated dots are all standalone — simulate chain age via keypair history
legit_key_set   = set(kp.ed25519_public.hex() for kp in legit_kps)
attacker_key_set = set(kp.ed25519_public.hex() for kp in attacker_kps)

# Count per-key DOTs in all_dots
from collections import Counter
key_dot_counts = Counter()
for d in all_dots:
    r = verify(d)
    key_dot_counts[r.creator_key_hex] += 1

passed_chain_age = []
for d in all_dots:
    r = verify(d)
    if key_dot_counts[r.creator_key_hex] >= LEGIT_CHAIN_AGE_MIN:
        passed_chain_age.append(d)

legit_pass_1 = sum(1 for d in passed_chain_age if verify(d).creator_key_hex in {k.hex() for k in [kp.ed25519_public for kp in legit_kps]})
spam_pass_1  = len(passed_chain_age) - legit_pass_1
print(f"    Passed filter: {len(passed_chain_age):,} DOTs (legit: {legit_pass_1}, spam: {spam_pass_1:,})")
print(f"    Spam filtered: {(len(spam_dots) - spam_pass_1):,}/{len(spam_dots):,} ({(len(spam_dots)-spam_pass_1)/len(spam_dots)*100:.1f}%)")
print(f"    Problem: attacker can pre-build chain age. Cost: ~{LEGIT_CHAIN_AGE_MIN} DOTs per keypair.")
print()

# 2. Rate limiting by pubkey
print(f"  Filter 2: Rate limit — max 10 DOTs/hour per pubkey")
RATE_LIMIT_PER_HOUR = 10

rate_passed = []
rate_counts = Counter()
for d in sorted(all_dots, key=lambda x: verify(x).timestamp_us):
    r = verify(d)
    if rate_counts[r.creator_key_hex] < RATE_LIMIT_PER_HOUR:
        rate_passed.append(d)
        rate_counts[r.creator_key_hex] += 1

legit_pass_2 = sum(1 for d in rate_passed if verify(d).creator_key_hex in {kp.ed25519_public.hex() for kp in legit_kps})
spam_pass_2  = len(rate_passed) - legit_pass_2
print(f"    Passed filter: {len(rate_passed):,} DOTs (legit: {legit_pass_2}, spam: {spam_pass_2:,})")
print(f"    Spam filtered: {(len(spam_dots) - spam_pass_2):,}/{len(spam_dots):,} ({(len(spam_dots)-spam_pass_2)/len(spam_dots)*100:.1f}%)")
print(f"    Problem: attacker uses {len(attacker_kps)} keypairs, each gets {RATE_LIMIT_PER_HOUR} slots")
print(f"    → {len(attacker_kps) * RATE_LIMIT_PER_HOUR} spam DOTs pass rate limit. Attacker generates 100 keypairs → 1,000 pass.")
print()

# 3. Proof of work simulation
print(f"  Filter 3: Proof of Work (hash puzzle — not in DOT v1)")
# Simulate: require first N bits of SHA256(dot_bytes) == 0
# At N=8: probability 1/256 → attacker generates 256x more DOTs to compensate
# At N=16: probability 1/65536 → near-impossible at 100/s
# DOT v1 has no PoW field. This would require wire format extension.
POW_BITS = 8  # simulated requirement
import hashlib

def has_pow(dot_bytes, bits):
    h = hashlib.sha256(dot_bytes).digest()
    required_bytes = bits // 8
    required_remainder = bits % 8
    for i in range(required_bytes):
        if h[i] != 0:
            return False
    if required_remainder > 0:
        mask = 0xFF << (8 - required_remainder)
        if h[required_bytes] & mask:
            return False
    return True

# Sample how many spam DOTs would pass (statistically 1/256 for 8 bits)
sample_pow = spam_dots[:1000]
pow_pass_sample = sum(1 for d in sample_pow if has_pow(d, POW_BITS))
pow_pass_rate = pow_pass_sample / len(sample_pow)
extrapolated_spam_pass = int(len(spam_dots) * pow_pass_rate)

print(f"    POW requirement: {POW_BITS} leading zero bits")
print(f"    Expected pass rate: 1/{2**POW_BITS} = {100/2**POW_BITS:.2f}%")
print(f"    Measured in sample: {pow_pass_sample}/{len(sample_pow)} = {pow_pass_rate*100:.2f}%")
print(f"    Extrapolated spam passing: ~{extrapolated_spam_pass:,}/{len(spam_dots):,}")
print(f"    Problem: DOT v1 has no PoW field. Requires wire format extension.")
print(f"    Also: attacker with GPU can solve 8-bit PoW trivially.")
print()

# 4. Render latency threshold
print(f"  RENDER LATENCY THRESHOLD:")
# How many DOTs can a client render before >500ms?
# Measure time to open() + display (simulate as dict lookup + format)
RENDER_SAMPLE = 10_000
t_render = time.perf_counter()
displayed = []
for d in spam_dots[:RENDER_SAMPLE]:
    r = dot_open(d)
    displayed.append({
        "creator": r.creator_key_hex[:8],
        "payload": r.payload[:50].decode("utf-8", errors="replace"),
    })
render_elapsed_ms = (time.perf_counter() - t_render) * 1000
render_per_dot_us = render_elapsed_ms * 1000 / RENDER_SAMPLE
render_500ms_limit = int(500 / (render_elapsed_ms / RENDER_SAMPLE))

print(f"    Render {RENDER_SAMPLE:,} DOTs: {render_elapsed_ms:.0f}ms ({render_per_dot_us:.1f}µs/DOT)")
print(f"    At >500ms render threshold: client saturates at ~{render_500ms_limit:,} DOTs")
print(f"    At {spam_rate:,.0f} DOTs/s spam rate: threshold hit after {render_500ms_limit/spam_rate:.1f}s of spam")
print(f"    After 1hr: {SPAM_IN_1H:,} DOTs in channel → any unfiltered render attempt → unusable")
print()

# ─── Conclusion ───────────────────────────────────────────────────────────────
print(f"  CONCLUSION:")
print(f"    DOT protocol has NO protocol-level spam resistance.")
print(f"    Valid signatures prove identity but not legitimacy.")
print(f"    All filters are application/relay-layer and gameable:")
print(f"      Chain age: attacker pre-builds chains")
print(f"      Rate limit: attacker generates more keypairs")
print(f"      PoW: requires wire format extension, GPU defeats low bit-counts")
print(f"    Public channels are effectively unusable under determined spam attack.")
print()

print(f"  Result: FAIL")
print(f"  Failure mode: No protocol-level spam resistance. 360,000 valid spam DOTs/hr")
print(f"  overwhelm 4 legitimate DOTs. Client render saturates at ~{render_500ms_limit:,} DOTs.")
print(f"  All filters (chain age, rate limit, PoW) are gameable or require wire changes.")
print(f"  Severity: CRITICAL for public channels — DMs are unaffected (invite-only context).")
print(f"  Mitigation: FLAME token (anti-spam energy, referenced in AXXIS spec) for public")
print(f"  channels. Economic cost per DOT prevents mass spam. Private channels unaffected.")
print(f"  Fixed in: OPEN (requires FLAME integration or relay-level moderation)")
print()
print("  ❌ EXP-36: FAIL — no protocol-level spam resistance for public channels")
print("=" * 70)
