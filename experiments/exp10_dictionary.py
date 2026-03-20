"""
Experiment 10: Dictionary Compression
500 text observations, build phrase dictionary, compress, seal as DOTs.
"""

import sys
import os
import zlib
import json
import hashlib
import re
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

import random
random.seed(99)

# Generate 500 observations (mix of cities, people, numbers, science)
city_names = ["Paris", "Tokyo", "London", "NYC", "Berlin", "Cairo", "Sydney", "Mumbai"]
person_names = ["Newton", "Einstein", "Curie", "Darwin", "Turing", "Tesla", "Sagan"]
science_facts = [
    "Light travels at 299,792 km per second in vacuum.",
    "Water is composed of two hydrogen and one oxygen atom.",
    "The human genome contains approximately 3 billion base pairs.",
    "Gravity accelerates objects at 9.8 meters per second squared.",
    "DNA replication is semiconservative and bidirectional.",
]
city_facts = [
    "is a major financial center with millions of residents.",
    "is known for its historic architecture and cultural heritage.",
    "has a population density exceeding 10,000 people per square kilometer.",
    "hosts international trade and commerce from around the world.",
    "is located in a temperate climate zone with four seasons.",
]
person_facts = [
    "made groundbreaking contributions to modern science.",
    "published influential papers that changed how we understand the world.",
    "was born in the 19th century and lived through remarkable change.",
    "developed theories that are still taught in universities today.",
    "received international recognition for scientific achievements.",
]

observations = []
for i in range(500):
    category = i % 4
    if category == 0:
        c = random.choice(city_names)
        f = random.choice(city_facts)
        obs = f"{c} {f}"
    elif category == 1:
        p = random.choice(person_names)
        f = random.choice(person_facts)
        obs = f"{p} {f}"
    elif category == 2:
        obs = random.choice(science_facts) + f" This is observation {i}."
    else:
        obs = f"Record {i}: The value is {random.randint(100, 9999)}. Status: confirmed."
    observations.append(obs.encode())

# Build compression dictionary
# Extract 2-5 word phrases
def extract_phrases(texts, min_len=2, max_len=5):
    all_phrases = []
    for text in texts:
        words = re.split(r'\s+', text.decode())
        for length in range(min_len, max_len + 1):
            for j in range(len(words) - length + 1):
                phrase = " ".join(words[j:j+length])
                if len(phrase) > 4:  # Skip very short phrases
                    all_phrases.append(phrase)
    return all_phrases

phrases = extract_phrases(observations)
phrase_counts = Counter(phrases)
top_200 = [(phrase, count) for phrase, count in phrase_counts.most_common(200)
           if count >= 2]  # Only phrases that appear 2+ times

# Build code → phrase and phrase → code maps
phrase_to_code = {}
code_to_phrase = {}
for idx, (phrase, _) in enumerate(top_200):
    code = (idx + 1).to_bytes(2, 'big')
    phrase_to_code[phrase] = code
    code_to_phrase[code.hex()] = phrase

def compress_text(text: bytes, phrase_to_code: dict) -> bytes:
    """Replace phrases with 2-byte codes, longest match first."""
    s = text.decode()
    # Sort phrases by length (longest first) for greedy match
    sorted_phrases = sorted(phrase_to_code.keys(), key=len, reverse=True)
    # Simple replacement
    for phrase in sorted_phrases:
        if phrase in s:
            code = phrase_to_code[phrase]
            s = s.replace(phrase, f"\x00{code.decode('latin-1')}", 1)
    return s.encode('latin-1')

kp = crypto.generate_keypair(hashlib.sha256(b"dictionary-exp10").digest())

# Compress each observation and measure
raw_total = sum(len(o) for o in observations)

compressed_payloads = []
for obs in observations:
    compressed = compress_text(obs, phrase_to_code)
    further = zlib.compress(compressed, level=9)
    compressed_payloads.append(further)

compressed_total = sum(len(c) for c in compressed_payloads)

# Create DOTs with compressed payloads
dots = []
for i, payload in enumerate(compressed_payloads):
    d = create(payload=payload, keypair=kp, dot_type=TYPE_OBSERVATION,
               timestamp_us=1741564800_000_000 + i * 1000)
    dots.append(d)

# Dictionary DOT (type 0x05 = ANTI_DOT in library, but we pass raw value)
dict_json = json.dumps({"codes": code_to_phrase, "version": 1}).encode()
dict_dot = create(payload=dict_json, keypair=kp, dot_type=0x05,
                  timestamp_us=1741564800_000_000 - 1000)

archive_raw = raw_total
archive_with_dict = len(dict_dot) + sum(len(d) for d in dots)

dict_overhead_pct = len(dict_dot) / archive_with_dict * 100
avg_before = raw_total // len(observations)
avg_after = compressed_total // len(observations)

print("=" * 65)
print("  EXPERIMENT 10: DICTIONARY COMPRESSION — RESULTS")
print("=" * 65)
print()
print(f"  Corpus:              {len(observations)} observations")
print(f"  Unique phrases:      {len(phrase_counts)} found")
print(f"  Dictionary entries:  {len(top_200)} (top 200 by frequency)")
print()
print(f"  Dictionary DOT size: {len(dict_dot)} bytes")
print(f"  Dict JSON size:      {len(dict_json)} bytes")
print()
print(f"  Payload stats:")
print(f"    Avg before:        {avg_before} bytes")
print(f"    Avg after:         {avg_after} bytes")
print(f"    Compression ratio: {avg_after/avg_before:.3f}")
print()
print(f"  Archive totals:")
print(f"    Raw payloads:      {archive_raw:,} bytes")
print(f"    Dict + compressed: {archive_with_dict:,} bytes")
print(f"    Reduction:         {(1-archive_with_dict/archive_raw)*100:.1f}%")
print(f"    Dictionary overhead: {dict_overhead_pct:.1f}% of archive")
print()

# Verify some DOTs
vr = verify(dict_dot)
print(f"  Dict DOT verified:   {vr.verified}")
vr2 = verify(dots[0])
print(f"  First DOT verified:  {vr2.verified}")
print()
print("  EXPERIMENT 10 COMPLETE")
print("=" * 65)
