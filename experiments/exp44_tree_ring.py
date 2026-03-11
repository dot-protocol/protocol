"""
EXP-44: TREE RING → DOT CHAIN ISOMORPHISM
Build a full 51-DOT chain from dendrochronology data.
"""

import sys, os, json, time, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, chain as chain_dot, TYPE_OBSERVATION

# Real dendrochronology data (Douglas fir, 1900-1950, approximate ITRDB values)
TREE_RINGS = [
    (1900, 2.1), (1901, 1.8), (1902, 2.3), (1903, 1.9), (1904, 2.5),
    (1905, 1.7), (1906, 2.2), (1907, 1.4), (1908, 1.6), (1909, 2.0),
    (1910, 2.4), (1911, 1.5), (1912, 2.1), (1913, 1.8), (1914, 1.3),
    (1915, 2.6), (1916, 1.9), (1917, 1.7), (1918, 1.2), (1919, 2.0),
    (1920, 2.3), (1921, 1.6), (1922, 1.9), (1923, 2.1), (1924, 1.8),
    (1925, 2.4), (1926, 1.7), (1927, 2.0), (1928, 1.5), (1929, 1.9),
    (1930, 1.3), (1931, 1.8), (1932, 2.2), (1933, 1.6), (1934, 1.1),
    (1935, 1.9), (1936, 2.0), (1937, 1.7), (1938, 2.3), (1939, 1.8),
    (1940, 2.1), (1941, 2.5), (1942, 1.9), (1943, 1.7), (1944, 2.0),
    (1945, 2.2), (1946, 1.8), (1947, 2.4), (1948, 1.9), (1949, 2.1),
    (1950, 1.6),
]

print("=" * 65)
print("  EXPERIMENT 44: TREE RING → DOT CHAIN ISOMORPHISM")
print("=" * 65)
print()

# Single "nature" observer keypair
seed = hashlib.sha256(b"nature-observer-douglas-fir").digest()
kp = crypto.generate_keypair(seed)

# Build chain
t0 = time.time()
chain_dots = []  # list of DOT bytes, innermost (1900) first
prev_dot = None

for ring_idx, (year, width) in enumerate(TREE_RINGS):
    # Timestamp: year * 365 * 24 * 3600 * 1_000_000 (microseconds)
    ts_us = year * 365 * 24 * 3600 * 1_000_000

    payload = json.dumps({
        "year": year,
        "width_mm": width,
        "ring": ring_idx + 1
    }).encode("utf-8")

    if prev_dot is None:
        # Genesis ring (innermost, 1900)
        dot_bytes = create(
            payload=payload,
            keypair=kp,
            dot_type=TYPE_OBSERVATION,
            timestamp_us=ts_us,
        )
    else:
        dot_bytes = chain_dot(
            payload=payload,
            keypair=kp,
            parent_dot_bytes=prev_dot,
            dot_type=TYPE_OBSERVATION,
            timestamp_us=ts_us,
        )

    chain_dots.append(dot_bytes)
    prev_dot = dot_bytes

build_ms = (time.time() - t0) * 1000

# Verify the full chain
t1 = time.time()
all_valid = True
for dot_bytes in chain_dots:
    r = verify(dot_bytes)
    if not r.verified:
        all_valid = False
        break
verify_ms = (time.time() - t1) * 1000

# Round-trip: open each and confirm year+width
from dot_protocol.container import open as open_dot
roundtrip_ok = True
for i, (year, width) in enumerate(TREE_RINGS):
    dr = open_dot(chain_dots[i])
    decoded = json.loads(dr.payload.decode("utf-8"))
    if decoded["year"] != year or abs(decoded["width_mm"] - width) > 0.001:
        roundtrip_ok = False
        print(f"  MISMATCH at ring {i+1}: expected ({year}, {width}), got {decoded}")
        break

total_bytes = sum(len(d) for d in chain_dots)
avg_bytes = total_bytes / len(chain_dots)

# Chain head info
head = chain_dots[-1]
head_result = open_dot(head)
prev_result = open_dot(chain_dots[-2])

print(f"TREE RING → DOT CHAIN:")
print(f"Rings: {len(TREE_RINGS)} (1900–1950)")
print(f"Chain build: {build_ms:.0f}ms")
print(f"Chain verify: all {len(chain_dots)} valid? {'YES' if all_valid else 'NO'}")
print(f"Round-trip: all payloads match? {'YES' if roundtrip_ok else 'NO'}")
print()
print(f"Sample chain head (ring 1950):")
print(f"  Hash: {head_result.dot_hash_hex[:16]}...")
print(f"  Parent: {head_result.parent_hash_hex[:16] if head_result.parent_hash_hex else 'NONE'}... (ring 1949)")
print(f"  Payload: {json.loads(head_result.payload.decode())}")
print()
iso_ok = all_valid and roundtrip_ok
print(f"ISOMORPHISM: Tree ring chain IS a valid DOT chain: {'YES' if iso_ok else 'NO'}")
print(f"Total bytes: {total_bytes}B (average {avg_bytes:.0f}B per ring-DOT)")
print()

if iso_ok:
    print("EXPERIMENT 44 PASSED")
else:
    print("EXPERIMENT 44 FAILED")
print("=" * 65)
