"""
Experiment 28: Phone Storage Wall
Simulate IndexedDB behavior via SQLite. Write N DOTs sequentially, measure
write latency, random read latency, and total DB size at 1K, 10K, 100K, 500K.
"""

import sys
import os
import sqlite3
import hashlib
import time
import random
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── Setup ────────────────────────────────────────────────────────────────────
SEED = hashlib.sha256(b"exp28-phone-storage").digest()
kp = crypto.generate_keypair(SEED)
BASE_TS = 1741564800_000_000  # 2026-03-08 00:00:00 UTC

MILESTONES = [1_000, 10_000, 100_000, 500_000]
WRITE_THRESHOLD_MS = 100.0  # ms — "too slow" for mobile
READ_THRESHOLD_MS  = 50.0   # ms

db_path = tempfile.mktemp(suffix=".db")
conn = sqlite3.connect(db_path)
conn.execute("""
    CREATE TABLE dots (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        hash      TEXT NOT NULL,
        channel   TEXT NOT NULL,
        ts        INTEGER NOT NULL,
        payload   BLOB NOT NULL
    )
""")
conn.execute("CREATE INDEX idx_dots_channel_ts ON dots (channel, ts)")
conn.commit()

# Pre-build a pool of 1000 unique DOTs to cycle through for inserts
POOL_SIZE = 1_000
pool = []
for i in range(POOL_SIZE):
    d = create(
        payload=f"msg {i} " .encode() + b"x" * 100,  # ~115B payload → ~237B total
        keypair=kp,
        timestamp_us=BASE_TS + i,
    )
    pool.append(d)

results = {}
write_fail_at  = None
read_fail_at   = None
total_inserted = 0

print("=" * 70)
print("  EXPERIMENT 28: PHONE STORAGE WALL")
print("=" * 70)
print()

for milestone in MILESTONES:
    batch_size = milestone - total_inserted

    # ── Write batch ──────────────────────────────────────────────────────────
    t_write_start = time.perf_counter()

    batch_data = []
    for j in range(batch_size):
        idx = (total_inserted + j) % POOL_SIZE
        d = pool[idx]
        h = hashlib.sha256(d).hexdigest()
        ch = f"channel-{(total_inserted + j) % 10}"
        ts = BASE_TS + total_inserted + j
        batch_data.append((h, ch, ts, d))

    conn.executemany("INSERT INTO dots (hash, channel, ts, payload) VALUES (?, ?, ?, ?)", batch_data)
    conn.commit()

    t_write_end = time.perf_counter()
    total_inserted = milestone

    write_elapsed_ms = (t_write_end - t_write_start) * 1000
    write_per_dot_ms = write_elapsed_ms / batch_size

    # ── Random read ──────────────────────────────────────────────────────────
    # Query: "last 50 messages in a random channel" — typical phone load
    channel = f"channel-{random.randint(0, 9)}"
    t_read_start = time.perf_counter()
    rows = conn.execute(
        "SELECT payload FROM dots WHERE channel = ? ORDER BY ts DESC LIMIT 50",
        (channel,)
    ).fetchall()
    t_read_end = time.perf_counter()
    read_ms = (t_read_end - t_read_start) * 1000

    # DB size on disk
    db_size_bytes = os.path.getsize(db_path)

    results[milestone] = {
        "write_per_dot_ms": write_per_dot_ms,
        "write_batch_ms":   write_elapsed_ms,
        "read_ms":          read_ms,
        "db_size_mb":       db_size_bytes / (1024 * 1024),
        "rows_returned":    len(rows),
    }

    print(f"  N = {milestone:>7,}")
    print(f"    Write latency:   {write_per_dot_ms:.4f} ms/DOT  (batch {write_elapsed_ms:.1f} ms total)")
    print(f"    Read latency:    {read_ms:.2f} ms  ({len(rows)} rows)")
    print(f"    DB size:         {db_size_bytes / (1024*1024):.1f} MB")

    if write_fail_at is None and write_per_dot_ms > WRITE_THRESHOLD_MS:
        write_fail_at = milestone
        print(f"    *** WRITE THRESHOLD EXCEEDED at N={milestone:,} ***")

    if read_fail_at is None and read_ms > READ_THRESHOLD_MS:
        read_fail_at = milestone
        print(f"    *** READ THRESHOLD EXCEEDED at N={milestone:,} ***")

    print()

    # Stop early if both thresholds exceeded
    if write_fail_at and read_fail_at:
        break

conn.close()
os.unlink(db_path)

# ─── Summary ──────────────────────────────────────────────────────────────────
print("  SUMMARY:")
if write_fail_at:
    print(f"    Write >100ms at:  N={write_fail_at:,}")
else:
    print(f"    Write >100ms at:  never (all N tested)")

if read_fail_at:
    print(f"    Read >50ms at:    N={read_fail_at:,}")
else:
    print(f"    Read >50ms at:    never (all N tested, WITH index)")

avg_dot_bytes = 237
for m in MILESTONES:
    if m in results:
        print(f"    N={m:>7,}:  {results[m]['db_size_mb']:.1f} MB on disk  "
              f"(~{avg_dot_bytes*m/1024/1024:.1f} MB theoretical)")

print()
# Determine overall pass/fail: designed to FAIL at some scale
# We PASS if we correctly documented where it fails, or note indexed reads stay fast
indexed_reads_fast = all(results[m]["read_ms"] < READ_THRESHOLD_MS for m in results)
print(f"  INDEXED READ: {'always <50ms (WITH index)' if indexed_reads_fast else 'degraded at some N'}")
print()

if write_fail_at is None and read_fail_at is None:
    print("  NOTE: Neither threshold was exceeded up to N=500K with SQLite+index.")
    print("  The indexed query stays fast. Write latency amortizes over batch inserts.")
    print("  Real IndexedDB (single-row writes, no batching) will degrade sooner.")
    print("  CONCLUSION: Batched SQLite survives 500K DOTs. Real IndexedDB may not.")
    print()
    print("  ✅ EXP-28 COMPLETE — No threshold failure with SQLite+index up to 500K")
else:
    print(f"  ❌ EXP-28: Threshold crossed at N={min(x for x in [write_fail_at, read_fail_at] if x)}")

print("=" * 70)
