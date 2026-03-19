"""
example 08 — Anti-DOT (Deletion Signal)

Information can be retracted. Not erased — retracted.
The original DOT still exists in the content-addressed layer.
The Anti-DOT is a cryptographically signed statement:
"I, the creator, declare this DOT should no longer propagate."

Relay nodes that receive an Anti-DOT tombstone the target.
The 1.237× amplification factor is a Layer 2 property (trust graph propagation).
Layer 1 (this wire format) carries only the tombstone signal.

"The Council knows the cost of permanent record.
 It knows the cost of forgetting too.
 The Anti-DOT is the only honest answer."
"""

import sys
sys.path.insert(0, "..")

import dot_protocol as dot
from dot_protocol.crypto import dot_hash_hex

# Step 1: Create a DOT (something you want to retract later)
keypair = dot.generate_keypair()

original = dot.create(
    payload=b"I hereby declare that the sky is green.",
    keypair=keypair,
)

print(f"Original DOT:  {len(original)} bytes")
print(f"Original hash: {dot_hash_hex(original)}")
print()

# Step 2: Create the Anti-DOT
# Payload = SHA-256 hash of the DOT to tombstone (32 bytes, binary)
anti = dot.create(
    payload=dot.verify(original).dot_hash,  # 32-byte hash
    keypair=keypair,                          # Must be original creator
    is_anti_dot=True,
)

print(f"Anti-DOT:  {len(anti)} bytes")
print(f"Anti hash: {dot_hash_hex(anti)}")
print()

# Step 3: Verify the Anti-DOT
result = dot.open(anti)
print(f"Anti-DOT verified: {result.verified}")
print(f"Anti-DOT type:     {result.dot_type_name}")
print(f"Target hash:       {result.payload.hex()}")
print(f"Matches original:  {result.payload.hex() == dot_hash_hex(original)}")
print()

# Layer 2 note:
print("Relay nodes receive this Anti-DOT and:")
print("  1. Verify creator is the same as original DOT's creator")
print("  2. Tombstone the original — stop propagating it")
print("  3. The 1.237× amplification means the anti-signal spreads slightly")
print("     faster through the trust graph than the original content.")
print()
print("The original bytes remain content-addressable forever.")
print("Deletion = 'please stop spreading this', not 'pretend it never existed'.")
