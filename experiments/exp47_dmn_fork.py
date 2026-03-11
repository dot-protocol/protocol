"""
EXP-47: DMN SUPPRESSION ↔ FORK REDUCTION
Model brain as DOT graph: 100 nodes, 15 DMN nodes generate spontaneous forks.
Measure chain coherence in normal vs psilocybin mode.
"""

import sys, os, random, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

N_NODES = 100
DMN_NODES = list(range(15))     # nodes 0-14 are DMN
CORTICAL_NODES = list(range(15, 100))  # nodes 15-99 are cortical

STEPS = 50
NORMAL_FORKS_PER_STEP = 5      # DMN generates 5 forks/step
PSILOCYBIN_FORKS_PER_STEP = 1  # 80% reduction

print("=" * 65)
print("  EXPERIMENT 47: DMN SUPPRESSION ↔ FORK REDUCTION")
print("=" * 65)
print()
print(f"Nodes: {N_NODES} (15 DMN + 85 cortical)")
print(f"Steps: {STEPS}")
print()

def node_hash(node_id, step, prev):
    return hashlib.sha256(f"{node_id}:{step}:{prev}".encode()).hexdigest()[:16]

def run_mode(dmn_forks_per_step, rng_seed=42):
    rng = random.Random(rng_seed)

    # Each node maintains a list of chain heads (hash strings)
    # Main chain: all cortical nodes contribute sequentially
    # Forks: DMN nodes create random new chain heads

    # Track: total DOTs, main chain DOTs, forked chains, distinct heads
    node_heads = {i: f"genesis-{i}" for i in range(N_NODES)}
    main_chain = [f"main-genesis"]
    fork_heads = set()  # Set of heads that diverged from main

    total_dots = N_NODES  # start: 1 genesis per node

    for step in range(1, STEPS + 1):
        # Main chain: all cortical nodes contribute one DOT chained to main
        for node in CORTICAL_NODES:
            new_h = node_hash(node, step, main_chain[-1])
            main_chain.append(new_h)
            node_heads[node] = new_h
            total_dots += 1

        # DMN: generates spontaneous forks (new chain heads not linked to main)
        dmn_nodes_forking = rng.sample(DMN_NODES, min(dmn_forks_per_step, len(DMN_NODES)))
        for node in dmn_nodes_forking:
            fork_seed = f"fork-{node}-{step}-{rng.random()}"
            new_h = hashlib.sha256(fork_seed.encode()).hexdigest()[:16]
            fork_heads.add(new_h)
            node_heads[node] = new_h  # DMN node now points to fork
            total_dots += 1

        # DMN nodes that didn't fork: rejoin main chain
        non_forking = [n for n in DMN_NODES if n not in dmn_nodes_forking]
        for node in non_forking:
            new_h = node_hash(node, step, main_chain[-1])
            main_chain.append(new_h)
            node_heads[node] = new_h
            total_dots += 1

    main_chain_dots = len(main_chain) - 1  # exclude genesis
    # Count forked chains: unique fork heads that are NOT in main chain
    forked_chain_count = len(fork_heads)
    coherence = main_chain_dots / total_dots if total_dots > 0 else 0

    # Graph entropy: distinct heads / total nodes
    # Distinct heads = main chain tip + all fork tips still active
    # Active fork tips: each fork creates one head (simplified)
    distinct_heads = 1 + forked_chain_count  # 1 for main
    entropy = distinct_heads / N_NODES

    return {
        "total_dots": total_dots,
        "main_chain_dots": main_chain_dots,
        "forked_chains": forked_chain_count,
        "coherence": coherence,
        "entropy": entropy,
        "distinct_heads": distinct_heads,
    }


normal = run_mode(NORMAL_FORKS_PER_STEP, rng_seed=42)
psilocybin = run_mode(PSILOCYBIN_FORKS_PER_STEP, rng_seed=42)

coherence_increase = ((psilocybin["coherence"] - normal["coherence"]) / normal["coherence"]) * 100

print("NORMAL MODE (DMN active, 5 forks/step):")
print(f"Total DOTs: {normal['total_dots']}")
print(f"Main chain DOTs: {normal['main_chain_dots']}")
print(f"Forked chains: {normal['forked_chains']}")
print(f"Chain coherence: {normal['coherence']:.3f} ({normal['coherence']*100:.1f}%)")
print(f"Graph entropy: {normal['entropy']:.3f} distinct heads / {N_NODES} nodes")
print()

print("PSILOCYBIN MODE (DMN suppressed, 1 fork/step):")
print(f"Total DOTs: {psilocybin['total_dots']}")
print(f"Main chain DOTs: {psilocybin['main_chain_dots']}")
print(f"Forked chains: {psilocybin['forked_chains']}")
print(f"Chain coherence: {psilocybin['coherence']:.3f} ({psilocybin['coherence']*100:.1f}%)")
print(f"Graph entropy: {psilocybin['entropy']:.3f} distinct heads / {N_NODES} nodes")
print()

print(f"COHERENCE INCREASE (psilocybin vs normal): +{coherence_increase:.1f}%")
print()

psilocybin_better = psilocybin["coherence"] > normal["coherence"]
print(f"CONCLUSION: DMN suppression {'DOES' if psilocybin_better else 'DOES NOT'} measurably increase chain coherence")
print()

if psilocybin_better:
    print("EXPERIMENT 47 PASSED")
else:
    print("EXPERIMENT 47 FAILED")
print("=" * 65)
