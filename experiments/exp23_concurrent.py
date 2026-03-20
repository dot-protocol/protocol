"""
Experiment 23: Concurrent Chain Building
5 observers, 20 DOTs each. WITHOUT lock = chain corruption.
WITH lock = valid chain. Demonstrates the threading requirement.
"""

import sys
import os
import hashlib
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open

kp_list = [
    crypto.generate_keypair(hashlib.sha256(f"obs{i}".encode()).digest())
    for i in range(5)
]
BASE_TS = 1741564800_000_000

# ─── Phase 1: WITHOUT lock ───────────────────────────────────────────────────
shared_chain   = []
errors_without = []

def add_dots_unsafe(observer_kp, count, observer_id):
    for i in range(count):
        try:
            prev  = shared_chain[-1] if shared_chain else None
            d = create(
                payload=f"Observer {observer_id} dot {i}".encode(),
                keypair=observer_kp,
                timestamp_us=BASE_TS + observer_id * 1000 + i,
                parent=prev,
            )
            shared_chain.append(d)
        except Exception as e:
            errors_without.append(str(e))

threads = [
    threading.Thread(target=add_dots_unsafe, args=(kp_list[i], 20, i))
    for i in range(5)
]
t0 = time.perf_counter()
for t in threads: t.start()
for t in threads: t.join()
time_without = (time.perf_counter() - t0) * 1000

# Count chain link errors in the unsafe chain
chain_errors_without = 0
for i in range(1, len(shared_chain)):
    try:
        r = dot_open(shared_chain[i])
        if r.parent_hash is not None:
            expected = crypto.dot_hash(shared_chain[i - 1])
            if r.parent_hash != expected:
                chain_errors_without += 1
    except Exception:
        chain_errors_without += 1

# ─── Phase 2: WITH lock ──────────────────────────────────────────────────────
shared_chain_2 = []
lock           = threading.Lock()

def add_dots_safe(observer_kp, count, observer_id):
    for i in range(count):
        with lock:
            prev = shared_chain_2[-1] if shared_chain_2 else None
            d = create(
                payload=f"Observer {observer_id} dot {i}".encode(),
                keypair=observer_kp,
                timestamp_us=BASE_TS + observer_id * 1000 + i,
                parent=prev,
            )
            shared_chain_2.append(d)

threads2 = [
    threading.Thread(target=add_dots_safe, args=(kp_list[i], 20, i))
    for i in range(5)
]
t0 = time.perf_counter()
for t in threads2: t.start()
for t in threads2: t.join()
time_with = (time.perf_counter() - t0) * 1000

# Verify locked chain
locked_sigs_valid = all(verify(d).verified for d in shared_chain_2)

locked_chain_valid = True
for i in range(1, len(shared_chain_2)):
    r = dot_open(shared_chain_2[i])
    if r.parent_hash is not None:
        expected = crypto.dot_hash(shared_chain_2[i - 1])
        if r.parent_hash != expected:
            locked_chain_valid = False
            break

print("=" * 70)
print("  EXPERIMENT 23: CONCURRENT CHAIN BUILDING")
print("=" * 70)
print()
print(f"  Observers:  5")
print(f"  DOTs each:  20  (100 total per phase)")
print()

print(f"  PHASE 1 — WITHOUT LOCK:")
print(f"    Total time:           {time_without:.1f} ms")
print(f"    DOTs appended:        {len(shared_chain)}")
print(f"    Threading errors:     {len(errors_without)}")
print(f"    Chain link errors:    {chain_errors_without}  ← race conditions corrupt links")
unsafe_status = "CORRUPTED (expected)" if chain_errors_without > 0 else "Accidentally intact"
print(f"    Chain integrity:      {unsafe_status}")
print()

print(f"  PHASE 2 — WITH LOCK:")
print(f"    Total time:           {time_with:.1f} ms")
print(f"    DOTs appended:        {len(shared_chain_2)}")
print(f"    All sigs valid:       {locked_sigs_valid}")
print(f"    Chain links valid:    {locked_chain_valid}")
print(f"    Chain integrity:      {'INTACT ✓' if locked_chain_valid else 'BROKEN ✗'}")
print()

overhead_pct = (time_with - time_without) / max(time_without, 1) * 100 if time_without > 0 else 0
print(f"  Lock overhead:  {time_with:.1f} ms vs {time_without:.1f} ms  ({overhead_pct:+.0f}%)")
print()
print(f"  KEY INSIGHT:")
print(f"    A shared chain requires serialized access (lock or single writer).")
print(f"    Without a lock, race conditions break parent-hash links.")
print(f"    The DOT protocol is append-only by design — concurrent reads are safe,")
print(f"    but concurrent writes to a shared chain require coordination.")
print()

all_pass = locked_sigs_valid and locked_chain_valid
print("  ✅ EXP-23 PASSED" if all_pass else "  ❌ EXP-23 FAILED")
print("=" * 70)

assert all_pass, "EXP-23 FAILED"
