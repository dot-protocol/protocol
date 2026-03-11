"""
EXP-42: FRACTAL NETWORK TOPOLOGY
Build 3 graphs, measure small-world properties.
No networkx — implement BFS + clustering manually.
"""

import sys, os, random, math, hashlib
from collections import deque, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

# ─── Graph primitives ────────────────────────────────────────────────────────

def bfs_all_pairs_avg(adj, N):
    """Average shortest path over all connected pairs via BFS."""
    total, count = 0, 0
    for src in range(N):
        dist = [-1] * N
        dist[src] = 0
        q = deque([src])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if dist[v] == -1:
                    dist[v] = dist[u] + 1
                    q.append(v)
        for v in range(N):
            if v != src and dist[v] > 0:
                total += dist[v]
                count += 1
    return total / count if count else float('inf')


def clustering_coefficient(adj, N):
    """Global clustering coefficient (average over nodes with degree>=2)."""
    total_cc = 0.0
    counted = 0
    for u in range(N):
        nbrs = adj[u]
        k = len(nbrs)
        if k < 2:
            continue
        # count edges among neighbors
        nbr_set = set(nbrs)
        triangles = sum(1 for v in nbrs for w in adj[v] if w in nbr_set and w != u)
        triangles //= 2  # each edge counted twice
        possible = k * (k - 1) // 2
        total_cc += triangles / possible if possible else 0
        counted += 1
    return total_cc / counted if counted else 0.0


def avg_degree(adj, N):
    return sum(len(adj[i]) for i in range(N)) / N


def small_world_metrics(adj, N, label):
    k = avg_degree(adj, N)
    C = clustering_coefficient(adj, N)
    L = bfs_all_pairs_avg(adj, N)

    C_rand = k / N
    L_rand = math.log(N) / math.log(max(k, 2)) if k > 1 else float('inf')

    C_ratio = C / C_rand if C_rand > 0 else float('inf')
    L_ratio = L / L_rand if L_rand > 0 else float('inf')

    sigma = (C / C_rand) / (L / L_rand) if (C_rand > 0 and L_rand > 0 and L_rand != float('inf')) else 0.0
    edges = sum(len(adj[i]) for i in range(N)) // 2

    print(f"GRAPH {label}:")
    print(f"  Nodes: {N}  Edges: {edges}  Avg degree: {k:.1f}")
    print(f"  Clustering C: {C:.3f}  (random C_rand: {C_rand:.3f})  ratio: {C_ratio:.1f}x")
    print(f"  Avg path L: {L:.2f}  (random L_rand: {L_rand:.2f})  ratio: {L_ratio:.2f}x")
    sigma_pass = sigma > 1.0
    print(f"  Small-world σ: {sigma:.2f}  [{'PASS' if sigma_pass else 'FAIL'}: σ > 1?]")
    print()
    return sigma_pass


# ─── (a) DOT chain graph ─────────────────────────────────────────────────────
# Simulate 27 DOT experiments as nodes; edges = dependency/reference relationships.
# We model edges based on: chain deps (each exp refs prev), cross-refs (semantic groups).

def build_dot_chain_graph():
    N = 27  # EXP-01 through EXP-27
    adj = defaultdict(set)

    def add_edge(u, v):
        adj[u].add(v)
        adj[v].add(u)

    # Sequential chain edges (backbone)
    for i in range(N - 1):
        add_edge(i, i + 1)

    # Cross-reference clusters (thematic groups from actual experiments)
    # Integrity cluster: 0,1,2,3,13,28 (index 0-based)
    integrity = [0, 1, 2, 3, 13]
    for i in range(len(integrity)):
        for j in range(i + 1, len(integrity)):
            add_edge(integrity[i], integrity[j])

    # Compression cluster: 7, 8, 9, 20, 21, 25, 26
    compression = [7, 8, 9, 20, 21, 25, 26]
    for i in range(len(compression)):
        for j in range(i + 1, len(compression)):
            if compression[i] < N and compression[j] < N:
                add_edge(compression[i], compression[j])

    # Graph/chain cluster: 5, 6, 12, 13, 14
    graph_cl = [5, 6, 12, 13, 14]
    for i in range(len(graph_cl)):
        for j in range(i + 1, len(graph_cl)):
            add_edge(graph_cl[i], graph_cl[j])

    # Security cluster: 15, 16, 28 => 15, 16 only (N=27, max index 26)
    security = [15, 16, 22, 23, 24]
    for i in range(len(security)):
        for j in range(i + 1, len(security)):
            if security[i] < N and security[j] < N:
                add_edge(security[i], security[j])

    # Hub: exp-07 (multi-observer, node 6) connects to many
    hub = 6
    for target in [0, 4, 11, 18, 22]:
        if target < N:
            add_edge(hub, target)

    # Convert to lists
    adj_list = [sorted(adj[i]) for i in range(N)]
    return adj_list, N


