"""
Experiment 13: Knowledge Graph in DOTs
20 node DOTs + 30 relation DOTs. 4 graph queries.
"""

import sys
import os
import json
import hashlib
import time
from collections import defaultdict, deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

kp = crypto.generate_keypair(hashlib.sha256(b"graph-exp13").digest())
TS_BASE = 1741564800_000_000

# 20 nodes
nodes_data = [
    {"name": "Newton", "born": "1643", "domain": "physics", "contribution": "Classical mechanics, gravitation, calculus"},
    {"name": "Einstein", "born": "1879", "domain": "physics", "contribution": "Relativity, photoelectric effect, E=mc²"},
    {"name": "Sagan", "born": "1934", "domain": "astronomy", "contribution": "Cosmos, planetary science, SETI"},
    {"name": "Satoshi", "born": "unknown", "domain": "cryptography", "contribution": "Bitcoin, blockchain consensus"},
    {"name": "Turing", "born": "1912", "domain": "computing", "contribution": "Turing machine, computability theory, AI"},
    {"name": "Tesla", "born": "1856", "domain": "electrical", "contribution": "AC power, radio, induction motor"},
    {"name": "Marie Curie", "born": "1867", "domain": "physics", "contribution": "Radioactivity, polonium, radium"},
    {"name": "Darwin", "born": "1809", "domain": "biology", "contribution": "Evolution by natural selection"},
    {"name": "Aristotle", "born": "-384", "domain": "philosophy", "contribution": "Logic, ethics, natural philosophy"},
    {"name": "Leonardo da Vinci", "born": "1452", "domain": "engineering", "contribution": "Flying machines, anatomy, Renaissance art"},
    {"name": "Ada Lovelace", "born": "1815", "domain": "computing", "contribution": "First algorithm, Analytical Engine"},
    {"name": "Feynman", "born": "1918", "domain": "physics", "contribution": "Quantum electrodynamics, Feynman diagrams"},
    {"name": "Gödel", "born": "1906", "domain": "mathematics", "contribution": "Incompleteness theorems"},
    {"name": "Shannon", "born": "1916", "domain": "computing", "contribution": "Information theory, entropy"},
    {"name": "Mendel", "born": "1822", "domain": "biology", "contribution": "Laws of genetic inheritance"},
    {"name": "Pasteur", "born": "1822", "domain": "biology", "contribution": "Germ theory, vaccines, pasteurization"},
    {"name": "Archimedes", "born": "-287", "domain": "mathematics", "contribution": "Buoyancy, pi approximation, lever principle"},
    {"name": "Hawking", "born": "1942", "domain": "physics", "contribution": "Black hole radiation, Brief History of Time"},
    {"name": "Observer", "born": "2026", "domain": "meta", "contribution": "The act of recording this knowledge graph"},
    {"name": "DOT", "born": "2026", "domain": "protocol", "contribution": "Cryptographically sealed knowledge units"},
]

# Create node DOTs
node_dots = {}
node_hashes = {}
for i, node in enumerate(nodes_data):
    payload = json.dumps(node).encode()
    d = create(payload=payload, keypair=kp, dot_type=TYPE_OBSERVATION,
               timestamp_us=TS_BASE + i * 1000)
    node_dots[node["name"]] = d
    node_hashes[node["name"]] = hashlib.sha256(d).hexdigest()

# 30+ relations
relations_data = [
    ("Newton", "Einstein", "INFLUENCED"),
    ("Newton", "Feynman", "INFLUENCED"),
    ("Newton", "Hawking", "INFLUENCED"),
    ("Einstein", "Sagan", "INSPIRED"),
    ("Einstein", "Feynman", "INFLUENCED"),
    ("Einstein", "Hawking", "INFLUENCED"),
    ("Turing", "Shannon", "INFLUENCED"),
    ("Turing", "DOT", "INSPIRED"),
    ("Shannon", "DOT", "INSPIRED"),
    ("Satoshi", "DOT", "INSPIRED"),
    ("Observer", "DOT", "CREATED"),
    ("Sagan", "DOT", "INSPIRED"),
    ("Ada Lovelace", "Turing", "INFLUENCED"),
    ("Archimedes", "Newton", "INFLUENCED"),
    ("Archimedes", "Leonardo da Vinci", "INFLUENCED"),
    ("Aristotle", "Newton", "INFLUENCED"),
    ("Aristotle", "Darwin", "INFLUENCED"),
    ("Aristotle", "Archimedes", "INFLUENCED"),
    ("Darwin", "Mendel", "INFLUENCED"),
    ("Darwin", "Pasteur", "INFLUENCED"),
    ("Marie Curie", "Einstein", "INFLUENCED"),
    ("Tesla", "Shannon", "INFLUENCED"),
    ("Mendel", "DOT", "INSPIRED"),
    ("Gödel", "Turing", "INFLUENCED"),
    ("Gödel", "Shannon", "INFLUENCED"),
    ("Pasteur", "DOT", "INSPIRED"),
    ("Hawking", "Sagan", "INFLUENCED"),
    ("Feynman", "DOT", "INSPIRED"),
    ("Leonardo da Vinci", "Tesla", "INSPIRED"),
    ("Archimedes", "DOT", "INSPIRED"),
]

