"""
Experiment 1: Genesis DOT
Generate keypair from deterministic seed, create DOT, verify it.
"""

import sys
import os
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

# Deterministic seed
seed = hashlib.sha256(b"genesis-observer").digest()
kp = crypto.generate_keypair(seed)

payload = b"The act of observation leaves its dot."

dot_bytes = create(
    payload=payload,
    keypair=kp,
    dot_type=TYPE_OBSERVATION,
    timestamp_us=1741564800_000_000,  # 2026-03-10T00:00:00 UTC
)

result = verify(dot_bytes)

# Save to results/
results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(results_dir, exist_ok=True)
genesis_path = os.path.join(results_dir, "genesis.dot")
with open(genesis_path, "wb") as f:
    f.write(dot_bytes)

# Also save to project root for EXP-04
root_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "genesis.dot")
with open(root_path, "wb") as f:
    f.write(dot_bytes)

print("=" * 55)
print("  EXPERIMENT 01: GENESIS DOT — RESULTS")
print("=" * 55)
print()
print(f"  Seed source:      hashlib.sha256(b'genesis-observer')")
print(f"  Creator key:      {kp.ed25519_public.hex()}")
print()
print(f"  DOT size:         {len(dot_bytes)} bytes")
print(f"  DOT hash:         {result.dot_hash_hex}")
print(f"  Signature valid:  {result.verified}")
print(f"  DOT type:         {result.dot_type_name}")
print(f"  Payload:          {payload.decode()}")
print()
print(f"  Saved to:         {genesis_path}")
print()
assert result.verified, "FATAL: Signature verification failed!"
assert len(dot_bytes) >= 122, f"DOT too small: {len(dot_bytes)} bytes"
print("  EXPERIMENT 01 PASSED")
print("=" * 55)
