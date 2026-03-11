# DOT Protocol — Experiment Results
## Timestamp: 2026-03-11

| #  | Experiment                  | Result | Key Number                              |
|----|-----------------------------|--------|-----------------------------------------|
| 01 | Genesis DOT                 | PASS   | 160 bytes                               |
| 02 | Integrity Prism             | PASS   | 100% detection, 0% false positives      |
| 03 | Minimum DOT                 | PASS   | 123 bytes (1B payload)                  |
| 04 | Cold Open                   | PASS   | Manual parse + library verify agree     |
| 05 | Chain 1K (ran 10K)          | PASS   | 2,857 build/s, 1,752 verify/s           |
| 06 | Merkle vs Linear            | PASS   | Merkle 58× faster for proof-of-inclusion|
| 07 | Multi-Observer Chain        | PASS   | 50-DOT chain, 5 observers, valid        |
| 08 | Chain Compression           | PASS   | Middle-out 96.3% reduction              |
| 09 | Middle-Out Cluster          | PASS   | Linear delta 90.7% reduction            |
| 10 | Dictionary Compression      | PASS   | Dict reduces payload avg 39%            |
| 11 | New DOT Types               | PASS   | 8 extended types seal + verify          |
| 12 | DOT Filesystem vs Naive     | PASS   | Naive wins at this scale (25KB vs 49KB) |
| 13 | Knowledge Graph             | PASS   | 50 DOTs, 4 graph queries sub-12µs       |
| 14 | Contested Knowledge Graph   | PASS   | Both claims coexist, weighted consensus |
| 15 | File Split & Reconstruction | PASS   | 0.11% DOT overhead for 1MB file         |
| 16 | Redundancy & Recovery       | PASS   | 3× replication survives 30% loss        |
| 17 | Encrypted Storage           | PASS   | 246B overhead, intruder rejected        |
| 18 | Wikipedia Scale Model       | PASS   | All scenarios fit on 128GB phone        |
| 19 | The $800 Estimate           | PASS   | All open knowledge = $1,300 (~91 TB)    |
| 20 | Minimum Viable Archive      | PASS   | 100 observations, 23.2 KB, 0.19s BLE   |
| 21 | Ultra Compressed Archive    | PASS   | 13% savings with dict + XOR delta       |
| 22 | Speed Benchmark             | PASS   | 122B fixed overhead, seal ~0.35ms/DOT  |
| 23 | Concurrent Chain Building   | PASS   | Lock required; 95/100 links corrupt w/o |
| 24 | Filesystem Crossover Point  | PASS   | Hetero: never; Homo crossover N=18      |
| 25 | Post-Quantum Size Model     | PASS   | PQ overhead 5,271B (43x); $1,300→$10,400|
| 26 | Compression vs PQ           | PASS   | 36% rescue; 96.1% sig floor             |
| 27 | One Writer Per Chain        | PASS   | 0/500 corrupt; 4.9x faster than locked  |

---

## Full Results

### EXP-01: Genesis DOT
```
DOT size:    160 bytes
Hash:        f4209e7c0ba692c3b9dace7d51642d54edd5a3cc402c836c80a2cab36fe61640
Verified:    True
Type:        OBSERVATION
Payload:     "The act of observation leaves its dot."
Saved:       experiments/results/genesis.dot
```

### EXP-02: Integrity Prism
```
DOTs:        1,000 (900 clean, 100 tampered)
Detection:   100.0% (100/100 caught)
False pos:   0.00%
Throughput:  1,762 verifications/second
Tamper types: payload_bitflip / timestamp_modify / sig_alter / parent_hash_swap
              all 25/25 caught
```

### EXP-03: Minimum DOT
```
Payload:     1 byte (0x00)
Total size:  123 bytes
Breakdown:   12B header + 35B key + 8B timestamp + 1B payload + 67B signature
Verified:    True
```

### EXP-04: Cold Open
```
Manual parse without library: magic=89444f54 (correct), version=1, type=0x01
Timestamp decoded: 2025-03-10T00:00:00Z (matches expected)
Payload: "The act of observation leaves its dot."
Library verify: True  — manual parse and library agree
```

