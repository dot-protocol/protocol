"""
Experiment 8: Chain Compression Ratio
1000 DOTs with business journal payloads. Compare 4 compression approaches.
"""

import sys
import os
import gzip
import zlib
import hashlib
import difflib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, TYPE_OBSERVATION

TIMESTAMP_BASE = 1741564800_000_000
N = 1000

kp = crypto.generate_keypair(hashlib.sha256(b"compression-exp08").digest())

# Generate "business journal" style payloads
revenues = ["12", "8", "15", "3", "22", "7", "19", "11", "5", "25"]
customers = ["Acme Corp", "TechStart", "MegaCo", "Finova", "BrightAI",
             "DataFlow", "CloudBase", "NexGen", "PrimeSoft", "Vertex"]
actions = ["review contract", "schedule demo", "send proposal", "close deal",
           "onboard team", "deploy system", "migrate data", "train staff"]

payloads = []
for i in range(N):
    r = revenues[i % len(revenues)]
    c = customers[i % len(customers)]
    action = actions[i % len(actions)]
    payload = f"Day {i}: Revenue up {r}%. Customer {c} signed contract. Next step: {action}.".encode()
    payloads.append(payload)

# Create DOTs
dots = []
for i, payload in enumerate(payloads):
    d = create(
        payload=payload,
        keypair=kp,
        dot_type=TYPE_OBSERVATION,
        timestamp_us=TIMESTAMP_BASE + i * 1000,
    )
    dots.append(d)

# A) Raw concatenated size
raw_size = sum(len(d) for d in dots)

# B) Naive gzip
all_bytes = b"".join(dots)
gzip_bytes = gzip.compress(all_bytes, compresslevel=9)
gzip_size = len(gzip_bytes)

# C) Chain-aware factoring
# Store pubkey once (35 bytes)
pubkey_section = kp.ed25519_public  # 32 bytes (we'll store just the key)

# Timestamps as 4-byte deltas
timestamps_raw = b""
prev_ts = TIMESTAMP_BASE
for i in range(N):
    ts = TIMESTAMP_BASE + i * 1000
    delta = ts - prev_ts
    timestamps_raw += delta.to_bytes(4, 'big')
    prev_ts = ts
timestamps_compressed = zlib.compress(timestamps_raw, level=9)

# Extract payload bytes from each DOT and compress together
all_payloads = b"".join(payloads)
payloads_compressed = zlib.compress(all_payloads, level=9)

# Extract signature bytes (last 64 bytes of each DOT)
all_sigs = b"".join(d[-64:] for d in dots)
sigs_compressed = zlib.compress(all_sigs, level=9)

# Headers (12 bytes each)
all_headers = b"".join(d[:12] for d in dots)
headers_compressed = zlib.compress(all_headers, level=9)

chain_aware_size = (
    32 +  # pubkey once
    len(timestamps_compressed) +
    len(payloads_compressed) +
    len(sigs_compressed) +
    len(headers_compressed)
)

# D) Middle-out compression
# Find centroid payload (closest to median length)
payload_lengths = [len(p) for p in payloads]
median_len = sorted(payload_lengths)[len(payload_lengths) // 2]
centroid = min(payloads, key=lambda p: abs(len(p) - median_len))

# Store centroid as-is
centroid_size = len(centroid)

# Store each payload as diff from centroid
deltas = []
for p in payloads:
    diff = b"".join(
        line for line in
        difflib.diff_bytes(difflib.unified_diff, [centroid], [p], lineterm=b"")
    )
    deltas.append(diff if diff else b"")

all_deltas = b"\x00".join(deltas)
deltas_compressed = zlib.compress(all_deltas, level=9)

middle_out_size = centroid_size + len(deltas_compressed) + (N * 4)  # 4 bytes per delta offset

print("=" * 65)
print("  EXPERIMENT 08: CHAIN COMPRESSION RATIO — RESULTS")
print("=" * 65)
print()
print(f"  DOTs:          {N}")
print(f"  Payload range: {min(len(p) for p in payloads)}-{max(len(p) for p in payloads)} bytes")
print()
print(f"  {'Approach':<30s} {'Bytes':>10s}  {'Ratio':>8s}")
print(f"  {'-'*30} {'-'*10}  {'-'*8}")
print(f"  {'A) Raw (no compression)':<30s} {raw_size:>10,}  {'1.000':>8s}")
print(f"  {'B) Naive gzip':<30s} {gzip_size:>10,}  {gzip_size/raw_size:>8.3f}")
print(f"  {'C) Chain-aware factoring':<30s} {chain_aware_size:>10,}  {chain_aware_size/raw_size:>8.3f}")
print(f"  {'D) Middle-out':<30s} {middle_out_size:>10,}  {middle_out_size/raw_size:>8.3f}")
print()
print(f"  Component breakdown (approach C):")
print(f"    Pubkey (stored once):    {32} bytes")
print(f"    Timestamps (compressed): {len(timestamps_compressed)} bytes")
print(f"    Payloads (compressed):   {len(payloads_compressed)} bytes")
print(f"    Signatures (compressed): {len(sigs_compressed)} bytes")
print(f"    Headers (compressed):    {len(headers_compressed)} bytes")
print()
print(f"  Gzip ratio:        {gzip_size/raw_size:.3f}  ({(1-gzip_size/raw_size)*100:.1f}% reduction)")
print(f"  Chain-aware ratio: {chain_aware_size/raw_size:.3f}  ({(1-chain_aware_size/raw_size)*100:.1f}% reduction)")
print(f"  Middle-out ratio:  {middle_out_size/raw_size:.3f}  ({(1-middle_out_size/raw_size)*100:.1f}% reduction)")
print()
print("  EXPERIMENT 08 COMPLETE")
print("=" * 65)
