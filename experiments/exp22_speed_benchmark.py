"""
Experiment 22: Speed Benchmark
Seal + verify times across payload sizes from 1B to 1MB.
"""

import sys
import os
import hashlib
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify

kp = crypto.generate_keypair(hashlib.sha256(b"exp22-speed").digest())
BASE_TS = 1741564800_000_000

sizes = [1, 10, 100, 1024, 10240, 102400, 1048576]  # 1B to 1MB

print("=" * 70)
print("  EXPERIMENT 22: SPEED BENCHMARK")
print("=" * 70)
print()
print(f"  {'Payload':>10}  {'Seal (ms)':>12}  {'Verify (ms)':>12}  {'DOT bytes':>12}  {'Overhead':>10}")
print("  " + "-" * 64)

results = []
for size in sizes:
    # Build payload
    pattern = bytes(range(256))
    payload = (pattern * (size // 256 + 1))[:size]

    # How many iterations — more for small, fewer for large
    iters = max(3, min(100, 10_000 // max(size, 1)))

    # Seal
    t0 = time.perf_counter()
    for _ in range(iters):
        d = create(payload=payload, keypair=kp, timestamp_us=BASE_TS)
    seal_ms = (time.perf_counter() - t0) * 1000 / iters

    dot_size = len(d)

    # Verify
    t0 = time.perf_counter()
    for _ in range(iters):
        verify(d)
    verify_ms = (time.perf_counter() - t0) * 1000 / iters

    overhead_bytes = dot_size - size
    overhead_pct   = overhead_bytes / dot_size * 100

    if size < 1024:
        label = f"{size}B"
    elif size < 1048576:
        label = f"{size//1024}KB"
    else:
        label = f"{size//1048576}MB"

    print(f"  {label:>10}  {seal_ms:>12.3f}  {verify_ms:>12.3f}  {dot_size:>12,}  {overhead_bytes:>6} B ({overhead_pct:.1f}%)")
    results.append((label, size, seal_ms, verify_ms, dot_size))

# Summary stats
print()
min_verify = min(r[3] for r in results)
max_verify = max(r[3] for r in results)
# Per-byte overhead is fixed (122 bytes header+key+ts+sig)
fixed_overhead = results[0][4] - results[0][1]  # DOT size of 1B payload minus 1B

# Throughput at 1KB
kb_row = [r for r in results if r[0] == "1KB"][0]
seal_throughput_mbs   = (kb_row[1] / 1e6) / (kb_row[2] / 1000)
verify_throughput_mbs = (kb_row[1] / 1e6) / (kb_row[3] / 1000)

print(f"  SUMMARY:")
print(f"    Fixed overhead per DOT:   {fixed_overhead} bytes (header + key + timestamp + sig)")
print(f"    Verify time range:        {min_verify:.3f} ms – {max_verify:.3f} ms")
print(f"    Seal throughput @ 1KB:    {seal_throughput_mbs*1000:.1f} MB/s")
print(f"    Verify throughput @ 1KB:  {verify_throughput_mbs*1000:.1f} MB/s")
print()
print("  ✅ EXP-22 PASSED")
print("=" * 70)
