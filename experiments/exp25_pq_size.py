"""
Experiment 25: Post-Quantum DOT Size Model (arithmetic only — no implementation)
Replace Ed25519 constants with ML-DSA-65 (CRYSTALS-Dilithium Level 3) constants.
Recompute EXP-18, 19, 20, 22 results under post-quantum regime.
"""

# ─── Constants ────────────────────────────────────────────────────────────────

# Current: Ed25519
ED_PUBKEY   = 32    # bytes
ED_SIG      = 64    # bytes

# Ed25519 wire overhead breakdown (per DOT):
#   12B header + 1B key_type + 2B key_length + 32B pubkey + 8B timestamp + 1B sig_type + 2B sig_length + 64B sig
ED_FIXED_OVERHEAD = 12 + (1 + 2 + ED_PUBKEY) + 8 + (1 + 2 + ED_SIG)
# = 12 + 35 + 8 + 67 = 122B  (matches EXP-22)

# Post-quantum: ML-DSA-65 (CRYSTALS-Dilithium Level 3) — NIST FIPS 204
PQ_PUBKEY   = 1952  # bytes
PQ_SIG      = 3293  # bytes

# PQ wire overhead breakdown (per DOT):
#   12B header + 1B key_type + 2B key_length + 1952B pubkey + 8B timestamp + 1B sig_type + 2B sig_length + 3293B sig
PQ_FIXED_OVERHEAD = 12 + (1 + 2 + PQ_PUBKEY) + 8 + (1 + 2 + PQ_SIG)
# = 12 + 1955 + 8 + 3296 = 5271B
# Double-check:
assert PQ_FIXED_OVERHEAD == 12 + 1955 + 8 + 3296, f"Got {PQ_FIXED_OVERHEAD}"

# ─── EXP-22 recomputed: speed/size table ─────────────────────────────────────
PAYLOAD_SIZES = [1, 10, 100, 1024, 10240, 102400, 1048576]  # 1B, 10B, 100B, 1KB, 10KB, 100KB, 1MB

# EXP-22 seal times (ms) — kept the same; crypto performance is separate concern
# Actual ML-DSA-65 sign is ~10-50x slower but we're modelling SIZE only here.
ED_SEAL_MS   = [0.344, 0.343, 0.342, 0.377, 0.592, 2.666, 25.086]
ED_VERIFY_MS = [0.572, 0.569, 0.578, 0.598, 0.705, 1.839, 13.599]

# ─── EXP-18 recomputed: Wikipedia scale ──────────────────────────────────────
# Wikipedia English raw: 21.0 GB, ~6.8 million articles, avg 3,088 bytes/article
WIKI_RAW_GB      = 21.0
WIKI_ARTICLES    = 6_800_000
WIKI_AVG_PAYLOAD = 3088  # bytes per article (raw)

# ED overheads for filesystem approach (from EXP-18):
GZIP_RATIO       = 0.50   # gzip 50%
FILESYSTEM_RATIO = 0.67   # filesystem brings to 67% of gzip
DEDUP_RATIO      = 0.70   # 30% dedup
EMBED_GB         = 6.86   # embeddings

# ED per-DOT overhead fraction: 122B overhead / (3088B payload + 122B) = 3.8%
# PQ per-DOT overhead fraction: 5271B overhead / (3088B payload + 5271B) = 63.1%

def wiki_with_overhead(raw_gb, overhead_bytes, avg_payload):
    """
    Model Wikipedia storage with per-DOT overhead.
    raw_gb: raw text size
    overhead_bytes: fixed per-DOT overhead
    avg_payload: average payload bytes per DOT
    """
    dot_size = avg_payload + overhead_bytes
    overhead_fraction = overhead_bytes / dot_size
    return raw_gb * (1 + overhead_fraction)


# Scenario 1: Naive + gzip
ed_s1  = WIKI_RAW_GB * GZIP_RATIO * (1 + ED_FIXED_OVERHEAD / (WIKI_AVG_PAYLOAD + ED_FIXED_OVERHEAD))
pq_s1  = WIKI_RAW_GB * GZIP_RATIO * (1 + PQ_FIXED_OVERHEAD / (WIKI_AVG_PAYLOAD + PQ_FIXED_OVERHEAD))

# Simpler model: raw compressed bytes + overhead bytes
# n_articles * (compressed_payload + overhead)
n_articles = WIKI_ARTICLES
compressed_payload = int(WIKI_AVG_PAYLOAD * GZIP_RATIO)
ed_s1_gb  = n_articles * (compressed_payload + ED_FIXED_OVERHEAD) / 1e9
pq_s1_gb  = n_articles * (compressed_payload + PQ_FIXED_OVERHEAD) / 1e9