# ─── (b) Neural network — Barabási–Albert m=2 ───────────────────────────────

def build_ba_graph(N=86, m=2, seed=42):
    random.seed(seed)
    adj = defaultdict(set)

    def add_edge(u, v):
        if u != v:
            adj[u].add(v)
            adj[v].add(u)

    # Start with small complete graph
    for i in range(m + 1):
        for j in range(i + 1, m + 1):
            add_edge(i, j)

    # Preferential attachment
    for new_node in range(m + 1, N):
        # Build degree list for preferential attachment
        targets = set()
        degree_list = []
        for node in range(new_node):
            degree_list.extend([node] * max(len(adj[node]), 1))

        attempts = 0
        while len(targets) < m and attempts < 10000:
            chosen = random.choice(degree_list)
            targets.add(chosen)
            attempts += 1

        for t in targets:
            add_edge(new_node, t)

    adj_list = [sorted(adj[i]) for i in range(N)]
    return adj_list, N


# ─── (c) Cosmic web — filament structure ─────────────────────────────────────

def build_cosmic_graph(N=100, seed=123):
    random.seed(seed)

    # 3D positions — filaments: nodes cluster along lines in 3D space
    positions = []
    # 3 main filaments (30 nodes each) + 10 scattered
    for fil in range(3):
        # filament direction
        dx, dy, dz = random.uniform(-1,1), random.uniform(-1,1), random.uniform(-1,1)
        norm = (dx**2+dy**2+dz**2)**0.5
        dx, dy, dz = dx/norm, dy/norm, dz/norm
        ox, oy, oz = random.uniform(0,10), random.uniform(0,10), random.uniform(0,10)
        for i in range(30):
            t = i * 0.4 + random.gauss(0, 0.15)
            positions.append((ox + dx*t, oy + dy*t, oz + dz*t))

    # 10 scattered
    for _ in range(10):
        positions.append((random.uniform(0,12), random.uniform(0,12), random.uniform(0,12)))

    # Find threshold that gives ~3 edges/node on average
    # Compute all distances
    all_dists = []
    for i in range(N):
        for j in range(i+1, N):
            dx = positions[i][0]-positions[j][0]
            dy = positions[i][1]-positions[j][1]
            dz = positions[i][2]-positions[j][2]
            all_dists.append(((i,j), (dx**2+dy**2+dz**2)**0.5))

    all_dists.sort(key=lambda x: x[1])

    # Target: ~3 edges/node = 3*N/2 total edges
    target_edges = 3 * N // 2
    threshold = all_dists[min(target_edges-1, len(all_dists)-1)][1]

    adj = defaultdict(set)
    for (i,j), dist in all_dists:
        if dist <= threshold:
            adj[i].add(j)
            adj[j].add(i)

    adj_list = [sorted(adj[i]) for i in range(N)]
    return adj_list, N


# ─── Main ────────────────────────────────────────────────────────────────────

print("=" * 65)
print("  EXPERIMENT 42: FRACTAL NETWORK TOPOLOGY")
print("=" * 65)
print()

adj_a, N_a = build_dot_chain_graph()
pass_a = small_world_metrics(adj_a, N_a, "(a) DOT Chain")

adj_b, N_b = build_ba_graph()
pass_b = small_world_metrics(adj_b, N_b, "(b) Neural Network (BA model)")

adj_c, N_c = build_cosmic_graph()
pass_c = small_world_metrics(adj_c, N_c, "(c) Cosmic Web (filament)")

passes = sum([pass_a, pass_b, pass_c])
print(f"VERDICT: {passes}/3 graphs show small-world properties")
print()

if passes == 3:
    print("EXPERIMENT 42 PASSED")
else:
    print(f"EXPERIMENT 42 PARTIAL ({passes}/3 passed)")
print("=" * 65)
