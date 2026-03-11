"""
Experiment 26: Compression vs Post-Quantum (Shannon's Challenge)
Model compression rescue for PQ DOTs across single-observer and multi-observer scenarios.
Arithmetic only — no cryptographic operations needed.
"""

# ─── Constants ────────────────────────────────────────────────────────────────

# Ed25519 (current)
ED_PUBKEY_BYTES    = 32
ED_SIG_BYTES       = 64
ED_OVERHEAD        = 12 + (1 + 2 + ED_PUBKEY_BYTES) + 8 + (1 + 2 + ED_SIG_BYTES)  # 122B

# ML-DSA-65 (CRYSTALS-Dilithium Level 3)
PQ_PUBKEY_BYTES    = 1952
PQ_SIG_BYTES       = 3293
PQ_OVERHEAD        = 12 + (1 + 2 + PQ_PUBKEY_BYTES) + 8 + (1 + 2 + PQ_SIG_BYTES)  # 5271B

# Scenario parameters
N_DOTS             = 1000
PAYLOAD_BYTES      = 100   # bytes per DOT payload

# Gzip compression ratio for text payloads (~100B each)
# Small payloads: gzip adds header overhead, assume ~0% gain for 100B payloads
# (gzip is ineffective below ~500B; actual expansion possible)
GZIP_RATIO_SMALL   = 1.0    # no benefit on 100B payloads

# ─── Helper ──────────────────────────────────────────────────────────────────

def dot_size(payload_b, overhead_b):
    return payload_b + overhead_b

def chain_raw(n, payload_b, overhead_b):
    return n * dot_size(payload_b, overhead_b)


# ─── Scenario A: Single-observer chain, 1000 DOTs, 100B payloads ─────────────
#
# Ed25519 baseline
ed_raw = chain_raw(N_DOTS, PAYLOAD_BYTES, ED_OVERHEAD)

# PQ raw (no compression)
pq_raw = chain_raw(N_DOTS, PAYLOAD_BYTES, PQ_OVERHEAD)

# PQ chain-aware compression: single observer → pubkey (1952B) repeats N times.
# Chain-aware compression factors out the repeated pubkey into one stored copy.
# Compressed representation:
#   1 × stored pubkey + N × reference to pubkey (e.g. 4B index each)
# Savings: (N-1) × PQ_PUBKEY_BYTES
pq_pubkey_dedup_savings = (N_DOTS - 1) * PQ_PUBKEY_BYTES
# But signatures are 3293B each and are unique (nonce + message-specific) → incompressible
# Header (12B) and timestamp (8B) are also unique per DOT
# Only pubkey is deduplicated

# Non-compressible parts per DOT:
#   12B header + 1B key_type + 2B key_len + [pubkey deduped] + 8B ts + 1B sig_type + 2B sig_len + 3293B sig + 100B payload
# First DOT still stores full pubkey; subsequent DOTs store 4B reference
# Model: first DOT = PQ_OVERHEAD + payload; rest = (PQ_OVERHEAD - PQ_PUBKEY_BYTES + 4) + payload
pq_compressed_reference_bytes = 4  # bytes for pubkey reference in chain-compressed format
pq_first_dot   = PAYLOAD_BYTES + PQ_OVERHEAD
pq_subsequent  = PAYLOAD_BYTES + (PQ_OVERHEAD - PQ_PUBKEY_BYTES + pq_compressed_reference_bytes)
pq_chain_compressed = pq_first_dot + (N_DOTS - 1) * pq_subsequent

# Signature floor: what fraction of the chain is signatures (incompressible)
pq_sig_total   = N_DOTS * PQ_SIG_BYTES
pq_sig_floor_pct = pq_sig_total / pq_chain_compressed * 100

# Also run gzip over the whole chain. For PQ, pubkeys compress well (structured, repetitive bytes)
# but signatures are random-looking (incompressible).
# Pubkey gzip reduction: ~1.5x (structured but not text)
# Sig gzip reduction: 1.0x (effectively random)
PQ_PUBKEY_GZIP = 1.5  # rough compression factor
pq_pubkeys_gzip = N_DOTS * PQ_PUBKEY_BYTES / PQ_PUBKEY_GZIP
pq_sigs_gzip   = N_DOTS * PQ_SIG_BYTES     # incompressible
pq_payload_gzip = N_DOTS * PAYLOAD_BYTES * GZIP_RATIO_SMALL
pq_headers_gzip = N_DOTS * (12 + 8)        # header+ts, limited compressibility (timestamps unique)
pq_gzip_total   = pq_pubkeys_gzip + pq_sigs_gzip + pq_payload_gzip + pq_headers_gzip

# ─── Scenario B: Multi-observer, 1000 DOTs, 50 observers (20 DOTs each) ──────
#
# Pubkeys: 50 unique pubkeys, each used 20 times.
# Chain-aware dedup: store each pubkey once → 50 × 1952B stored + 950 × 4B references
N_MULTI_DOTS    = 1000
N_OBSERVERS     = 50
DOTS_PER_OBS    = N_MULTI_DOTS // N_OBSERVERS  # 20

pq_multi_raw = chain_raw(N_MULTI_DOTS, PAYLOAD_BYTES, PQ_OVERHEAD)

# Pubkey storage: 50 full pubkeys + (1000 - 50) references
pq_multi_pubkey_storage = N_OBSERVERS * PQ_PUBKEY_BYTES + (N_MULTI_DOTS - N_OBSERVERS) * pq_compressed_reference_bytes

