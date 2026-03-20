"""
Experiment 9: Middle-Out Cluster Compression
100 DOTs with similar city descriptions. Compare raw vs linear deltas vs middle-out.
"""

import sys
import os
import zlib
import difflib
import hashlib
import itertools

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, TYPE_OBSERVATION

# Generate city descriptions
cities = ["Paris", "Tokyo", "Berlin", "Cairo", "Mumbai", "Sydney",
          "Toronto", "Lagos", "Seoul", "Lima"]
adjectives = ["vibrant", "historic", "bustling", "dynamic", "ancient",
              "cosmopolitan", "sprawling", "thriving"]
countries = ["France", "Japan", "Germany", "Egypt", "India", "Australia",
             "Canada", "Nigeria", "South Korea", "Peru"]
features = ["its museums", "ancient temples", "diverse cuisine", "financial districts",
            "colorful markets", "pristine beaches", "tech hubs", "cultural festivals"]
industries = ["tourism", "technology", "finance", "manufacturing", "agriculture",
              "entertainment", "trade", "services"]

import random
random.seed(42)

payloads = []
for i in range(100):
    idx = i % 10
    city = cities[idx]
    adj = adjectives[i % len(adjectives)]
    country = countries[idx]
    feat = features[i % len(features)]
    ind = industries[i % len(industries)]
    n = (i % 8 + 2) * 1  # 2-9 million
    text = f"{city} is a {adj} city of {n} million people located in {country}. Known for {feat} and {ind}."
    payloads.append(text.encode())

kp = crypto.generate_keypair(hashlib.sha256(b"middle-out-exp09").digest())

# Create DOTs
dots = []
for i, payload in enumerate(payloads):
    d = create(payload=payload, keypair=kp, dot_type=TYPE_OBSERVATION,
               timestamp_us=1741564800_000_000 + i * 1000)
    dots.append(d)

# A) Raw size (just payloads)
raw_size = sum(len(p) for p in payloads)

# B) Linear deltas: each payload diff vs previous
linear_deltas = []
for i in range(len(payloads)):
    if i == 0:
        linear_deltas.append(payloads[0])
    else:
        diff = b"".join(
            difflib.diff_bytes(
                difflib.unified_diff,
                [payloads[i-1]],
                [payloads[i]],
                lineterm=b""
            )
        )
        linear_deltas.append(diff if diff else payloads[i])

all_linear = b"\x00\xFF\x00".join(linear_deltas)
linear_compressed = zlib.compress(all_linear, level=9)
linear_size = len(linear_compressed)

# C) Middle-out: find centroid (min total diff to all others)
# For speed: sort by length, use median-length item as centroid candidate
lengths = [(len(p), i) for i, p in enumerate(payloads)]
lengths.sort()
median_idx = lengths[len(lengths) // 2][1]
centroid = payloads[median_idx]

middle_out_deltas = []
for i, p in enumerate(payloads):
    if i == median_idx:
        middle_out_deltas.append(b"=CENTROID=")
        continue
    diff = b"".join(
        difflib.diff_bytes(
            difflib.unified_diff,
            [centroid],
            [p],
            lineterm=b""
        )
    )
    middle_out_deltas.append(diff if diff else b"")

all_middle = b"\x00\xFF\x00".join(middle_out_deltas)
middle_compressed = zlib.compress(all_middle, level=9)
centroid_size = len(centroid)
middle_out_size = centroid_size + len(middle_compressed)

print("=" * 60)
print("  EXPERIMENT 09: MIDDLE-OUT CLUSTER COMPRESSION")
print("=" * 60)
print()
print(f"  DOTs:           100 city descriptions")
print(f"  Cities:         {len(cities)} unique, with variations")
print(f"  Payload range:  {min(len(p) for p in payloads)}-{max(len(p) for p in payloads)} bytes")
print(f"  Avg payload:    {raw_size // len(payloads)} bytes")
print()
print(f"  {'Approach':<30s} {'Bytes':>8s}  {'Ratio':>8s}")
print(f"  {'-'*30} {'-'*8}  {'-'*8}")
print(f"  {'A) Raw payloads':<30s} {raw_size:>8,}  {'1.000':>8s}")
print(f"  {'B) Linear deltas (compressed)':<30s} {linear_size:>8,}  {linear_size/raw_size:>8.3f}")
print(f"  {'C) Middle-out (compressed)':<30s} {middle_out_size:>8,}  {middle_out_size/raw_size:>8.3f}")
print()
print(f"  Middle-out vs Linear: {middle_out_size/linear_size:.3f}x "
      f"({'smaller' if middle_out_size < linear_size else 'larger'})")
print(f"  Centroid:       payload[{median_idx}] — {len(centroid)} bytes")
print(f"    '{centroid.decode()[:60]}...'")
print()
print("  EXPERIMENT 09 COMPLETE")
print("=" * 60)