# Scenario 2: Filesystem (gzip + delta + templates)
# Effective per-article cost after filesystem compression
fs_effective_payload = int(WIKI_AVG_PAYLOAD * GZIP_RATIO * FILESYSTEM_RATIO)
ed_s2_gb  = n_articles * (fs_effective_payload + ED_FIXED_OVERHEAD) / 1e9
pq_s2_gb  = n_articles * (fs_effective_payload + PQ_FIXED_OVERHEAD) / 1e9

# Scenario 3: Filesystem + 30% dedup
fs_dedup_payload = int(fs_effective_payload * DEDUP_RATIO)
ed_s3_gb  = n_articles * (fs_dedup_payload + ED_FIXED_OVERHEAD) / 1e9
pq_s3_gb  = n_articles * (fs_dedup_payload + PQ_FIXED_OVERHEAD) / 1e9

# Scenario 4: Filesystem + dedup + embeddings
ed_s4_gb  = ed_s3_gb + EMBED_GB
pq_s4_gb  = pq_s3_gb + EMBED_GB

# ─── EXP-19 recomputed: $1300 estimate ───────────────────────────────────────
# EXP-19: 232,160 GB raw, compressed to 91,169 GB with Ed25519
# The DOT overhead fraction changes with PQ.
# Original: 91,169 GB with Ed25519 (avg payload ~1000B estimated, overhead=122/1122 = 10.9%)
# PQ: overhead = 5271/6271 = 84.1%
RAW_ALL_TB  = 232.0   # TB  (232,160 GB)
RAW_ALL_GB  = RAW_ALL_TB * 1024

ED_COMPRESSED_GB  = 91_169   # From EXP-19
ED_TOTAL_TB       = 91_169 / 1024

# Estimate: PQ multiplier = (avg_compressed_payload + PQ_overhead) / (avg_compressed_payload + ED_overhead)
# EXP-19 avg compressed payload: we can back-calculate from 91,169 GB and overhead fraction
# 91,169 GB was achieved with filesystem+dedup. Assume avg compressed payload = 500B (rough EXP-19 corpus)
EXP19_AVG_PAYLOAD = 500  # bytes, estimated compressed payload

ed_dot_size = EXP19_AVG_PAYLOAD + ED_FIXED_OVERHEAD   # 622B
pq_dot_size = EXP19_AVG_PAYLOAD + PQ_FIXED_OVERHEAD   # 5771B
pq_multiplier = pq_dot_size / ed_dot_size
pq_compressed_gb = ED_COMPRESSED_GB * pq_multiplier
pq_compressed_tb = pq_compressed_gb / 1024

