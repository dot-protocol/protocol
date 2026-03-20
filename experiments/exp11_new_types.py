"""
Experiment 11: New DOT Types
Test 8 extended DOT type bytes. All should seal and verify correctly.
"""

import sys
import os
import json
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify

# Extended types (raw values, library doesn't define 0x08+)
TYPE_DICTIONARY    = 0x05  # reuse raw value
TYPE_REFERENCE     = 0x06
TYPE_DELTA         = 0x07
TYPE_TREE          = 0x08
TYPE_ARCHIVE       = 0x09
TYPE_RELATION      = 0x0A
TYPE_PIECE         = 0x0B
TYPE_STORAGE_PROOF = 0x0C

TYPE_NAMES_EXT = {
    0x05: "DICTIONARY",
    0x06: "REFERENCE",
    0x07: "DELTA",
    0x08: "TREE",
    0x09: "ARCHIVE",
    0x0A: "RELATION",
    0x0B: "PIECE",
    0x0C: "STORAGE_PROOF",
}

kp = crypto.generate_keypair(hashlib.sha256(b"new-types-exp11").digest())
TS = 1741564800_000_000

test_cases = [
    (TYPE_DICTIONARY, {
        "entries": {"0001": "is a city", "0002": "was born"},
        "version": 1
    }),
    (TYPE_REFERENCE, {
        "target_hash": "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        "description": "points to observation about Newton"
    }),
    (TYPE_DELTA, {
        "base_hash": "def456abc123def456abc123def456abc123def456abc123def456abc123def4",
        "diff": "- old line\n+ new line\n",
        "algo": "unified"
    }),
    (TYPE_TREE, {
        "merkle_root": "ghi789ghi789ghi789ghi789ghi789ghi789ghi789ghi789ghi789ghi789ghi7",
        "leaf_count": 1024,
        "depth": 10
    }),
    (TYPE_ARCHIVE, {
        "manifest": ["hash1abc" * 8, "hash2def" * 8],
        "total_size": 1024,
        "piece_count": 4
    }),
    (TYPE_RELATION, {
        "from_hash": "aaa" * 21 + "a",
        "to_hash": "bbb" * 21 + "b",
        "type": "INFLUENCED",
        "weight": 1.0
    }),
    (TYPE_PIECE, {
        "file_hash": "ccc" * 21 + "c",
        "piece_index": 0,
        "total_pieces": 4,
        "piece_size": 256
    }),
    (TYPE_STORAGE_PROOF, {
        "piece_hash": "ddd" * 21 + "d",
        "timestamp_us": 1741564800000000,
        "challenge": "eee" * 21 + "e"
    }),
]

print("=" * 70)
print("  EXPERIMENT 11: NEW DOT TYPES — RESULTS")
print("=" * 70)
print()
print(f"  {'Type Byte':<12s} {'Type Name':<18s} {'Size':>6s}  {'Verified':<10s}  Payload summary")
print(f"  {'-'*12} {'-'*18} {'-'*6}  {'-'*10}  {'-'*20}")

all_passed = True
for i, (type_byte, payload_dict) in enumerate(test_cases):
    payload = json.dumps(payload_dict).encode()
    d = create(
        payload=payload,
        keypair=kp,
        dot_type=type_byte,
        timestamp_us=TS + i * 1000,
    )
    vr = verify(d)
    type_name = TYPE_NAMES_EXT.get(type_byte, f"UNKNOWN_{type_byte:#04x}")
    summary = list(payload_dict.keys())[0] + "=..."

    print(f"  0x{type_byte:02X}        {type_name:<18s} {len(d):>6d}  {str(vr.verified):<10s}  {summary}")

    if not vr.verified:
        all_passed = False
        print(f"    ERROR: Verification failed!")

print()
print(f"  All types sealed and verified: {all_passed}")
print()

# Also verify that dot_type_name field reflects unknown types gracefully
d_tree = create(payload=b'{"test": 1}', keypair=kp, dot_type=TYPE_TREE,
                timestamp_us=TS + 9000)
vr_tree = verify(d_tree)
print(f"  TYPE_TREE (0x08) type_name field: '{vr_tree.dot_type_name}'")
print(f"  (Library falls back to UNKNOWN_0x08 for unregistered types)")
print()
print("  EXPERIMENT 11 PASSED" if all_passed else "  EXPERIMENT 11 FAILED")
print("=" * 70)
