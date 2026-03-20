"""
Experiment 15: File Splitting & Reconstruction
Split 1MB file into 256KB pieces, seal as DOTs, reconstruct.
"""

import sys
import os
import json
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open

results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(results_dir, exist_ok=True)

kp = crypto.generate_keypair(hashlib.sha256(b"file-split-exp15").digest())
TS_BASE = 1741564800_000_000
PIECE_SIZE = 256 * 1024  # 256 KB
TARGET_SIZE = 1024 * 1024  # 1 MB

# Generate 1MB of realistic content (varied sentences)
sentences = [
    "The universe is under no obligation to make sense to you.",
    "Knowledge is the antidote to fear.",
    "Mathematics is the language with which God has written the universe.",
    "In theory there is no difference between theory and practice.",
    "The computer was born to solve problems that did not exist before.",
    "Any sufficiently advanced technology is indistinguishable from magic.",
    "The best way to predict the future is to invent it.",
    "Information is the oil of the 21st century.",
    "The measure of intelligence is the ability to change.",
    "Science is what we understand well enough to explain to a computer.",
    "Simplicity is the soul of efficiency.",
    "Programs must be written for people to read, and only incidentally for machines to execute.",
    "The art of progress is to preserve order amid change and to preserve change amid order.",
    "First, solve the problem. Then, write the code.",
    "Truth is ever to be found in the simplicity, and not in the multiplicity of things.",
    "The whole of science is nothing more than a refinement of everyday thinking.",
    "An approximate answer to the right problem is worth a good deal more than an exact answer to an approximate problem.",
    "Every great advance in science has issued from a new audacity of imagination.",
    "The important thing is not to stop questioning.",
    "It does not matter how slowly you go as long as you do not stop.",
]

content = b""
while len(content) < TARGET_SIZE:
    for s in sentences:
        content += (s + " ").encode()
        if len(content) >= TARGET_SIZE:
            break
content = content[:TARGET_SIZE]

# Save test file
test_file_path = os.path.join(results_dir, "test_file_1mb.bin")
with open(test_file_path, "wb") as f:
    f.write(content)

original_sha256 = hashlib.sha256(content).hexdigest()

# Split into pieces
pieces = []
for i in range(0, len(content), PIECE_SIZE):
    pieces.append(content[i:i+PIECE_SIZE])

piece_hashes = [hashlib.sha256(p).hexdigest() for p in pieces]

# Create PIECE DOTs (type 0x0B)
piece_dots = []
for i, (piece, piece_hash) in enumerate(zip(pieces, piece_hashes)):
    d = create(
        payload=piece,
        keypair=kp,
        dot_type=0x0B,
        timestamp_us=TS_BASE + i * 1000,
    )
    piece_dots.append(d)

# Create ARCHIVE DOT (type 0x09) with manifest
archive_payload = json.dumps({
    "pieces": [
        {"index": i, "hash": piece_hashes[i], "size": len(pieces[i])}
        for i in range(len(pieces))
    ],
    "total_size": len(content),
    "original_sha256": original_sha256,
}).encode()

archive_dot = create(
    payload=archive_payload,
    keypair=kp,
    dot_type=0x09,
    timestamp_us=TS_BASE + len(pieces) * 1000,
)

# Delete original file (simulate)
os.unlink(test_file_path)

# Reconstruct
archive_result = dot_open(archive_dot)
manifest = json.loads(archive_result.payload)

reconstructed = b""
for piece_info in manifest["pieces"]:
    idx = piece_info["index"]
    piece_dot = piece_dots[idx]
    piece_result = dot_open(piece_dot)
    reconstructed += piece_result.payload

reconstructed_sha256 = hashlib.sha256(reconstructed).hexdigest()
reconstruction_valid = reconstructed_sha256 == original_sha256

# Stats
total_dot_size = sum(len(d) for d in piece_dots) + len(archive_dot)
overhead_pct = (total_dot_size - len(content)) / len(content) * 100

# Save reconstructed
with open(test_file_path, "wb") as f:
    f.write(reconstructed)

print("=" * 65)
print("  EXPERIMENT 15: FILE SPLITTING & RECONSTRUCTION")
print("=" * 65)
print()
print(f"  Original file:       {len(content):,} bytes (1 MB)")
print(f"  Piece size:          {PIECE_SIZE:,} bytes (256 KB)")
print(f"  Pieces:              {len(pieces)}")
print()
print(f"  DOT sizes:")
for i, d in enumerate(piece_dots):
    print(f"    Piece {i} DOT:       {len(d):,} bytes")
print(f"    Archive DOT:       {len(archive_dot):,} bytes")
print(f"    Total DOT size:    {total_dot_size:,} bytes")
print()
print(f"  Original SHA-256:    {original_sha256[:32]}...")
print(f"  Reconstructed SHA:   {reconstructed_sha256[:32]}...")
print(f"  Reconstruction valid: {reconstruction_valid}")
print()
print(f"  DOT overhead:        {overhead_pct:.2f}%")
print(f"  ({total_dot_size - len(content):,} bytes overhead for {len(pieces)} pieces + archive)")
print()
print("  EXPERIMENT 15 PASSED" if reconstruction_valid else "  EXPERIMENT 15 FAILED")
print("=" * 65)
