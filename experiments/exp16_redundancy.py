"""
Experiment 16: Redundancy & Partial Recovery
512KB file, 8 pieces of 64KB, 3x replication, remove 30%, reconstruct.
"""

import sys
import os
import json
import hashlib
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, open as dot_open

kp = crypto.generate_keypair(hashlib.sha256(b"redundancy-exp16").digest())
TS_BASE = 1741564800_000_000

PIECE_SIZE = 64 * 1024   # 64 KB
N_PIECES = 8             # 8 pieces = 512 KB
REPLICAS = 3             # 3x replication
REMOVE_PCT = 0.30        # Remove 30% of DOTs

# Generate 512KB content
sentences = [
    "Redundancy is the art of having a backup when the primary fails.",
    "In distributed systems, assume everything will fail eventually.",
    "The only truly secure system is one that is powered off, cast in concrete.",
    "Data durability requires thinking about failure at every level.",
    "Three copies on two media with one offsite is the minimum for durability.",
]
content = b""
while len(content) < N_PIECES * PIECE_SIZE:
    for s in sentences:
        content += (s + " ").encode()
content = content[:N_PIECES * PIECE_SIZE]

original_sha256 = hashlib.sha256(content).hexdigest()

# Split into pieces
pieces = [content[i:i+PIECE_SIZE] for i in range(0, len(content), PIECE_SIZE)]

# Create 3x replication: 24 DOTs total
all_dots = {}  # (piece_idx, copy_idx) → dot_bytes
for piece_idx, piece in enumerate(pieces):
    for copy_idx in range(REPLICAS):
        d = create(
            payload=piece,
            keypair=kp,
            dot_type=0x0B,
            timestamp_us=TS_BASE + piece_idx * 3000 + copy_idx * 1000,
        )
        all_dots[(piece_idx, copy_idx)] = d

total_dots = len(all_dots)
print(f"  Created {total_dots} DOTs ({N_PIECES} pieces × {REPLICAS} replicas)")

# Remove 30% randomly
random.seed(42)
dot_keys = list(all_dots.keys())
n_remove = int(total_dots * REMOVE_PCT)
remove_keys = set(random.sample(dot_keys, n_remove))
surviving_dots = {k: v for k, v in all_dots.items() if k not in remove_keys}

# Check which pieces are recoverable (at least 1 copy remains)
recoverable_pieces = set()
for piece_idx in range(N_PIECES):
    for copy_idx in range(REPLICAS):
        if (piece_idx, copy_idx) in surviving_dots:
            recoverable_pieces.add(piece_idx)
            break

# Reconstruct
reconstructed_pieces = {}
for piece_idx in sorted(recoverable_pieces):
    for copy_idx in range(REPLICAS):
        key = (piece_idx, copy_idx)
        if key in surviving_dots:
            result = dot_open(surviving_dots[key])
            reconstructed_pieces[piece_idx] = result.payload
            break

success = len(reconstructed_pieces) == N_PIECES
if success:
    reconstructed = b"".join(reconstructed_pieces[i] for i in range(N_PIECES))
    reconstruction_valid = hashlib.sha256(reconstructed).hexdigest() == original_sha256
else:
    reconstruction_valid = False

# Which pieces were lost?
lost_pieces = set(range(N_PIECES)) - recoverable_pieces

print("=" * 65)
print("  EXPERIMENT 16: REDUNDANCY & PARTIAL RECOVERY")
print("=" * 65)
print()
print(f"  File size:           {len(content):,} bytes (512 KB)")
print(f"  Piece size:          {PIECE_SIZE:,} bytes (64 KB)")
print(f"  Pieces:              {N_PIECES}")
print(f"  Replication factor:  {REPLICAS}x")
print(f"  Total DOTs:          {total_dots}")
print()
print(f"  REMOVAL TEST:")
print(f"    DOTs removed:      {n_remove} ({REMOVE_PCT*100:.0f}%)")
print(f"    DOTs surviving:    {len(surviving_dots)}")
print()
print(f"  RECOVERY:")
print(f"    Lost pieces:       {sorted(lost_pieces) if lost_pieces else 'none'}")
print(f"    Recoverable:       {len(recoverable_pieces)}/{N_PIECES}")
print(f"    Full recovery:     {success}")
print(f"    SHA-256 matches:   {reconstruction_valid}")
print()

# Show per-piece status
print(f"  Piece status (P=piece, C=copy, ✓=survived, ✗=removed):")
for piece_idx in range(N_PIECES):
    status = ""
    for copy_idx in range(REPLICAS):
        key = (piece_idx, copy_idx)
        if key in remove_keys:
            status += "✗"
        else:
            status += "✓"
    recovered = "✅" if piece_idx in recoverable_pieces else "❌ LOST"
    print(f"    Piece {piece_idx}: [{status}] {recovered}")
print()
print(f"  Minimum copies needed: 1 (any single surviving copy suffices)")
print(f"  With {REPLICAS}x replication, can survive loss of {REPLICAS-1} copies per piece")
print()
print("  EXPERIMENT 16 PASSED" if reconstruction_valid else "  EXPERIMENT 16 FAILED")
print("=" * 65)