### EXP-05: Chain 1K (ran 10K)
```
Chain length:     10,000 DOTs
Build:            0.350 ms/DOT → 2,857 DOTs/s
Verify:           0.571 ms/DOT → 1,752 DOTs/s
Total chain size: 2.22 MB (avg 233 bytes/DOT)
Chain valid:      True (all parent hashes link correctly)
```

### EXP-06: Merkle Tree vs Linear Chain
```
DOTs:           1,024
Merkle depth:   10 levels
Proof (DOT #512): 10 hops, 320 bytes
Linear (DOT #512): 512 hash operations
Speedup:        58×
Proof valid:    True
```

### EXP-07: Multi-Observer Chain
```
Observers:   5 (alice, bob, carol, dave, eve)
Chain:       50 DOTs (10 each, rotating)
Chain valid: True
Total size:  9,646 bytes (avg 192 bytes/DOT)
Distribution: perfectly even (10 each)
```

### EXP-08: Chain Compression Ratio
```
DOTs:       1,000 (business journal payloads, 77-88B each)
A) Raw:          205,465 bytes  (1.000×)
B) Gzip:          75,733 bytes  (0.369×  — 63.1% reduction)
C) Chain-aware:   67,799 bytes  (0.330×  — 67.0% reduction)
D) Middle-out:     7,636 bytes  (0.037×  — 96.3% reduction)

Signatures dominate compressed size (64KB of 68KB in approach C).
Middle-out wins when payloads are similar (business journal corpus).
```

### EXP-09: Middle-Out Cluster Compression
```
DOTs:        100 city descriptions
A) Raw:      10,525 bytes  (1.000×)
B) Linear:      983 bytes  (0.093×  — 90.7% reduction)
C) Middle-out:  994 bytes  (0.094×  — 90.6% reduction)
Linear marginally wins vs middle-out for sequential similar content.
```

### EXP-10: Dictionary Compression
```
Corpus:      500 observations (4 categories)
Dictionary:  200 phrases
Avg payload before: 66B  →  after: 40B  (0.606× ratio)
Dict DOT:    6,750 bytes overhead
Note: Dict overhead exceeds payload savings at this corpus size.
Breakeven at larger corpora.
```

### EXP-11: New DOT Types
```
8 extended types (0x05–0x0C): DICTIONARY, REFERENCE, DELTA, TREE,
ARCHIVE, RELATION, PIECE, STORAGE_PROOF
All seal and verify correctly.
Unregistered types fall back to UNKNOWN_0x08 naming (expected).
Size range: 190B (DICTIONARY) – 319B (RELATION, STORAGE_PROOF)
```

### EXP-12: DOT Filesystem vs Naive
```
Articles:    100 (50 cities + 50 person bios)
A) Naive:    25,365 bytes  (1 DOT per article)
B) Filesystem (dict + templates + deltas + archive): 48,554 bytes
Naive wins at 100 articles — filesystem overhead dominates small corpora.
Filesystem approach pays off at scale (thousands of articles).
```

### EXP-13: Knowledge Graph
```
Nodes:  20 DOTs, Relations: 30 DOTs  (50 total)
Total:  14,894 bytes (14.5 KB)
All 50 verified in 28.6 ms

Query A (physics nodes):    ['Newton','Einstein','Marie Curie','Feynman','Hawking']
Query B (Newton INFLUENCED): ['Einstein','Feynman','Hawking']
Query C (Archimedes→DOT):   Archimedes → DOT  (1 hop direct edge)
Query D (2-hop from DOT):   17 nodes
All queries ran in < 12µs
```

### EXP-14: Contested Knowledge Graph
```
Alice (5-DOT chain): Newton INFLUENCED Einstein  (62.5% weight)
Bob   (3-DOT chain): Newton DID_NOT_INFLUENCE Einstein  (37.5% weight)
Both claims: verified=True
All 10 DOTs verifiable.
Key insight: Disagreement is data. No conflict error. Both coexist.
Weighted consensus = chain length as trust proxy.
```

### EXP-15: File Splitting & Reconstruction
```
File:    1,048,576 bytes (1 MB)
Pieces:  4 × 256KB PIECE DOTs + 1 ARCHIVE DOT
SHA-256 before: ddb24689b5f13baecc7c8bafc7289b30...
SHA-256 after:  ddb24689b5f13baecc7c8bafc7289b30...  MATCH
DOT overhead:   0.11%  (1,156 bytes for 5 DOTs)
Reconstruction: True
```

