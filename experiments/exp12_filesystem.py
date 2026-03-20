"""
Experiment 12: DOT Filesystem vs DOT Wrapper
100 articles (50 cities + 50 person bios). Compare naive vs filesystem approach.
"""

import sys
import os
import json
import zlib
import difflib
import hashlib
import random
from collections import Counter
import re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

random.seed(7)

kp = crypto.generate_keypair(hashlib.sha256(b"filesystem-exp12").digest())
TS_BASE = 1741564800_000_000

# Article generation
city_names = ["Rome", "Bangkok", "Amsterdam", "Singapore", "Dubai",
              "Istanbul", "Vienna", "Barcelona", "Prague", "Zurich",
              "Athens", "Lisbon", "Copenhagen", "Warsaw", "Budapest",
              "Buenos Aires", "Nairobi", "Casablanca", "Hanoi", "Lima"]
city_adjs = ["vibrant", "historic", "cosmopolitan", "ancient", "modern",
             "diverse", "thriving", "elegant", "bustling", "scenic"]
city_countries = ["Italy", "Thailand", "Netherlands", "Singapore", "UAE",
                  "Turkey", "Austria", "Spain", "Czech Republic", "Switzerland",
                  "Greece", "Portugal", "Denmark", "Poland", "Hungary",
                  "Argentina", "Kenya", "Morocco", "Vietnam", "Peru"]
city_features = ["its Colosseum", "ancient temples", "canal systems", "financial hub",
                 "modern skyscrapers", "the Hagia Sophia", "classical music", "Gothic architecture",
                 "medieval old town", "banking sector", "the Acropolis", "Fado music",
                 "Nyhavn harbor", "historical sites", "thermal baths", "tango culture",
                 "wildlife safaris", "Medina markets", "street food", "Machu Picchu proximity"]
city_industries = ["tourism", "finance", "technology", "trade", "logistics",
                   "manufacturing", "arts", "agriculture", "pharmaceuticals", "education"]

person_first = ["Marie", "Isaac", "Charles", "Alan", "Nikola", "Richard", "Carl",
                "Ada", "James", "Stephen", "Gregor", "Louis", "Archimedes", "Albert", "Claude"]
person_last = ["Curie", "Newton", "Darwin", "Turing", "Tesla", "Feynman", "Sagan",
               "Lovelace", "Maxwell", "Hawking", "Mendel", "Pasteur", "of Syracuse", "Einstein", "Shannon"]
roles = ["physicist", "mathematician", "biologist", "computer scientist", "chemist",
         "astronomer", "inventor", "engineer", "philosopher", "naturalist"]
countries_p = ["Poland", "England", "England", "England", "Serbia", "USA", "USA",
               "England", "Scotland", "England", "Austria", "France", "Greece", "Germany", "USA"]