# Create relation DOTs
rel_dots = []
for i, (from_name, to_name, rel_type) in enumerate(relations_data):
    payload = json.dumps({
        "from": node_hashes[from_name],
        "from_name": from_name,
        "to": node_hashes[to_name],
        "to_name": to_name,
        "type": rel_type,
    }).encode()
    d = create(payload=payload, keypair=kp, dot_type=0x0A,
               timestamp_us=TS_BASE + (len(nodes_data) + i) * 1000)
    rel_dots.append((from_name, to_name, rel_type, d))

all_dots = list(node_dots.values()) + [r[3] for r in rel_dots]

# Build in-memory graph for queries
graph_out = defaultdict(list)  # name → [(to_name, rel_type)]
graph_in = defaultdict(list)   # name → [(from_name, rel_type)]
for from_name, to_name, rel_type, _ in rel_dots:
    graph_out[from_name].append((to_name, rel_type))
    graph_in[to_name].append((from_name, rel_type))

# Query A: Find all nodes with domain "physics"
t0 = time.perf_counter()
physics_nodes = [n["name"] for n in nodes_data if n["domain"] == "physics"]
qa_ms = (time.perf_counter() - t0) * 1000

# Query B: All nodes influenced by Newton (1-hop INFLUENCED edges)
t0 = time.perf_counter()
influenced_by_newton = [to for to, rel in graph_out["Newton"] if rel == "INFLUENCED"]
qb_ms = (time.perf_counter() - t0) * 1000

# Query C: Shortest path from Archimedes to DOT (BFS)
t0 = time.perf_counter()
def bfs_path(start, end, graph, max_hops=5):
    queue = deque([(start, [start])])
    visited = {start}
    while queue:
        node, path = queue.popleft()
        if len(path) > max_hops + 1:
            return None
        for neighbor, _ in graph.get(node, []):
            if neighbor == end:
                return path + [neighbor]
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor]))
    return None

path = bfs_path("Archimedes", "DOT", graph_out)
qc_ms = (time.perf_counter() - t0) * 1000

# Query D: All nodes connected to DOT within 2 hops
t0 = time.perf_counter()
def neighbors_within_hops(start, graph_in, max_hops=2):
    visited = {start}
    frontier = {start}
    for _ in range(max_hops):
        next_frontier = set()
        for node in frontier:
            for from_name, _ in graph_in.get(node, []):
                if from_name not in visited:
                    next_frontier.add(from_name)
                    visited.add(from_name)
        frontier = next_frontier
    visited.discard(start)
    return sorted(visited)

connected_to_dot = neighbors_within_hops("DOT", graph_in, max_hops=2)
qd_ms = (time.perf_counter() - t0) * 1000

# Verify all DOTs
t0 = time.perf_counter()
verified_count = sum(1 for d in all_dots if verify(d).verified)
verify_ms = (time.perf_counter() - t0) * 1000

total_bytes = sum(len(d) for d in all_dots)
avg_node_size = sum(len(d) for d in node_dots.values()) // len(node_dots)
avg_rel_size = sum(len(r[3]) for r in rel_dots) // len(rel_dots)

print("=" * 70)
print("  EXPERIMENT 13: KNOWLEDGE GRAPH IN DOTS")
print("=" * 70)
print()
print(f"  Graph:             {len(nodes_data)} nodes + {len(relations_data)} relations = {len(all_dots)} DOTs")
print(f"  Total size:        {total_bytes:,} bytes ({total_bytes/1024:.1f} KB)")
print(f"  Avg node DOT:      {avg_node_size} bytes")
print(f"  Avg relation DOT:  {avg_rel_size} bytes")
print(f"  All verified:      {verified_count}/{len(all_dots)} ({verify_ms:.1f} ms)")
print()
print(f"  QUERY RESULTS:")
print(f"  A) Physics domain nodes ({qa_ms*1000:.0f} µs):")
print(f"     {physics_nodes}")
print()
print(f"  B) Influenced by Newton ({qb_ms*1000:.0f} µs):")
print(f"     {influenced_by_newton}")
print()
print(f"  C) Archimedes → DOT path ({qc_ms*1000:.0f} µs):")
print(f"     {' → '.join(path) if path else 'No path found'}")
print(f"     ({len(path)-1 if path else '?'} hops)")
print()
print(f"  D) Connected to DOT within 2 hops ({qd_ms*1000:.0f} µs):")
print(f"     {connected_to_dot}")
print(f"     ({len(connected_to_dot)} nodes)")
print()
all_verified = verified_count == len(all_dots)
print("  EXPERIMENT 13 PASSED" if all_verified else "  EXPERIMENT 13 FAILED — verification issues")
print("=" * 70)
