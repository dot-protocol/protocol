"""
Experiment 31: Timing Attack on Encrypted DOTs
AES-GCM does NOT pad — ciphertext length == plaintext length.
Measure encrypted DOT sizes for various payload lengths to confirm size leakage.
Propose fix: padding to power-of-2 buckets.
"""

import sys
import os
import hashlib
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open

# ─── Setup ────────────────────────────────────────────────────────────────────
alice_kp = crypto.generate_keypair(hashlib.sha256(b"exp31-alice").digest())
bob_kp   = crypto.generate_keypair(hashlib.sha256(b"exp31-bob").digest())
BASE_TS  = 1741564800_000_000

print("=" * 70)
print("  EXPERIMENT 31: TIMING ATTACK ON ENCRYPTED DOTs")
print("=" * 70)
print()

# ─── Fixed overhead for Suite 1 encrypted DOT ─────────────────────────────────
# HEADER:           12 bytes
# CREATOR_KEY:      35 bytes (1+2+32)
# TIMESTAMP:         8 bytes
# RECIPIENTS(1):    96 bytes (1 count + 95 per recipient: 1+2+32+60)
# PAYLOAD overhead: 28 bytes (12 nonce + 16 GCM tag)
# SIGNATURE:        67 bytes (1+2+64)
# ─────────────────────────────────────────────────────────────────────────────
FIXED_OVERHEAD = 12 + 35 + 8 + 96 + 28 + 67  # = 246 bytes

PAYLOAD_SIZES = [2, 18, 100, 1024, 10240]

print(f"  {'Plaintext':>12}  {'Encrypted DOT':>14}  {'Fixed OH':>10}  "
      f"{'AES overhead':>13}  {'Size reveals length?':>21}")
print(f"  {'-'*12}  {'-'*14}  {'-'*10}  {'-'*13}  {'-'*21}")

results = []
for pt_len in PAYLOAD_SIZES:
    payload = os.urandom(pt_len)  # random bytes, no compressibility
    dot_enc = create(
        payload=payload,
        keypair=alice_kp,
        recipient_keys=[bob_kp.ed25519_public],
        timestamp_us=BASE_TS,
    )
    total_size = len(dot_enc)
    # AES-GCM: ciphertext_len == plaintext_len (no padding)
    # PAYLOAD_LENGTH in header = nonce(12) + ciphertext + tag(16)
    encrypted_payload_len = pt_len + 28  # nonce + tag overhead only
    inferred_fixed = total_size - encrypted_payload_len
    leaks_length = True  # AES-GCM never pads

    results.append({
        "pt_len": pt_len,
        "total_size": total_size,
        "inferred_fixed": inferred_fixed,
        "leaks_length": leaks_length,
    })

    print(f"  {pt_len:>12,}B  {total_size:>14,}B  {inferred_fixed:>10}  "
          f"{'nonce+tag=28B':>13}  {'YES':>21}")

print()
print(f"  Fixed overhead (all cases): {results[0]['inferred_fixed']}B (expected {FIXED_OVERHEAD}B)")
print()

# ─── Demonstrate the attack ───────────────────────────────────────────────────
print(f"  ATTACK DEMONSTRATION:")
print(f"    A passive Nostr relay observer sees only ciphertext sizes.")
print(f"    Given TOTAL_SIZE, they compute:")
print(f"      plaintext_len = TOTAL_SIZE - {FIXED_OVERHEAD}")
print(f"    Examples from this run:")
for r in results:
    inferred_pt = r["total_size"] - FIXED_OVERHEAD
    print(f"      DOT size {r['total_size']:>6}B → inferred plaintext = {inferred_pt}B "
          f"(actual: {r['pt_len']}B) — match: {'✓' if inferred_pt == r['pt_len'] else '✗'}")
print()

# ─── Proposed fixes ────────────────────────────────────────────────────────────
print(f"  PROPOSED FIXES:")
print()
print(f"  Fix 1: Pad to next power of 2")
def pad_to_pow2(pt_len):
    if pt_len == 0:
        return 1
    return 2 ** math.ceil(math.log2(max(pt_len, 1)))

print(f"    {'Plaintext':>12}  {'Padded to':>12}  {'Overhead':>10}  {'Leaks range':>20}")
print(f"    {'-'*12}  {'-'*12}  {'-'*10}  {'-'*20}")
for pt_len in PAYLOAD_SIZES:
    padded = pad_to_pow2(pt_len)
    overhead_pct = (padded - pt_len) / padded * 100
    # After padding, observer only knows: plaintext is in (padded/2, padded]
    range_str = f"({padded//2 if padded > 1 else 0}, {padded}]"
    print(f"    {pt_len:>12,}B  {padded:>12,}B  {overhead_pct:>9.1f}%  {range_str:>20}")

print()
print(f"  Fix 2: Fixed size buckets (256B / 1KB / 4KB / 16KB / 64KB)")
BUCKETS = [256, 1024, 4096, 16384, 65536]
print(f"    {'Plaintext':>12}  {'Bucket':>10}  {'Overhead':>10}")
print(f"    {'-'*12}  {'-'*10}  {'-'*10}")
for pt_len in PAYLOAD_SIZES:
    bucket = next((b for b in BUCKETS if b >= pt_len), BUCKETS[-1])
    overhead_pct = (bucket - pt_len) / bucket * 100
    print(f"    {pt_len:>12,}B  {bucket:>10,}B  {overhead_pct:>9.1f}%")

print()
print(f"  Fix 3: Combine with Noise Protocol-style message framing")
print(f"    (out of scope for DOT v1 — transport layer concern)")
print()

print(f"  Result: FAIL")
print(f"  Failure mode: AES-256-GCM is length-preserving. Encrypted DOT size")
print(f"  directly reveals plaintext length: plaintext_len = total_size - {FIXED_OVERHEAD}B.")
print(f"  A passive relay observer learns message length for every encrypted DOT.")
print(f"  Severity: HIGH — length reveals conversation patterns (short=emoji, long=essay)")
print(f"  Mitigation: Pad payload to power-of-2 before encryption. Leaks only the")
print(f"  range (e.g., 'between 512B and 1KB'). Add TLV_PADDING optional tag.")
print(f"  Fixed in: OPEN (requires application-layer padding before create())")
print()
print("  ❌ EXP-31: FAIL — size reveals plaintext length exactly")
print("=" * 70)
