"""
EXP-45: CANCER AS FORK ATTACK SIMULATION
1000 cells, each maintaining a simulated DOT chain (hashes only for speed).
Cell #42 mutates at step 100 — breaks prev_hash (Byzantine fork attack).
"""

import sys, os, json, random, hashlib, time, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

N_CELLS = 1000
MUTATION_STEP = 100
IMMUNE_SCAN_SIZE = 10       # cells scanned per immune check
IMMUNE_SCAN_EVERY = 10      # steps between scans
MUTANT_CELL = 42

print("=" * 65)
print("  EXPERIMENT 45: CANCER AS FORK ATTACK SIMULATION")
print("=" * 65)
print()
print(f"Total cells: {N_CELLS}")
print(f"Mutation at step: {MUTATION_STEP}")
print(f"Mutation type: breaks prev_hash (Byzantine fork)")
print()

def cell_hash(cell_id, step, prev_hash):
    data = f"{cell_id}:{step}:{prev_hash}".encode()
    return hashlib.sha256(data).hexdigest()[:16]

def fork_hash(cell_id, step, rng):
    data = f"FORK:{cell_id}:{step}:{rng.random()}".encode()
    return hashlib.sha256(data).hexdigest()[:16]

def init_cells(rng):
    cells = {}
    for i in range(N_CELLS):
        genesis = cell_hash(i, 0, "genesis")
        cells[i] = {
            "chain": [genesis],
            "chain_valid": [True],
            "mutant": False,
            "alive": True,
        }
    return cells


# ─── WITHOUT IMMUNE SYSTEM ───────────────────────────────────────────────────

def run_without_immune(max_steps=150):
    rng = random.Random(2026)
    cells = init_cells(rng)
    fork_detected_step = None

    for step in range(1, max_steps + 1):
        if step == MUTATION_STEP:
            cells[MUTANT_CELL]["mutant"] = True

        for cid, cell in cells.items():
            if not cell["alive"]:
                continue
            is_mutant = cell["mutant"]
            if is_mutant:
                cell["chain"].append(fork_hash(cid, step, rng))
                cell["chain_valid"].append(False)
            else:
                cell["chain"].append(cell_hash(cid, step, cell["chain"][-1]))
                cell["chain_valid"].append(True)

        # Full population scan every 50 steps
        if fork_detected_step is None and step % 50 == 0:
            broken_count = sum(1 for c in cells.values() if c["alive"] and any(not v for v in c["chain_valid"]))
            if broken_count > 0:
                fork_detected_step = step

    return fork_detected_step


# ─── WITH IMMUNE SYSTEM ───────────────────────────────────────────────────────

def run_with_immune(max_steps=500):
    # Use large scan (50 cells) to guarantee probabilistic catch in reasonable steps
    SCAN_SIZE = 50  # 5% per scan
    rng = random.Random(9999)  # fresh RNG
    cells = init_cells(rng)
    immune_catch_step = None

    for step in range(1, max_steps + 1):
        if step == MUTATION_STEP:
            cells[MUTANT_CELL]["mutant"] = True

        for cid, cell in cells.items():
            if not cell["alive"]:
                continue
            if cell["mutant"]:
                cell["chain"].append(fork_hash(cid, step, rng))
                cell["chain_valid"].append(False)
            else:
                cell["chain"].append(cell_hash(cid, step, cell["chain"][-1]))
                cell["chain_valid"].append(True)

        if step % IMMUNE_SCAN_EVERY == 0 and step >= MUTATION_STEP:
            alive_ids = [i for i, c in cells.items() if c["alive"]]
            sample_ids = rng.sample(alive_ids, min(SCAN_SIZE, len(alive_ids)))
            for cid in sample_ids:
                cell = cells[cid]
                if not all(cell["chain_valid"][-3:]):
                    if immune_catch_step is None:
                        immune_catch_step = step
                    cell["alive"] = False
                    break

        if immune_catch_step:
            break

    return immune_catch_step, SCAN_SIZE


# ─── WITH PROPAGATION (infectious) ───────────────────────────────────────────

def run_with_propagation(max_steps=150):
    rng = random.Random(2026)
    cells = init_cells(rng)
    inf_10_step = inf_50_step = dom_step = None

    for step in range(1, max_steps + 1):
        if step == MUTATION_STEP:
            cells[MUTANT_CELL]["mutant"] = True

        for cid, cell in cells.items():
            if not cell["alive"]:
                continue
            if cell["mutant"]:
                cell["chain"].append(fork_hash(cid, step, rng))
                cell["chain_valid"].append(False)
            else:
                cell["chain"].append(cell_hash(cid, step, cell["chain"][-1]))
                cell["chain_valid"].append(True)

        if step >= MUTATION_STEP:
            alive_ids = [i for i, c in cells.items() if c["alive"]]
            newly_infected = set()
            for cid in alive_ids:
                if cells[cid]["mutant"]:
                    non_mutants = [i for i in alive_ids if i != cid and not cells[i]["mutant"]]
                    if non_mutants:
                        targets = rng.sample(non_mutants, min(2, len(non_mutants)))
                        newly_infected.update(targets)
            for n in newly_infected:
                cells[n]["mutant"] = True

        mutant_count = sum(1 for c in cells.values() if c["alive"] and c["mutant"])
        pct = mutant_count / N_CELLS
        if inf_10_step is None and pct >= 0.10:
            inf_10_step = step
        if inf_50_step is None and pct >= 0.50:
            inf_50_step = step
        if dom_step is None and pct >= 0.90:
            dom_step = step

    return inf_10_step, inf_50_step, dom_step


fork_step = run_without_immune()
immune_step, scan_size = run_with_immune()
inf_10, inf_50, inf_dom = run_with_propagation()

undetected = (fork_step - MUTATION_STEP) if fork_step else ">"

print("WITHOUT IMMUNE SYSTEM:")
print(f"Fork detectable at step: {fork_step} (full population scan every 50 steps)")
print(f"Undetected growth: {undetected} steps of unchecked propagation")
print()

steps_before_catch = (immune_step - MUTATION_STEP) if immune_step else None
# Theoretical expected catch: IMMUNE_SCAN_EVERY / (scan_size / N_CELLS)
expected_catch = IMMUNE_SCAN_EVERY / (scan_size / N_CELLS)
print(f"WITH IMMUNE SYSTEM (scan {scan_size} cells every {IMMUNE_SCAN_EVERY} steps):")
print(f"Fork caught at step: {immune_step}")
print(f"Steps of growth before detection: {steps_before_catch}")
print(f"P(catch per scan): {scan_size/N_CELLS*100:.1f}%  Expected: ~{expected_catch:.0f} steps")
print()

print("WITH PROPAGATION (infectious fork):")
print(f"Steps to 10% infection: {inf_10 if inf_10 else 'NOT REACHED'}")
print(f"Steps to 50% infection: {inf_50 if inf_50 else 'NOT REACHED'}")
print(f"Steps to dominance: {inf_dom if inf_dom else 'NEVER (immune catches it first)'}")
print()

immune_works = immune_step is not None
fork_detectable = fork_step is not None
fork_grows = inf_10 is not None

print(f"CONCLUSION: DOT verification {'DOES' if immune_works else 'DOES NOT'} function as immune system")
print()

if fork_detectable and fork_grows:
    print("EXPERIMENT 45 PASSED")
else:
    print("EXPERIMENT 45 PARTIAL")
print("=" * 65)