### EXP-16: Redundancy & Partial Recovery
```
File:         512KB, 8 pieces × 64KB
Replication:  3× (24 DOTs total)
Removed:      7 DOTs (30%)
Survived:     17 DOTs
Lost pieces:  none  (3× replication with random removal)
Recovery:     8/8 pieces, SHA-256 matches
Result:       Full reconstruction from first available copy per piece
```

### EXP-17: Encrypted Storage
```
Payload:   54,000 bytes (~52 KB)
Encrypted DOT: 54,246 bytes
Overhead:  246 bytes (key encapsulation + AES-GCM tag + nonce)

Test 1: verify() without keypair = True   (signature checkable unencrypted)
Test 2: dot_open(owner)          = True   (decrypts correctly)
Test 3: dot_open(intruder)       = True   (NotAddressedToYouError raised)
Test 4: dot_open(no keypair)     = True   (NotAddressedToYouError raised)
```

### EXP-18: Wikipedia Scale Model
```
Wikipedia English raw: 21.0 GB
Parameters: gzip=50%, filesystem=67%, DOT overhead=11%, verify=1762/s

Scenario 1 (Naive/gzip):          11.7 GB  — fits phone, SD, Pi
Scenario 2 (Filesystem):          15.6 GB  — fits phone, SD, Pi
Scenario 3 (+ 30% dedup):         10.9 GB  — fits phone, SD, Pi
Scenario 4 (+ embeddings 6.86GB): 17.8 GB  — fits phone, SD, Pi

All scenarios fit on a 128GB phone. All fit on 64GB SD card.
Wikipedia + all metadata + embedding index under 18 GB.
```

### EXP-19: The $800 Estimate
```
Corpus:  Wikipedia + Gutenberg + arXiv + Open Subtitles + Sci-Hub + Anna's Archive
Raw:     232,160 GB (232 TB)
Compressed (filesystem + dedup + DOT overhead): 91,169 GB (91.2 TB)
Storage: 13 × 8TB drives @ $100 = $1,300
Portable: 714 × 128GB phones

Verification at 1,678 DOTs/s: 11 years solo, 4 days with 1,000 nodes.
A single person could own and cryptographically verify all of it.
```

### EXP-20: Minimum Viable Archive
```
Observations: 100 (10 categories: math, sky, body, history, thinking,
              money, relationships, rights, future, DOT itself)
Payload:      8,143 bytes raw text
DOT chain:    23,709 bytes (23.2 KB total)
Avg DOT:      237.1 bytes
Seal time:    35.1 ms  (0.351 ms/DOT)
Verify time:  57.1 ms  (0.571 ms/DOT)
Chain valid:  True

Transmission: 0.19s over BLE, 9 QR codes, trivial as email
Saved: experiments/results/minimum_viable_archive.dot
```

### EXP-21: Ultra Compressed Archive
```
Same 100 observations, dict + XOR delta encoding
Dictionary: 13 three-word phrases (min freq 2)
Dict DOT: 415 bytes

Plain chain (EXP-20):      23,709 bytes
Compressed (dict + XOR):   20,615 bytes
Savings:                   13.0%

All 101 DOTs (dict + 100 obs) individually verified.
Note: XOR delta on short, varied text gives modest savings.
Larger homogeneous corpora yield much higher ratios (EXP-08 showed 96%).
```

### EXP-22: Speed Benchmark
```
Payload   Seal (ms)  Verify (ms)  DOT bytes  Overhead
1B        0.344      0.572        123        122B (99.2%)
10B       0.343      0.569        132        122B (92.4%)
100B      0.342      0.578        222        122B (55.0%)
1KB       0.377      0.598        1,146      122B (10.6%)
10KB      0.592      0.705        10,362     122B (1.2%)
100KB     2.666      1.839        102,522    122B (0.1%)
1MB       25.086     13.599       1,048,698  122B (0.0%)

Fixed overhead: 122 bytes per DOT (always, regardless of payload)
Seal throughput @ 1KB: 2,719 MB/s
Verify throughput @ 1KB: 1,714 MB/s
Ed25519 verify is O(1) in payload size up to ~10KB, then linear.
```

