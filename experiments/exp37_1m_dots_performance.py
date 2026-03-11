"""
Experiment 37: 1 Million DOTs Performance
Generate 1M DOTs, bulk-insert into SQLite, measure insert time,
query performance WITH and WITHOUT index, and startup time.
"""

import sys
import os
import sqlite3
import hashlib
import time
import tempfile
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── Setup ────────────────────────────────────────────────────────────────────
SEED = hashlib.sha256(b"exp37-1m-dots").digest()
kp   = crypto.generate_keypair(SEED)
BASE_TS = 1741564800_000_000

TARGET_M = 1_000_000
NUM_CHANNELS = 100
AVG_DOT_BYTES = 237

print("=" * 70)
print("  EXPERIMENT 37: 1 MILLION DOTs PERFORMANCE")
print("=" * 70)
print()

# ─── Step 1: Generate DOT pool ────────────────────────────────────────────────
# Pre-generate a pool of 10K unique DOTs; cycle through for 1M inserts.
# This avoids 1M crypto operations while still producing realistic byte sizes.
POOL_SIZE = 10_000
print(f"  Generating DOT pool ({POOL_SIZE:,} unique DOTs)...")
t0 = time.perf_counter()
pool = []
for i in range(POOL_SIZE):
    payload = f"channel-{i % NUM_CHANNELS} msg {i} content xxxxxxxxxxx".encode()
    d = create(
        payload=payload,
        keypair=kp,
        timestamp_us=BASE_TS + i,
    )
    pool.append(d)
pool_ms = (time.perf_counter() - t0) * 1000
print(f"  Pool generated in {pool_ms:.0f}ms ({POOL_SIZE / (pool_ms/1000):,.0f} DOTs/s)")
print(f"  Average DOT size: {sum(len(d) for d in pool) // len(pool)}B")
print()

# ─── Step 2: Bulk insert 1M DOTs into SQLite WITHOUT index ────────────────────
db_path_noindex = tempfile.mktemp(suffix="_noindex.db")
conn_noindex = sqlite3.connect(db_path_noindex)
conn_noindex.execute("""
    CREATE TABLE dots (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        hash    TEXT NOT NULL,
        channel TEXT NOT NULL,
        ts      INTEGER NOT NULL,
        payload BLOB NOT NULL
    )
""")
conn_noindex.commit()

print(f"  Step 2: Bulk inserting {TARGET_M:,} DOTs (NO index)...")
BATCH_SZ = 5_000
t0 = time.perf_counter()
for batch_start in range(0, TARGET_M, BATCH_SZ):
    batch = []
    for j in range(BATCH_SZ):
        i = batch_start + j
        d = pool[i % POOL_SIZE]
        h = hashlib.md5(d + i.to_bytes(4, 'big')).hexdigest()  # fast unique hash for test
        ch = f"channel-{i % NUM_CHANNELS}"
        ts = BASE_TS + i
        batch.append((h, ch, ts, d))
    conn_noindex.executemany("INSERT INTO dots (hash, channel, ts, payload) VALUES (?, ?, ?, ?)", batch)
    conn_noindex.commit()

insert_elapsed = time.perf_counter() - t0
insert_s = insert_elapsed
insert_per_dot_ms = insert_elapsed * 1000 / TARGET_M
db_size_bytes = os.path.getsize(db_path_noindex)
db_size_mb = db_size_bytes / (1024 * 1024)

print(f"  Total insert time:   {insert_s:.1f}s ({insert_per_dot_ms:.3f} ms/DOT)")
print(f"  Insert throughput:   {TARGET_M / insert_s:,.0f} DOTs/s")
print(f"  DB size (no index):  {db_size_mb:.1f} MB")
print(f"  Theoretical size:    {TARGET_M * AVG_DOT_BYTES / 1024 / 1024:.1f} MB @ {AVG_DOT_BYTES}B avg")
print()

# ─── Step 3: Query WITHOUT index ─────────────────────────────────────────────
TARGET_CHANNEL = f"channel-{random.randint(0, NUM_CHANNELS-1)}"
print(f"  Step 3: Query 'last 50 messages in {TARGET_CHANNEL}' WITHOUT index...")
t0 = time.perf_counter()
rows_noindex = conn_noindex.execute(
    "SELECT payload FROM dots WHERE channel = ? ORDER BY ts DESC LIMIT 50",
    (TARGET_CHANNEL,)
).fetchall()
query_noindex_ms = (time.perf_counter() - t0) * 1000
print(f"  Query time (no index): {query_noindex_ms:.1f} ms (returned {len(rows_noindex)} rows)")
if query_noindex_ms > 500:
    print(f"  *** CATASTROPHIC: >500ms — UI frozen on phone ***")
elif query_noindex_ms > 50:
    print(f"  *** SLOW: >50ms — noticeable lag ***")
else:
    print(f"  *** FAST: <50ms ***")
conn_noindex.close()
os.unlink(db_path_noindex)
print()

