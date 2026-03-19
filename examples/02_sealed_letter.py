"""
example 02 — Sealed Letter

Alice writes a message. Only Bob can read it.
Anyone can verify WHO wrote it and WHEN — without seeing the contents.
"""

import sys
sys.path.insert(0, "..")

import dot_protocol as dot

# Two identities
alice = dot.generate_keypair()
bob   = dot.generate_keypair()

# Alice seals a letter for Bob
message = b"Meet me at the lighthouse at dawn."
letter = dot.create(
    payload=message,
    keypair=alice,
    dot_type=0x06,  # SEALED_LETTER
    recipient_keys=[bob.ed25519_public],
)

print(f"Letter: {len(letter)} bytes")
print(f"From:   {alice.ed25519_public.hex()[:16]}…")
print(f"To:     {bob.ed25519_public.hex()[:16]}…")
print()

# Anyone can verify creator + timestamp (not contents)
v = dot.verify(letter)
print(f"Creator verified: {v.verified}")
print(f"Type: {v.dot_type_name}")
print(f"Encrypted: {v.encrypted}")
print()

# Only Bob can open it
result = dot.open(letter, keypair=bob)
print(f"Bob reads: {result.payload!r}")
print(f"Verified:  {result.verified}")

# Anyone else gets rejected
carol = dot.generate_keypair()
try:
    dot.open(letter, keypair=carol)
except Exception as e:
    print(f"\nCarol tries: {type(e).__name__} — {e}")
