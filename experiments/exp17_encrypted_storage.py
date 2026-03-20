"""
Experiment 17: Encrypted Storage
Owner encrypts 50KB payload. Intruder cannot open it. Owner can.
"""

import sys
import os
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, NotAddressedToYouError

owner    = crypto.generate_keypair(hashlib.sha256(b"owner").digest())
intruder = crypto.generate_keypair(hashlib.sha256(b"intruder").digest())

content = b"Top secret financial data. " * 2000  # ~54 KB

# Encrypt for owner
encrypted_dot = create(
    payload=content,
    keypair=owner,
    recipient_keys=[owner.ed25519_public],
    timestamp_us=1741564800_000_000,
)

# Test 1: verify without keypair (signature check only — should pass)
r1 = verify(encrypted_dot)
test1 = r1.verified

# Test 2: open with owner (should decrypt)
r2 = dot_open(encrypted_dot, keypair=owner)
test2 = r2.payload == content

# Test 3: open with intruder (should raise NotAddressedToYouError)
test3 = False
try:
    dot_open(encrypted_dot, keypair=intruder)
except NotAddressedToYouError:
    test3 = True

# Test 4: open without any keypair (should raise NotAddressedToYouError)
test4 = False
try:
    dot_open(encrypted_dot)
except NotAddressedToYouError:
    test4 = True

print("=" * 65)
print("  EXPERIMENT 17: ENCRYPTED STORAGE")
print("=" * 65)
print()
print(f"  Payload size:          {len(content):,} bytes (~{len(content)//1024} KB)")
print(f"  Encrypted DOT size:    {len(encrypted_dot):,} bytes")
print(f"  Encryption overhead:   {len(encrypted_dot) - len(content):,} bytes")
print()
print(f"  Test 1 — verify() without keypair:  {test1} (signature still checkable)")
print(f"  Test 2 — open() with owner:         {test2} (payload decrypted correctly)")
print(f"  Test 3 — open() with intruder:      {test3} (NotAddressedToYouError raised)")
print(f"  Test 4 — open() with no keypair:    {test4} (NotAddressedToYouError raised)")
print()

all_pass = test1 and test2 and test3 and test4
if all_pass:
    print("  ✅ EXP-17 PASSED")
else:
    fails = [i+1 for i, t in enumerate([test1, test2, test3, test4]) if not t]
    print(f"  ❌ EXP-17 FAILED — tests {fails} did not pass")
print("=" * 65)

assert all_pass, "EXP-17 FAILED"
