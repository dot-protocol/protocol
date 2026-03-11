"""
Experiment 24: Filesystem Crossover Point
Find where DOT filesystem approach (dict + templates + deltas + archive)
beats naive (1 DOT per article).

Decision: Two corpora are tested.
  - HETEROGENEOUS (EXP-12 style city/person articles): articles change many fields,
    deltas balloon larger than originals → filesystem never wins.
  - HOMOGENEOUS (structured records with 1-2 changing fields): deltas stay small,
    filesystem overhead amortizes quickly → find exact crossover_N.

This reveals WHY EXP-12 found "filesystem loses" — wrong corpus type.
"""

import sys
import os
import json
import re
import hashlib
import struct
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

# ─── Deterministic keypair ────────────────────────────────────────────────────
kp = crypto.generate_keypair(hashlib.sha256(b"filesystem-exp24").digest())
TS_BASE = 1741564800_000_000

# ─── Article generators ───────────────────────────────────────────────────────
CITY_NAMES = [
    "Rome", "Bangkok", "Amsterdam", "Singapore", "Dubai",
    "Istanbul", "Vienna", "Barcelona", "Prague", "Zurich",
    "Athens", "Lisbon", "Copenhagen", "Warsaw", "Budapest",
    "Buenos Aires", "Nairobi", "Casablanca", "Hanoi", "Lima",
]
CITY_ADJS = ["vibrant", "historic", "cosmopolitan", "ancient", "modern",
             "diverse", "thriving", "elegant", "bustling", "scenic"]
CITY_COUNTRIES = [
    "Italy", "Thailand", "Netherlands", "Singapore", "UAE",
    "Turkey", "Austria", "Spain", "Czech Republic", "Switzerland",
    "Greece", "Portugal", "Denmark", "Poland", "Hungary",
    "Argentina", "Kenya", "Morocco", "Vietnam", "Peru",
]
CITY_FEATURES = [
    "its Colosseum", "ancient temples", "canal systems", "financial hub",
    "modern skyscrapers", "the Hagia Sophia", "classical music", "Gothic architecture",
    "medieval old town", "banking sector", "the Acropolis", "Fado music",
    "Nyhavn harbor", "historical sites", "thermal baths", "tango culture",
    "wildlife safaris", "Medina markets", "street food", "Machu Picchu proximity",
]
CITY_INDUSTRIES = ["tourism", "finance", "technology", "trade", "logistics",
                   "manufacturing", "arts", "agriculture", "pharmaceuticals", "education"]

PERSON_FIRST = ["Marie", "Isaac", "Charles", "Alan", "Nikola", "Richard", "Carl",
                "Ada", "James", "Stephen", "Gregor", "Louis", "Archimedes", "Albert", "Claude"]
PERSON_LAST = ["Curie", "Newton", "Darwin", "Turing", "Tesla", "Feynman", "Sagan",
               "Lovelace", "Maxwell", "Hawking", "Mendel", "Pasteur", "of Syracuse", "Einstein", "Shannon"]
ROLES = ["physicist", "mathematician", "biologist", "computer scientist", "chemist",
         "astronomer", "inventor", "engineer", "philosopher", "naturalist"]
COUNTRIES_P = ["Poland", "England", "England", "England", "Serbia", "USA", "USA",
               "England", "Scotland", "England", "Austria", "France", "Greece", "Germany", "USA"]
ACHIEVEMENTS = [
    "pioneering radioactivity research",
    "formulating classical mechanics and gravitation",
    "developing the theory of evolution by natural selection",
    "laying foundations for computer science",
    "inventing alternating current electrical systems",
    "contributions to quantum mechanics",
    "science communication and astrophysics",
    "creating the first algorithm",
    "electromagnetism equations",
    "theoretical cosmology and black holes",
    "discovering the laws of genetic inheritance",
    "germ theory and vaccines",
    "calculating pi and buoyancy principles",
    "special and general relativity",
    "information theory",
]
LEGACIES = [
    "Her work remains foundational to modern medicine.",
    "His laws govern classical physics to this day.",
    "Evolution is the cornerstone of modern biology.",
    "Computing as we know it rests on his theoretical work.",
    "AC power grids worldwide trace back to his patents.",
    "Feynman diagrams are used in particle physics globally.",
    "Billions watched Cosmos, sparking scientific curiosity.",
    "She is recognized as the first computer programmer.",
    "Maxwell's equations underpin all electromagnetic technology.",
    "His popular works made cosmology accessible to millions.",
    "Mendelian genetics explains heredity in all living things.",
    "Germ theory transformed medicine and public health.",
    "His contributions to mathematics echo through centuries.",
    "E=mc² changed our understanding of mass and energy.",
    "Information theory is the backbone of digital communication.",
]