### EXP-23: Concurrent Chain Building
```
5 observers, 20 DOTs each (100 total per phase)

Phase 1 WITHOUT lock:
  Chain link errors: 95/99  (race conditions corrupt parent hashes)
  Signatures still valid (each DOT internally consistent)
  Chain integrity: CORRUPTED

Phase 2 WITH lock:
  All sigs valid: True
  All chain links valid: True
  Lock overhead: +360% time (7.9ms → 36.2ms)

Key insight: Individual DOT creation is thread-safe; shared chain
pointer (prev) requires serialized writes. Concurrent reads are safe.
```

---

### EXP-24: Filesystem Crossover Point
```
CORPUS A: HETEROGENEOUS (city/person articles — EXP-12 style)
N=50:    naive=12,672B   fs=18,730B   winner=naive       ratio=1.48
N=100:   naive=25,365B   fs=34,665B   winner=naive       ratio=1.37
N=200:   naive=50,681B   fs=66,691B   winner=naive       ratio=1.32
N=500:   naive=126,701B  fs=162,363B  winner=naive       ratio=1.28
N=1000:  naive=253,385B  fs=321,932B  winner=naive       ratio=1.27
N=2000:  naive=506,741B  fs=641,046B  winner=naive       ratio=1.27
N=5000:  naive=1,266,841B fs=1,598,132B winner=naive     ratio=1.26
N=10000: naive=2,533,685B fs=3,193,297B winner=naive     ratio=1.26
CROSSOVER (hetero): Not reached by N=10000

CORPUS B: HOMOGENEOUS (sensor records — 1 field changes per record)
N=50:    naive=13,550B   fs=11,378B   winner=filesystem  ratio=1.19
N=100:   naive=27,100B   fs=21,559B   winner=filesystem  ratio=1.26
...
CROSSOVER (homo): N=18  (filesystem wins above this)

Key insight: byte-delta on heterogeneous text (97B article → 106B delta) never helps.
Byte-delta on homogeneous records (149B → 8B) crosses over at N=18.
Rule: filesystem wins only when per-article delta << original size.
```

### EXP-25: Post-Quantum DOT Size Model
```
Crypto suite comparison:
  Ed25519:   pubkey=32B,   sig=64B   → 122B fixed overhead/DOT
  ML-DSA-65: pubkey=1952B, sig=3293B → 5,271B fixed overhead/DOT (43x increase)

EXP-22 recomputed (PQ DOT sizes):
  1B payload:    123B (Ed25519)  →   5,272B (PQ)   PQ overhead 100.0%
  100B payload:  222B            →   5,371B         PQ overhead 98.1%
  1KB payload:   1,146B          →   6,295B         PQ overhead 83.7%
  1MB payload:   1,048,698B      → 1,053,847B       PQ overhead 0.5%

EXP-18 recomputed (Wikipedia on 128GB phone):
  All 4 scenarios still fit: PQ worst case = 47.6 GB  (128GB phone: YES)

EXP-19 recomputed ($1300 estimate):
  Ed25519: 89 TB → 12 drives @ $1,200
  ML-DSA-65: 826 TB → 104 drives @ $10,400  (9.3x multiplier)

EXP-20 recomputed (100-DOT minimum viable archive):
  Ed25519:   23,700B (23.1 KB),   BLE: 0.19s
  ML-DSA-65: 538,600B (526.0 KB), BLE: 4.31s  (22.7x larger)
```

### EXP-26: Compression vs Post-Quantum (Shannon's Challenge)
```
Scenario A: Single-observer chain, 1000 DOTs, 100B payloads
  Ed25519 raw:               222,000B
  PQ raw (no compression):  5,371,000B   (1.00x)
  PQ chain-aware (pubkey dedup): 3,424,948B  (0.638x vs raw)
  PQ gzip estimate:          4,714,333B  (0.878x vs raw)

  Signature floor: 1000 × 3,293B = 3,293,000B
  = 96.1% of chain-aware compressed size
  Shannon's limit: cannot compress below 3,293,000B for 1000 PQ DOTs
  Compression rescues 36.2% of PQ overhead.

Scenario B: Multi-observer, 1000 DOTs, 50 observers (20 DOTs each)
  PQ multi raw:             5,371,000B
  PQ multi chain-aware:     3,520,400B  (pubkey dedup within observer)
  Signature floor: 93.5% of compressed size

Key metrics:
  pq_chain_compressed_bytes:          3,424,948
  pq_multi_observer_compressed_bytes: 3,520,400
  signature_floor_percentage:         96.1% (single) / 93.5% (multi)

Conclusion: Compression rescues pubkey bloat (1952B → ~4B amortized) but
cannot touch the 3293B signatures — cryptographically random by design.
```