# Storage cost at $100/8TB drive
DRIVE_CAPACITY_TB = 8
DRIVE_COST_USD    = 100
ed_drives = -(-int(ED_TOTAL_TB) // DRIVE_CAPACITY_TB)   # ceiling
pq_drives = -(-int(pq_compressed_tb) // DRIVE_CAPACITY_TB)
ed_cost   = ed_drives * DRIVE_COST_USD
pq_cost   = pq_drives * DRIVE_COST_USD

# ─── EXP-20 recomputed: Minimum Viable Archive ───────────────────────────────
# EXP-20: 100 DOTs, avg 237.1 bytes/DOT = 23,709 bytes total
# Payload avg = 237.1 - 122 = 115.1 bytes
MVA_N_DOTS      = 100
MVA_AVG_PAYLOAD = 115   # bytes (EXP-20 derived: 237.1 - 122)
BLE_MBPS        = 1.0   # Mbit/s effective BLE 4.2

mva_ed_bytes = MVA_N_DOTS * (MVA_AVG_PAYLOAD + ED_FIXED_OVERHEAD)
mva_pq_bytes = MVA_N_DOTS * (MVA_AVG_PAYLOAD + PQ_FIXED_OVERHEAD)
mva_ed_ble_s = (mva_ed_bytes * 8) / (BLE_MBPS * 1e6)
mva_pq_ble_s = (mva_pq_bytes * 8) / (BLE_MBPS * 1e6)

# ─── Print results ────────────────────────────────────────────────────────────
print("=" * 70)
print("  EXPERIMENT 25: POST-QUANTUM DOT SIZE MODEL")
print("=" * 70)
print()
print(f"  CRYPTO SUITE COMPARISON:")
print(f"  {'Field':<20}  {'Ed25519 (current)':>18}  {'ML-DSA-65 (PQ)':>15}")
print(f"  {'-'*20}  {'-'*18}  {'-'*15}")
print(f"  {'Public key':<20}  {ED_PUBKEY:>15}B       {PQ_PUBKEY:>12}B")
print(f"  {'Signature':<20}  {ED_SIG:>15}B       {PQ_SIG:>12}B")
print(f"  {'Fixed overhead/DOT':<20}  {ED_FIXED_OVERHEAD:>15}B       {PQ_FIXED_OVERHEAD:>12}B")
print(f"  {'Overhead multiplier':<20}  {'1.0x':>18}  {PQ_FIXED_OVERHEAD/ED_FIXED_OVERHEAD:>14.1f}x")
print()

print(f"  EXP-22 RECOMPUTED: SPEED/SIZE TABLE (PQ DOT bytes)")
print(f"  {'Payload':<8}  {'ED bytes':>10}  {'PQ bytes':>10}  {'ED overhead%':>12}  {'PQ overhead%':>12}")
print(f"  {'-'*8}  {'-'*10}  {'-'*10}  {'-'*12}  {'-'*12}")
LABEL = ["1B", "10B", "100B", "1KB", "10KB", "100KB", "1MB"]
for i, p in enumerate(PAYLOAD_SIZES):
    ed_total = p + ED_FIXED_OVERHEAD
    pq_total = p + PQ_FIXED_OVERHEAD
    ed_pct   = ED_FIXED_OVERHEAD / ed_total * 100
    pq_pct   = PQ_FIXED_OVERHEAD / pq_total * 100
    print(f"  {LABEL[i]:<8}  {ed_total:>10,}  {pq_total:>10,}  {ed_pct:>11.1f}%  {pq_pct:>11.1f}%")
print()

print(f"  EXP-18 RECOMPUTED: WIKIPEDIA SCALE (128GB phone = 128,000 MB)")
print(f"  {'Scenario':<40}  {'Ed25519':>10}  {'ML-DSA-65':>10}  {'Fits 128GB?':>12}")
print(f"  {'-'*40}  {'-'*10}  {'-'*10}  {'-'*12}")
scenarios = [
    ("1. Naive/gzip",                         ed_s1_gb, pq_s1_gb),
    ("2. Filesystem",                         ed_s2_gb, pq_s2_gb),
    ("3. Filesystem + 30% dedup",             ed_s3_gb, pq_s3_gb),
    ("4. Filesystem + dedup + embeddings",    ed_s4_gb, pq_s4_gb),
]
for label, ed_gb, pq_gb in scenarios:
    fits_ed = "YES" if ed_gb < 128 else "NO"
    fits_pq = "YES" if pq_gb < 128 else "NO"
    print(f"  {label:<40}  {ed_gb:>9.1f}G  {pq_gb:>9.1f}G  {fits_ed} / {fits_pq}")
print(f"  (Fits 128GB = Ed25519 answer / ML-DSA-65 answer)")
print()

print(f"  EXP-19 RECOMPUTED: THE $1300 ESTIMATE")
print(f"  Raw corpus:              {RAW_ALL_GB/1024:.0f} TB")
print(f"  Ed25519 compressed:      {ED_COMPRESSED_GB/1024:.0f} TB  → {ed_drives} drives @ ${ed_cost:,}")
print(f"  ML-DSA-65 compressed:    {pq_compressed_tb:.0f} TB  → {pq_drives} drives @ ${pq_cost:,}")
print(f"  PQ storage multiplier:   {pq_multiplier:.1f}x (due to {PQ_FIXED_OVERHEAD}B vs {ED_FIXED_OVERHEAD}B overhead)")
print()

print(f"  EXP-20 RECOMPUTED: MINIMUM VIABLE ARCHIVE (100 DOTs, Faluda observations)")
print(f"  Ed25519:    {mva_ed_bytes:,} bytes  ({mva_ed_bytes/1024:.1f} KB)  BLE: {mva_ed_ble_s:.2f}s")
print(f"  ML-DSA-65:  {mva_pq_bytes:,} bytes  ({mva_pq_bytes/1024:.1f} KB)  BLE: {mva_pq_ble_s:.2f}s")
print(f"  PQ size multiplier: {mva_pq_bytes/mva_ed_bytes:.1f}x")
print()

print(f"  KEY FINDING:")
print(f"    PQ fixed overhead is {PQ_FIXED_OVERHEAD:,}B vs {ED_FIXED_OVERHEAD}B — a {PQ_FIXED_OVERHEAD/ED_FIXED_OVERHEAD:.0f}x increase.")
print(f"    For payloads < 5KB, PQ overhead dominates (>50% of DOT).")
print(f"    Wikipedia still fits on a 128GB phone under ALL scenarios.")
print(f"    The $1,300 estimate becomes ~${pq_cost:,} — still single-person portable.")
print(f"    BLE transmission grows from {mva_ed_ble_s:.2f}s to {mva_pq_ble_s:.2f}s for 100-DOT archive.")
print()
print("  ✅ EXP-25 COMPLETE")
print("=" * 70)