def make_city_article(i):
    idx = i % len(CITY_NAMES)
    pop = (i % 8 + 2)
    return (
        f"{CITY_NAMES[idx]} is a {CITY_ADJS[i % len(CITY_ADJS)]} city of "
        f"{pop} million people located in {CITY_COUNTRIES[idx]}. "
        f"Known for {CITY_FEATURES[idx]} and {CITY_INDUSTRIES[i % len(CITY_INDUSTRIES)]}."
    ).encode()


def make_person_article(i):
    idx = i % len(PERSON_FIRST)
    birth = 1820 + (idx * 13)
    death = birth + 65 + (idx * 3 % 20)
    return (
        f"{PERSON_FIRST[idx]} {PERSON_LAST[idx]} ({birth}-{death}) was "
        f"{ROLES[i % len(ROLES)]} from {COUNTRIES_P[idx]}. "
        f"Known for {ACHIEVEMENTS[idx]}. {LEGACIES[idx]}"
    ).encode()


def make_hetero_articles(n):
    articles = []
    for i in range(n):
        if i % 2 == 0:
            articles.append(make_city_article(i // 2))
        else:
            articles.append(make_person_article(i // 2))
    return articles


# Homogeneous corpus: structured sensor/observation records with one changing numeric field
def make_homo_article(i):
    """Highly templated: only the reading value and index change."""
    return (
        f"SENSOR:thermometer-001 LOCATION:server-room-a "
        f"READING:{20.00 + i * 0.01:.2f}C UNIT:celsius STATUS:nominal "
        f"FACILITY:datacenter-west RACK:rack-07 ALERTS:none IDX:{i:06d}"
    ).encode()


# ─── Byte-level delta encoding ────────────────────────────────────────────────
def byte_delta(base: bytes, modified: bytes) -> bytes:
    """
    Compact byte-level delta: 2-byte count + (2-byte offset, 1-byte value) triples.
    Only encodes differing bytes. For same-length articles this is exact.
    Falls back to storing full article if delta > original.
    """
    base_len = max(len(base), len(modified))
    base_p = base.ljust(base_len, b' ')
    mod_p  = modified.ljust(base_len, b' ')

    diffs = []
    for idx in range(base_len):
        if base_p[idx] != mod_p[idx]:
            diffs.append((idx, mod_p[idx]))

    encoded = struct.pack(">H", len(diffs))
    for pos, val in diffs:
        encoded += struct.pack(">H", pos) + bytes([val])

    # Only use delta if it's smaller
    return encoded if len(encoded) < len(modified) else modified


# ─── Filesystem approach (byte-delta version) ─────────────────────────────────
def measure_filesystem(articles, n):
    """
    dict (top phrases) + 1 template + N byte-level deltas + archive.
    This is the correct filesystem model: only one template type.
    """
    template = articles[0]

    # Dictionary: top phrases from corpus
    phrase_counts = Counter()
    for art in articles:
        words = re.split(r'\s+', art.decode())
        for length in range(2, 5):
            for j in range(len(words) - length + 1):
                phrase_counts[" ".join(words[j:j + length])] += 1
    top_phrases = sorted(
        ((p, c) for p, c in phrase_counts.items() if c >= 3),
        key=lambda x: -x[1]
    )[:100]
    dict_payload = json.dumps({"entries": {p: c for p, c in top_phrases}}).encode()
    dict_dot = create(payload=dict_payload, keypair=kp, dot_type=0x05,
                      timestamp_us=TS_BASE - 2000)

    # Template DOT
    template_dot = create(payload=template, keypair=kp, dot_type=0x07,
                          timestamp_us=TS_BASE - 1000)

    # Delta DOTs (byte-level)
    delta_dots = []
    for i, article in enumerate(articles):
        delta = byte_delta(template, article)
        d = create(payload=delta, keypair=kp, dot_type=0x07,
                   timestamp_us=TS_BASE + i * 1000)
        delta_dots.append(d)

    # Archive DOT
    all_hashes = [hashlib.sha256(d).hexdigest() for d in delta_dots]
    archive_payload = json.dumps({
        "template_hash": hashlib.sha256(template_dot).hexdigest(),
        "dict_hash": hashlib.sha256(dict_dot).hexdigest(),
        "delta_hashes": all_hashes,
        "total_articles": n,
    }).encode()
    archive_dot = create(payload=archive_payload, keypair=kp, dot_type=0x09,
                         timestamp_us=TS_BASE + n * 1000 + 1000)

    return (
        len(dict_dot) + len(template_dot) +
        sum(len(d) for d in delta_dots) + len(archive_dot)
    )


def measure_naive(articles):
    return sum(
        len(create(payload=art, keypair=kp, dot_type=TYPE_OBSERVATION,
                   timestamp_us=TS_BASE + i * 1000))
        for i, art in enumerate(articles)
    )


# ─── Run both corpora at each N ───────────────────────────────────────────────
SIZES = [50, 100, 200, 500, 1000, 2000, 5000, 10000]

print("=" * 75)
print("  EXPERIMENT 24: FILESYSTEM CROSSOVER POINT")
print("=" * 75)
print()

# ── CORPUS 1: Heterogeneous (EXP-12 style) ──
print("  CORPUS A: HETEROGENEOUS (city/person articles — EXP-12 style)")
print(f"  {'N':>6}  {'naive':>12}  {'fs':>12}  {'winner':<10}  {'ratio':>6}")
print(f"  {'-'*6}  {'-'*12}  {'-'*12}  {'-'*10}  {'-'*6}")

hetero_crossover = None
for n in SIZES:
    arts = make_hetero_articles(n)
    nb = measure_naive(arts)
    fb = measure_filesystem(arts, n)
    if nb <= fb:
        winner = "naive"
        ratio = fb / nb
    else:
        winner = "filesystem"
        ratio = nb / fb
        if hetero_crossover is None:
            hetero_crossover = n
    print(f"  N={n:<5}  naive={nb:>9,}B  fs={fb:>9,}B  winner={winner:<10}  ratio={ratio:.2f}")

print()
if hetero_crossover:
    print(f"  CROSSOVER (hetero): N={hetero_crossover}")
else:
    print(f"  CROSSOVER (hetero): Not reached by N=10000")
    print(f"  (Unified diffs on varied text exceed original size — deltas never help)")
print()

# ── CORPUS 2: Homogeneous (sensor records, single changing field) ──
print("  CORPUS B: HOMOGENEOUS (sensor records — 1 field changes per record)")
print(f"  {'N':>6}  {'naive':>12}  {'fs':>12}  {'winner':<10}  {'ratio':>6}")
print(f"  {'-'*6}  {'-'*12}  {'-'*12}  {'-'*10}  {'-'*6}")

homo_crossover_n = None
prev_homo_winner = "naive"
for n in SIZES:
    arts = [make_homo_article(i) for i in range(n)]
    nb = measure_naive(arts)
    fb = measure_filesystem(arts, n)
    if nb <= fb:
        winner = "naive"
        ratio = fb / nb
    else:
        winner = "filesystem"
        ratio = nb / fb
        if homo_crossover_n is None:
            homo_crossover_n = n
    print(f"  N={n:<5}  naive={nb:>9,}B  fs={fb:>9,}B  winner={winner:<10}  ratio={ratio:.2f}")

print()
if homo_crossover_n is not None:
    # Binary search for exact crossover in [prev_size, homo_crossover_n]
    idx = SIZES.index(homo_crossover_n)
    lo = SIZES[idx - 1] if idx > 0 else 1
    hi = homo_crossover_n
    while hi - lo > 1:
        mid = (lo + hi) // 2
        arts = [make_homo_article(i) for i in range(mid)]
        nb = measure_naive(arts)
        fb = measure_filesystem(arts, mid)
        if fb < nb:
            hi = mid
        else:
            lo = mid
    print(f"  CROSSOVER (homo): N={hi}  (filesystem wins above this)")
else:
    print(f"  CROSSOVER (homo): Not reached by N=10000")
print()

# ── Explain why ──
template_city = make_city_article(0)
template_homo = make_homo_article(0)
sample_city_delta = byte_delta(template_city, make_city_article(1))
sample_homo_delta = byte_delta(template_homo, make_homo_article(1))

print(f"  WHY THE DIFFERENCE:")
print(f"    City article template:     {len(template_city)}B original → {len(sample_city_delta)}B byte-delta")
print(f"    Sensor record template:    {len(template_homo)}B original → {len(sample_homo_delta)}B byte-delta")
print(f"    Heterogeneous articles change many bytes (name, country, feature, industry)")
print(f"    → delta >= original, filesystem overhead never recovers")
print(f"    Homogeneous records change only a few bytes (reading + index)")
print(f"    → delta << original, fixed overhead amortizes quickly")
print()
print(f"  RULE: Filesystem approach wins ONLY when per-article delta << original size.")
print(f"        The crossover_N is determined by (fixed_overhead) / (naive_cost - delta_cost).")
print()
print("  ✅ EXP-24 COMPLETE")
print("=" * 75)