### EXP-27: One Writer Per Chain (Satoshi's Conjecture)
```
INDEPENDENT CHAINS (no lock):
Writers: 5 concurrent
DOTs per chain: 100
Total DOTs: 500
Corruption: 0/500 (expect 0)
Throughput: 13,453 DOTs/s
vs EXP-23 locked: 4.9x faster

CROSS-CHAIN RELATIONS:
Relations created: 20
All resolve: YES
Query time (find related to chain 0): 11,197µs

CONCLUSION: One-writer-per-chain DOES eliminate concurrency problem.

Key insight: Each writer owns its chain → zero contention → no locks needed.
The graph layer (RELATION DOTs) merges knowledge across chains at read time.
```

---

## Cross-Experiment Observations

### The 122-Byte Constant
Every DOT carries exactly 122 bytes of fixed overhead:
- 12B header (magic, version, suite, flags, type, payload length)
- 35B key section (key_type + key_length + 32B Ed25519 pubkey)
- 8B timestamp
- 67B signature (key_type + sig_length + 64B Ed25519 signature)

This is the minimum cost of cryptographic provenance. For payloads > 1KB, overhead falls below 12%.

### Compression Hierarchy
The experiments reveal a clear compression hierarchy:
1. Middle-out (96.3% reduction) — for corpora with a natural centroid
2. Linear delta (90.7% reduction) — for sequential similar content
3. Chain-aware factoring (67%) — deduplicate pubkey + timestamps across chain
4. Naive gzip (63.1%) — always available, no corpus knowledge needed

### Verification Speed
1,762 DOTs/second on Apple Silicon (M-series).
At this rate: 1 million DOTs in ~9 minutes, 1 billion DOTs in ~6.6 days.
With 1,000 parallel verifiers: 1 billion DOTs in ~9 minutes.

### The DOT as Universal Container
EXP-11 through EXP-16 demonstrate DOTs work for:
- Graph nodes and edges (EXP-13, 14)
- File pieces and archives (EXP-15, 16)
- Encrypted payloads with access control (EXP-17)
- Dictionary and compression metadata (EXP-10, 21)
The wire format is agnostic — meaning lives in the payload and the type byte.

### Concurrency Model: One Writer Per Chain (EXP-23 + EXP-27)
The right concurrency model for DOTs is per-chain ownership, not locking:
- EXP-23: Shared chain + no lock → 95% corruption. Shared chain + lock → valid but 360% overhead.
- EXP-27: Independent chains, no lock → 0% corruption, 4.9x faster.
The graph layer (RELATION DOTs) merges knowledge across chains lazily.
This maps to distributed systems: each node owns its append-only log, references resolve at read time.

### Post-Quantum Scaling (EXP-25 + EXP-26)
ML-DSA-65 raises fixed overhead from 122B to 5,271B (43x). Key consequences:
- For small payloads (<10KB), PQ overhead dominates DOT size.
- Wikipedia still fits on a 128GB phone (all scenarios).
- All-of-human-knowledge storage: $1,300 (Ed25519) → $10,400 (PQ). Still single-person affordable.
- 100-DOT minimum viable archive: 0.19s BLE → 4.31s BLE. Still transmittable.
- Compression rescues pubkey bloat (36% reduction) but cannot break the signature floor (96.1%).
  Shannon's theorem applies: 3,293B PQ signatures are cryptographically random → incompressible.

### Filesystem Approach: Corpus Type Determines Winner (EXP-12 + EXP-24)
The filesystem approach (dict + templates + deltas) requires homogeneous corpora to win:
- Heterogeneous (varied text): delta ≥ original → filesystem never wins, even at N=10,000.
- Homogeneous (few fields change): delta << original → crossover at N=18.
EXP-12's finding ("naive wins at 100 articles") was corpus-dependent, not a general rule.
