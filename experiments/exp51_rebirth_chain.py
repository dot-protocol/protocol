"""
EXP-51: DECOMPOSITION-REBIRTH CHAIN
Model the cycle: tree → leaf → worm → soil → seed → new_tree.
A carbon atom passes through each stage as a DOT.
"""

import sys, os, json, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, chain as chain_dot, open as open_dot, TYPE_OBSERVATION

print("=" * 65)
print("  EXPERIMENT 51: DECOMPOSITION-REBIRTH CHAIN")
print("=" * 65)
print()

# Stable atom identifier
atom_id_full = hashlib.sha256(b"carbon-atom-12-C").hexdigest()
atom_id = atom_id_full[:16]

print(f"Atom ID: {atom_id} (SHA-256 of \"carbon-atom-12-C\", first 16 chars)")
print()

# Single "nature" observer keypair
seed = hashlib.sha256(b"nature-observer-cycle-of-life").digest()
kp = crypto.generate_keypair(seed)

# 6 stages
stages = [
    ("tree",    "photosynthesis",            1_000_000_000_000_000),   # deep past
    ("leaf",    "photosynthesis→fall",        1_100_000_000_000_000),
    ("worm",    "decomposition→ingestion",    1_200_000_000_000_000),
    ("soil",    "worm-castings→mineralization", 1_300_000_000_000_000),
    ("seed",    "soil-uptake→germination",    1_400_000_000_000_000),
    ("newtree", "germination→growth",         1_500_000_000_000_000),
]

chain_dots = []
prev_dot = None

for i, (stage, process, ts_us) in enumerate(stages):
    if stage == "newtree" and chain_dots:
        # Cycle closure: reference original tree's hash in payload
        original_tree_hash = hashlib.sha256(chain_dots[0]).hexdigest()[:16]
        payload = json.dumps({
            "atom": atom_id,
            "stage": stage,
            "process": process,
            "cycle_closes_at": original_tree_hash,
        }).encode("utf-8")
    else:
        payload = json.dumps({
            "atom": atom_id,
            "stage": stage,
            "process": process,
        }).encode("utf-8")

    if prev_dot is None:
        # Genesis: original tree (no parent)
        dot_bytes = create(
            payload=payload,
            keypair=kp,
            dot_type=TYPE_OBSERVATION,
            timestamp_us=ts_us,
        )
    else:
        dot_bytes = chain_dot(
            payload=payload,
            keypair=kp,
            parent_dot_bytes=prev_dot,
            dot_type=TYPE_OBSERVATION,
            timestamp_us=ts_us,
        )

    chain_dots.append(dot_bytes)
    prev_dot = dot_bytes

# Verify full chain
all_valid = True
for dot_bytes in chain_dots:
    r = verify(dot_bytes)
    if not r.verified:
        all_valid = False
        break

# Check atom_id in all 6 DOTs
atom_in_all = True
for i, dot_bytes in enumerate(chain_dots):
    dr = open_dot(dot_bytes)
    decoded = json.loads(dr.payload.decode("utf-8"))
    if decoded.get("atom") != atom_id:
        atom_in_all = False
        print(f"  MISSING atom in stage {i}: {decoded}")
        break

# Check cycle closure: newtree references original tree hash
original_hash_16 = hashlib.sha256(chain_dots[0]).hexdigest()[:16]
newtree_dr = open_dot(chain_dots[-1])
newtree_payload = json.loads(newtree_dr.payload.decode("utf-8"))
cycle_closed = newtree_payload.get("cycle_closes_at") == original_hash_16

# Print chain
print(f"CHAIN (outer ring → inner):")
stage_labels = ["TREE", "LEAF", "WORM", "SOIL", "SEED", "NEWTREE"]
for i, (dot_bytes, label) in enumerate(zip(chain_dots, stage_labels)):
    dr = open_dot(dot_bytes)
    dot_hash_16 = dr.dot_hash_hex[:16]
    parent_hash_16 = dr.parent_hash_hex[:16] if dr.parent_hash_hex else "NONE    "
    decoded = json.loads(dr.payload.decode("utf-8"))

    # Build compact payload repr
    if label == "NEWTREE":
        payload_repr = f"{{atom:{atom_id}, cycle_closes_at:{decoded['cycle_closes_at']}}}"
    else:
        payload_repr = f"{{atom:{atom_id}, stage:{decoded['stage']}}}"

    parent_label = stage_labels[i-1] if i > 0 else "NONE"
    print(f"  [{i+1}] {label:<7} hash: {dot_hash_16}  parent: {parent_hash_16} ({parent_label:<7}) payload: {payload_repr}")

print()
iso_ok = all_valid and atom_in_all and cycle_closed

print(f"Chain verification: all 6 valid? {'YES' if all_valid else 'NO'}")
print(f"Atom continuity: atom_id present in all 6 DOTs? {'YES' if atom_in_all else 'NO'}")
print(f"Cycle closure: new_tree references original tree hash? {'YES' if cycle_closed else 'NO'}")
print()
print(f"ISOMORPHISM: atomic identity persists through death and rebirth: {'YES' if iso_ok else 'NO'}")
print()

if iso_ok:
    print("EXPERIMENT 51 PASSED")
else:
    print("EXPERIMENT 51 FAILED")
print("=" * 65)