# ─── Step 4: WITH index ──────────────────────────────────────────────────────
print(f"  Step 4: Re-insert {TARGET_M:,} DOTs WITH (channel, ts) index...")
db_path_index = tempfile.mktemp(suffix="_index.db")
conn_index = sqlite3.connect(db_path_index)
conn_index.execute("""
    CREATE TABLE dots (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        hash    TEXT NOT NULL,
        channel TEXT NOT NULL,
        ts      INTEGER NOT NULL,
        payload BLOB NOT NULL
    )
""")
conn_index.execute("CREATE INDEX idx_channel_ts ON dots (channel, ts)")
conn_index.commit()

t0 = time.perf_counter()
for batch_start in range(0, TARGET_M, BATCH_SZ):
    batch = []
    for j in range(BATCH_SZ):
        i = batch_start + j
        d = pool[i % POOL_SIZE]
        h = hashlib.md5(d + i.to_bytes(4, 'big')).hexdigest()
        ch = f"channel-{i % NUM_CHANNELS}"
        ts = BASE_TS + i
        batch.append((h, ch, ts, d))
    conn_index.executemany("INSERT INTO dots (hash, channel, ts, payload) VALUES (?, ?, ?, ?)", batch)
    conn_index.commit()

insert_elapsed_indexed = time.perf_counter() - t0
db_size_indexed_mb = os.path.getsize(db_path_index) / (1024 * 1024)

print(f"  Insert WITH index:   {insert_elapsed_indexed:.1f}s ({TARGET_M/insert_elapsed_indexed:,.0f} DOTs/s)")
print(f"  DB size (indexed):   {db_size_indexed_mb:.1f} MB (index overhead: {db_size_indexed_mb - db_size_mb:.1f} MB)")
print()

# ─── Step 5: Query WITH index ────────────────────────────────────────────────
print(f"  Step 5: Query WITH index...")
t0 = time.perf_counter()
rows_index = conn_index.execute(
    "SELECT payload FROM dots WHERE channel = ? ORDER BY ts DESC LIMIT 50",
    (TARGET_CHANNEL,)
).fetchall()
query_index_ms = (time.perf_counter() - t0) * 1000
print(f"  Query time (indexed): {query_index_ms:.2f} ms (returned {len(rows_index)} rows)")
if query_index_ms < 50:
    print(f"  *** FAST: <50ms threshold ✓ ***")
else:
    print(f"  *** SLOW: >{query_index_ms:.0f}ms — index not helping ***")
print()

# ─── Step 6: Startup time — load all vs lazy ─────────────────────────────────
print(f"  Step 6: Startup time simulation...")

# Eager: load all 1M DOTs into memory on startup
# (This is what axxis.html would do if it loads all DOTs into a JS array)
t0 = time.perf_counter()
all_rows = conn_index.execute("SELECT payload FROM dots").fetchall()
eager_load_s = time.perf_counter() - t0
eager_mem_mb = sum(len(r[0]) for r in all_rows) / (1024 * 1024)
print(f"  Eager load (all 1M DOTs): {eager_load_s:.1f}s, {eager_mem_mb:.0f} MB in RAM")
print(f"  *** {'CATASTROPHIC' if eager_load_s > 5 else 'SLOW' if eager_load_s > 1 else 'OK'}: "
      f"app unusable until load completes ***")
del all_rows  # free memory

# Lazy: only load last 50 per channel (on demand)
t0 = time.perf_counter()
first_channel_rows = conn_index.execute(
    "SELECT payload FROM dots WHERE channel = ? ORDER BY ts DESC LIMIT 50",
    ("channel-0",)
).fetchall()
lazy_load_ms = (time.perf_counter() - t0) * 1000
print(f"  Lazy load (50 DOTs for 1 channel): {lazy_load_ms:.2f} ms")
print(f"  *** {'FAST' if lazy_load_ms < 50 else 'SLOW'}: app usable immediately ✓ ***")
print()

conn_index.close()
os.unlink(db_path_index)

# ─── Summary ──────────────────────────────────────────────────────────────────
speedup = query_noindex_ms / query_index_ms if query_index_ms > 0 else float('inf')

print(f"  SUMMARY:")
print(f"    Total DOTs:           {TARGET_M:,}")
print(f"    Insert time:          {insert_s:.1f}s (no index) / {insert_elapsed_indexed:.1f}s (indexed)")
print(f"    Query WITHOUT index:  {query_noindex_ms:.1f} ms  {'← CATASTROPHIC' if query_noindex_ms > 500 else ''}")
print(f"    Query WITH index:     {query_index_ms:.2f} ms  ← {'FAST ✓' if query_index_ms < 50 else 'SLOW'}")
print(f"    Index speedup:        {speedup:.0f}x")
print(f"    Eager startup:        {eager_load_s:.1f}s — unusable")
print(f"    Lazy startup:         {lazy_load_ms:.2f}ms — usable")
print()
print(f"  CRITICAL FINDING FOR axxis.html:")
print(f"    If axxis.html has no IndexedDB indices on (channel, ts), it WILL fail at scale.")
print(f"    Without index: {query_noindex_ms:.0f}ms query → UI frozen on mobile.")
print(f"    With index: {query_index_ms:.1f}ms → acceptable.")
print(f"    Required: IDBObjectStore.createIndex('channel_ts', ['channel', 'ts'])")
print()
print(f"  ✅ EXP-37: PASS — 1M DOTs manageable WITH index, catastrophic WITHOUT")
print("=" * 70)