# Non-pubkey parts: header+ts per DOT (unique), sigs (unique), payload
pq_multi_non_pubkey = N_MULTI_DOTS * (12 + 8 + 1 + 2 + 1 + 2 + PQ_SIG_BYTES + PAYLOAD_BYTES)
pq_multi_compressed = pq_multi_pubkey_storage + pq_multi_non_pubkey

# Ed25519 equivalent for multi-observer (for comparison)
ed_multi_pubkey_storage = N_OBSERVERS * ED_PUBKEY_BYTES + (N_MULTI_DOTS - N_OBSERVERS) * 4
ed_multi_non_pubkey     = N_MULTI_DOTS * (12 + 8 + 1 + 2 + 1 + 2 + ED_SIG_BYTES + PAYLOAD_BYTES)
ed_multi_compressed     = ed_multi_pubkey_storage + ed_multi_non_pubkey

# Signature floor for multi-observer
multi_sig_floor_pct = (N_MULTI_DOTS * PQ_SIG_BYTES) / pq_multi_compressed * 100

# ─── Print results ────────────────────────────────────────────────────────────
print("=" * 70)
print("  EXPERIMENT 26: COMPRESSION VS POST-QUANTUM (SHANNON'S CHALLENGE)")
print("=" * 70)
print()
print(f"  OVERHEAD CONSTANTS:")
print(f"    Ed25519 fixed overhead:   {ED_OVERHEAD:,}B  (pubkey={ED_PUBKEY_BYTES}B, sig={ED_SIG_BYTES}B)")
print(f"    ML-DSA-65 fixed overhead: {PQ_OVERHEAD:,}B  (pubkey={PQ_PUBKEY_BYTES}B, sig={PQ_SIG_BYTES}B)")
print()
print(f"  SCENARIO A: SINGLE-OBSERVER CHAIN (N={N_DOTS}, payload={PAYLOAD_BYTES}B each)")
print(f"  {'Approach':<35}  {'Bytes':>12}  {'vs PQ raw':>10}")
print(f"  {'-'*35}  {'-'*12}  {'-'*10}")
print(f"  {'Ed25519 raw (baseline)':<35}  {ed_raw:>12,}  {'-':>10}")
print(f"  {'PQ raw (no compression)':<35}  {pq_raw:>12,}  {pq_raw/pq_raw:>10.2f}x")
print(f"  {'PQ chain-aware (pubkey dedup)':<35}  {pq_chain_compressed:>12,}  {pq_chain_compressed/pq_raw:>10.3f}x")
print(f"  {'PQ gzip estimate':<35}  {int(pq_gzip_total):>12,}  {pq_gzip_total/pq_raw:>10.3f}x")
print()
print(f"  Signature floor (incompressible in chain-aware):")
print(f"    PQ signatures:  {N_DOTS} × {PQ_SIG_BYTES:,}B = {N_DOTS*PQ_SIG_BYTES:,}B")
print(f"    = {pq_sig_floor_pct:.1f}% of chain-aware compressed size")
print(f"    Shannon's limit: cannot compress below {N_DOTS*PQ_SIG_BYTES:,}B for {N_DOTS} PQ DOTs")
print()
print(f"  SCENARIO B: MULTI-OBSERVER CHAIN (N={N_MULTI_DOTS}, {N_OBSERVERS} observers, {DOTS_PER_OBS} DOTs each)")
print(f"  {'Approach':<35}  {'Bytes':>12}  {'vs PQ raw':>10}")
print(f"  {'-'*35}  {'-'*12}  {'-'*10}")
print(f"  {'Ed25519 multi-observer raw':<35}  {chain_raw(N_MULTI_DOTS, PAYLOAD_BYTES, ED_OVERHEAD):>12,}  {'-':>10}")
print(f"  {'Ed25519 chain-compressed':<35}  {ed_multi_compressed:>12,}  {'-':>10}")
print(f"  {'PQ multi-observer raw':<35}  {pq_multi_raw:>12,}  {pq_multi_raw/pq_multi_raw:>10.2f}x")
print(f"  {'PQ multi chain-aware':<35}  {pq_multi_compressed:>12,}  {pq_multi_compressed/pq_multi_raw:>10.3f}x")
print()
print(f"  Multi-observer signature floor: {multi_sig_floor_pct:.1f}% of compressed size")
print()
print(f"  KEY METRICS SUMMARY:")
print(f"    pq_chain_compressed_bytes:         {pq_chain_compressed:,}")
print(f"    pq_multi_observer_compressed_bytes: {pq_multi_compressed:,}")
print(f"    signature_floor_percentage:        {pq_sig_floor_pct:.1f}% (single) / {multi_sig_floor_pct:.1f}% (multi)")
print()
print(f"  ANALYSIS (SHANNON'S CHALLENGE):")
print(f"    Compression CAN rescue pubkey bloat ({PQ_PUBKEY_BYTES:,}B → amortized ~{pq_compressed_reference_bytes}B/DOT for single observer).")
print(f"    But signatures ({PQ_SIG_BYTES:,}B each) are cryptographically random — incompressible by Shannon's theorem.")
print(f"    For a {N_DOTS}-DOT single-observer PQ chain:")
print(f"      Raw:              {pq_raw:,}B")
print(f"      Compressed floor: {N_DOTS*PQ_SIG_BYTES + N_DOTS*PAYLOAD_BYTES:,}B  (payload + sigs only — minimum possible)")
print(f"      Achievable:       {pq_chain_compressed:,}B  (pubkey dedup, realistic compression)")
print(f"    Compression rescues ~{(1 - pq_chain_compressed/pq_raw)*100:.1f}% of PQ size overhead.")
print(f"    The signature floor ({pq_sig_floor_pct:.1f}%) is the wall compression cannot break through.")
print()
print("  ✅ EXP-26 COMPLETE")
print("=" * 70)
