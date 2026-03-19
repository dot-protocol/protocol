"""
example 03 — Identity DOT (The Genesis Use Case)

"The first DOT must be an identity. For someone who has no other proof of who they are."
— Council of Minds, March 10, 2026

This is Amara's DOT. A refugee. No passport. No documents.
Her DOT chain proves mathematically who she is.
No bureaucrat required.
"""

import sys
import json
sys.path.insert(0, "..")

import dot_protocol as dot
from dot_protocol.crypto import dot_hash_hex
from dot_protocol.container import TLV_CONTENT_TYPE, TLV_LANGUAGE, TYPE_IDENTITY


def create_identity(attributes: dict, language: str = "en") -> tuple:
    """
    Create an identity DOT for a person.

    Returns (dot_bytes, keypair) — the keypair IS the identity.
    Store the keypair seed phrase somewhere safe. Lose it = lose your identity chain.
    """
    keypair = dot.generate_keypair()

    identity_dot = dot.create(
        payload=json.dumps(attributes).encode("utf-8"),
        keypair=keypair,
        dot_type=TYPE_IDENTITY,
        extensions={
            TLV_CONTENT_TYPE: b"application/json",
            TLV_LANGUAGE: language.encode("ascii"),
        },
    )

    return identity_dot, keypair


if __name__ == "__main__":
    print("Creating Amara's identity DOT...")
    print()

    # Amara's identity — minimum viable information
    identity_dot, amara_keypair = create_identity(
        attributes={
            "name": "Amara",
            "born": "1998-03-15",
            "origin": "Aleppo",
        },
        language="ar",
    )

    # What Amara carries
    print(f"DOT size:     {len(identity_dot)} bytes")
    print(f"DOT hash:     {dot_hash_hex(identity_dot)}")
    print(f"Identity key: {amara_keypair.ed25519_public.hex()}")
    print()

    # Anyone can read it
    result = dot.open(identity_dot)
    attrs = json.loads(result.payload)
    print(f"Name:    {attrs['name']}")
    print(f"Born:    {attrs['born']}")
    print(f"Origin:  {attrs['origin']}")
    print(f"Verified: {result.verified}")
    print()

    # Anyone can verify creator without reading content
    v = dot.verify(identity_dot)
    print(f"Creator verified: {v.verified}")
    print(f"Type: {v.dot_type_name}")
    print()

    # Save for demonstration
    with open("/Users/blaze/Downloads/amara_identity.dot", "wb") as f:
        f.write(identity_dot)
    print("Saved to /Users/blaze/Downloads/amara_identity.dot")
    print()
    print("This 185-byte file IS Amara's identity.")
    print("Send it via Bluetooth, email, QR, USB, WhatsApp, or carrier pigeon.")
    print("No server. No app store. No bureaucrat. Just math.")