achievements = [
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
legacies = [
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
    idx = i % len(city_names)
    pop = (i % 8 + 2)
    text = (f"{city_names[idx]} is a {city_adjs[i % len(city_adjs)]} city of "
            f"{pop} million people located in {city_countries[idx]}. "
            f"Known for {city_features[idx]} and {city_industries[i % len(city_industries)]}.")
    return text.encode()

def make_person_article(i):
    idx = i % len(person_first)
    birth = 1820 + (idx * 13)
    death = birth + 65 + (idx * 3 % 20)
    text = (f"{person_first[idx]} {person_last[idx]} ({birth}-{death}) was "
            f"{roles[i % len(roles)]} from {countries_p[idx]}. "
            f"Known for {achievements[idx]}. {legacies[idx]}")
    return text.encode()

# Generate 100 articles
city_articles = [make_city_article(i) for i in range(50)]
person_articles = [make_person_article(i) for i in range(50)]
all_articles = city_articles + person_articles

# APPROACH A: Naive — each article = 1 DOT
naive_dots = []
for i, article in enumerate(all_articles):
    d = create(payload=article, keypair=kp, dot_type=TYPE_OBSERVATION,
               timestamp_us=TS_BASE + i * 1000)
    naive_dots.append(d)
naive_total = sum(len(d) for d in naive_dots)

# APPROACH B: Filesystem approach
# 1. Build dictionary from corpus
def extract_phrases(texts):
    counts = Counter()
    for text in texts:
        words = re.split(r'\s+', text.decode())
        for length in range(2, 5):
            for j in range(len(words) - length + 1):
                phrase = " ".join(words[j:j+length])
                counts[phrase] += 1
    return {p: c for p, c in counts.items() if c >= 3}

phrase_freq = extract_phrases(all_articles)
top_phrases = sorted(phrase_freq.items(), key=lambda x: -x[1])[:100]
dict_data = json.dumps({"entries": {p: c for p, c in top_phrases}}).encode()
dict_dot = create(payload=dict_data, keypair=kp, dot_type=0x05,
                  timestamp_us=TS_BASE - 2000)

# 2. City template DOT
city_template = make_city_article(0)
city_template_dot = create(payload=city_template, keypair=kp, dot_type=0x07,
                           timestamp_us=TS_BASE - 1500)

# 3. Person template DOT
person_template = make_person_article(0)
person_template_dot = create(payload=person_template, keypair=kp, dot_type=0x07,
                             timestamp_us=TS_BASE - 1000)

# 4. Delta DOTs for each article
def make_delta(template, article):
    diff = b"".join(
        difflib.diff_bytes(
            difflib.unified_diff,
            [template], [article],
            lineterm=b""
        )
    )
    return diff if diff else b"SAME"

delta_dots = []
for i, article in enumerate(city_articles):
    diff = make_delta(city_template, article)
    d = create(payload=diff, keypair=kp, dot_type=0x07,
               timestamp_us=TS_BASE + i * 1000)
    delta_dots.append(d)

for i, article in enumerate(person_articles):
    diff = make_delta(person_template, article)
    d = create(payload=diff, keypair=kp, dot_type=0x07,
               timestamp_us=TS_BASE + (50 + i) * 1000)
    delta_dots.append(d)

# 5. Archive DOT
import hashlib as _hl
all_hashes = [_hl.sha256(d).hexdigest() for d in delta_dots]
merkle_root = _hl.sha256(b"".join(_hl.sha256(h.encode()).digest() for h in all_hashes)).hexdigest()
archive_payload = json.dumps({
    "dict_hash": _hl.sha256(dict_dot).hexdigest(),
    "city_template_hash": _hl.sha256(city_template_dot).hexdigest(),
    "person_template_hash": _hl.sha256(person_template_dot).hexdigest(),
    "delta_hashes": all_hashes,
    "merkle_root": merkle_root,
    "total_articles": 100,
}).encode()
archive_dot = create(payload=archive_payload, keypair=kp, dot_type=0x09,
                     timestamp_us=TS_BASE + 101 * 1000)

# Filesystem total
fs_total = (len(dict_dot) + len(city_template_dot) + len(person_template_dot) +
            sum(len(d) for d in delta_dots) + len(archive_dot))

# Verify 5 random DOTs from each approach
import random as _rng
_rng.seed(42)
sample_naive = _rng.sample(naive_dots, 5)
sample_fs = _rng.sample(delta_dots, 5)
naive_verified = all(verify(d).verified for d in sample_naive)
fs_verified = all(verify(d).verified for d in sample_fs)

print("=" * 65)
print("  EXPERIMENT 12: DOT FILESYSTEM VS DOT WRAPPER")
print("=" * 65)
print()
print(f"  Articles:           100 (50 cities + 50 person bios)")
print()
print(f"  APPROACH A (Naive — 1 DOT per article):")
print(f"    Total size:       {naive_total:,} bytes ({naive_total/1024:.1f} KB)")
print(f"    Avg DOT size:     {naive_total // 100} bytes")
print(f"    5 random verified: {naive_verified}")
print()
print(f"  APPROACH B (Filesystem — dict + templates + deltas + archive):")
print(f"    Dictionary DOT:   {len(dict_dot):,} bytes")
print(f"    City template:    {len(city_template_dot):,} bytes")
print(f"    Person template:  {len(person_template_dot):,} bytes")
print(f"    100 delta DOTs:   {sum(len(d) for d in delta_dots):,} bytes total")
print(f"    Archive DOT:      {len(archive_dot):,} bytes")
print(f"    Total size:       {fs_total:,} bytes ({fs_total/1024:.1f} KB)")
print(f"    5 random verified: {fs_verified}")
print()
ratio = fs_total / naive_total
print(f"  Filesystem ratio:   {ratio:.3f} vs naive")
print(f"  Size reduction:     {(1-ratio)*100:.1f}%")
print()
print("  EXPERIMENT 12 COMPLETE")
print("=" * 65)
