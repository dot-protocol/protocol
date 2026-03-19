"""
example 01 — Hello World

Seal a DOT in 3 lines of code. Open it in 3 more.
This is the entire protocol surface for 90% of use cases.
"""

import sys
sys.path.insert(0, "..")

import dot_protocol as dot

# SEAL — 3 lines
keypair = dot.generate_keypair()
sealed = dot.create(b"hello world", keypair)
print(f"Sealed: {len(sealed)} bytes  hash={dot.verify(sealed).dot_hash_hex[:16]}…")

# OPEN — 3 lines
result = dot.open(sealed)
assert result.verified
print(f"Opened: {result.payload!r}  verified={result.verified}")
