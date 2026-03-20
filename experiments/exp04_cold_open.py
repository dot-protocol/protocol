"""
Experiment 4: Cold Open
Manually parse genesis.dot header WITHOUT the library, then verify with library.
"""

import sys
import os
import struct
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol.container import verify

MAGIC = b"\x89DOT"

DOT_TYPE_NAMES = {
    0x01: "OBSERVATION",
    0x02: "IDENTITY",
    0x03: "ROTATION",
    0x04: "ATTESTATION",
    0x05: "ANTI_DOT",
    0x06: "SEALED_LETTER",
    0x07: "CHAIN_LINK",
}

# Load genesis.dot from project root
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
genesis_path = os.path.join(root, "genesis.dot")

if not os.path.exists(genesis_path):
    # Try results/
    genesis_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "genesis.dot")

with open(genesis_path, "rb") as f:
    data = f.read()

pos = 0

# Parse header (12 bytes)
magic = data[pos:pos+4]; pos += 4
version = data[pos]; pos += 1
crypto_suite = data[pos]; pos += 1
flags = data[pos]; pos += 1
dot_type = data[pos]; pos += 1
payload_length = struct.unpack(">I", data[pos:pos+4])[0]; pos += 4

# Parse key section (35 bytes)
key_type = data[pos]; pos += 1
key_length = struct.unpack(">H", data[pos:pos+2])[0]; pos += 2
public_key = data[pos:pos+key_length]; pos += key_length

# Parse timestamp (8 bytes)
timestamp_us = struct.unpack(">q", data[pos:pos+8])[0]; pos += 8

# Parse payload
payload = data[pos:pos+payload_length]; pos += payload_length

# Convert timestamp to ISO
ts_seconds = timestamp_us / 1_000_000
ts_iso = datetime.datetime.utcfromtimestamp(ts_seconds).strftime("%Y-%m-%dT%H:%M:%SZ")

# Verify with library
result = verify(data)

print("=" * 60)
print("  EXPERIMENT 04: COLD OPEN — RESULTS")
print("=" * 60)
print()
print(f"  File:             genesis.dot ({len(data)} bytes)")
print()
print(f"  === MANUAL PARSE (no library) ===")
print(f"  Magic bytes:      {magic.hex()} ({magic!r})")
print(f"  Version:          {version}")
print(f"  Crypto suite:     {crypto_suite} (Ed25519+X25519+AES-256-GCM+SHA-256)")
print(f"  Flags:            0x{flags:02x}")
print(f"  DOT type:         0x{dot_type:02x} ({DOT_TYPE_NAMES.get(dot_type, 'UNKNOWN')})")
print(f"  Payload length:   {payload_length} bytes")
print(f"  Key type:         {key_type} (Ed25519)")
print(f"  Key length:       {key_length} bytes")
print(f"  Creator key:      {public_key[:16].hex()}... ({len(public_key)} bytes)")
print(f"  Timestamp:        {timestamp_us} µs → {ts_iso}")
print(f"  Payload:          {payload.decode('utf-8')!r}")
print()
print(f"  === LIBRARY VERIFY ===")
print(f"  Verified:         {result.verified}")
print(f"  DOT hash:         {result.dot_hash_hex}")
print()

assert magic == MAGIC, f"Magic mismatch: {magic!r}"
assert result.verified, "FATAL: Verification failed!"
print("  EXPERIMENT 04 PASSED — cold parse + verify successful")
print("=" * 60)
