"""
Experiment 3: Minimum DOT
Seal a 1-byte payload, report total DOT size, verify it.
Expected: 123 bytes, valid.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, TYPE_OBSERVATION

kp = crypto.generate_keypair(b"\x00" * 32)

dot_bytes = create(
    payload=b"\x00",
    keypair=kp,
    dot_type=TYPE_OBSERVATION,
    timestamp_us=1741564800_000_000,
)

result = verify(dot_bytes)

print("=" * 55)
print("  EXPERIMENT 03: MINIMUM DOT — RESULTS")
print("=" * 55)
print()
print(f"  Payload:          1 byte (0x00)")
print(f"  DOT size:         {len(dot_bytes)} bytes")
print()
print(f"  Wire format breakdown:")
print(f"    Header:         12 bytes  (MAGIC+VERSION+SUITE+FLAGS+TYPE+LEN)")
print(f"    Key section:    35 bytes  (KEY_TYPE+KEY_LEN+PUBKEY)")
print(f"    Timestamp:       8 bytes")
print(f"    Payload:         1 byte")
print(f"    Signature:      67 bytes  (KEY_TYPE+SIG_LEN+SIG)")
print(f"    Total:         {12+35+8+1+67} bytes")
print()
print(f"  Verified:         {result.verified}")
print(f"  DOT hash:         {result.dot_hash_hex[:32]}...")
print()

assert result.verified, "FATAL: Verification failed!"
assert len(dot_bytes) == 123, f"Expected 123 bytes, got {len(dot_bytes)}"

print("  EXPERIMENT 03 PASSED — minimum DOT is 123 bytes")
print("=" * 55)
