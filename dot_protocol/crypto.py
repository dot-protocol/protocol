"""
DOT Protocol — Cryptographic Primitives
Suite 1: Ed25519 + X25519 + AES-256-GCM + SHA-256 + Argon2id

KEY DERIVATION (Council-locked, Round 155):
  One 32-byte seed → Ed25519 keypair (signing)
                   → X25519 keypair (encryption, derived via libsodium standard)
  Only Ed25519 public key appears in DOT headers.
  X25519 is derived at OPEN time by any reader. Saves 32 bytes per DOT.

RECOVERY:
  BIP-39 24-word mnemonic encodes the 32-byte seed.
  From 24 words → seed → all keys. One phrase. One identity. Forever.
"""

import os
import struct
import hashlib
import hmac
from dataclasses import dataclass
from typing import Optional, Tuple

import nacl.signing
import nacl.bindings
import nacl.utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


# ─── Key Types ───────────────────────────────────────────────────────────────

KEY_TYPE_ED25519 = 0x01
KEY_TYPE_ED25519_DILITHIUM3 = 0x02  # Suite 2 (post-quantum, reserved)

HKDF_CONTEXT_SESSION = b"DOT-v1-session"
HKDF_CONTEXT_ROTATION = b"DOT-v1-rotation"

AES_NONCE_BYTES = 12
AES_TAG_BYTES = 16
SESSION_KEY_BYTES = 32
ED25519_PUBLIC_KEY_BYTES = 32
X25519_PUBLIC_KEY_BYTES = 32
SIGNATURE_BYTES = 64


@dataclass
class KeyPair:
    """A DOT identity keypair. The public key IS the identity."""

    # Ed25519 keys (signing)
    ed25519_seed: bytes          # 32-byte seed — KEEP SECRET (BIP-39 recovery phrase encodes this)
    ed25519_private: bytes       # 64-byte signing key (seed + public key concatenated, libsodium convention)
    ed25519_public: bytes        # 32-byte public key — this IS the DOT identity

    # X25519 keys (encryption, derived from Ed25519)
    x25519_private: bytes        # 32-byte X25519 private key
    x25519_public: bytes         # 32-byte X25519 public key

    @property
    def public_key(self) -> bytes:
        """The identity. The address. 32 bytes of Ed25519 public key."""
        return self.ed25519_public

    def to_dict(self) -> dict:
        return {
            "ed25519_seed_hex": self.ed25519_seed.hex(),
            "ed25519_public_hex": self.ed25519_public.hex(),
            "x25519_public_hex": self.x25519_public.hex(),
        }


def generate_keypair(seed: Optional[bytes] = None) -> KeyPair:
    """
    Generate a DOT identity keypair.

    Args:
        seed: Optional 32-byte seed. If None, generates random seed.
              MUST be kept secret — it's the BIP-39 recovery phrase source.

    Returns:
        KeyPair with Ed25519 signing keys and derived X25519 encryption keys.
    """
    if seed is None:
        seed = os.urandom(32)

    if len(seed) != 32:
        raise ValueError(f"Seed must be exactly 32 bytes, got {len(seed)}")

    # Ed25519 keypair from seed (RFC 8032)
    signing_key = nacl.signing.SigningKey(seed)
    ed25519_private = bytes(signing_key)         # 64 bytes: seed || public_key
    ed25519_public = bytes(signing_key.verify_key)  # 32 bytes

    # X25519 keypair derived from Ed25519 (libsodium standard — Council Round 155)
    # PyNaCl exposes this as signing_key.to_curve25519_private_key()
    x25519_key = signing_key.to_curve25519_private_key()
    x25519_private = bytes(x25519_key)
    x25519_public = bytes(x25519_key.public_key)

    return KeyPair(
        ed25519_seed=seed,
        ed25519_private=ed25519_private,
        ed25519_public=ed25519_public,
        x25519_private=x25519_private,
        x25519_public=x25519_public,
    )


def keypair_from_ed25519_public(ed25519_public: bytes) -> "RecipientPublicKey":
    """
    Reconstruct just the public-key-side of a keypair from an Ed25519 public key.
    Used when SEALING a DOT for a recipient (you only have their public key).
    """
    return RecipientPublicKey(ed25519_public=ed25519_public)


@dataclass
class RecipientPublicKey:
    """Public key only — for SEALING to a recipient."""
    ed25519_public: bytes

    @property
    def x25519_public(self) -> bytes:
        return nacl.bindings.crypto_sign_ed25519_pk_to_curve25519(self.ed25519_public)

    @property
    def public_key(self) -> bytes:
        return self.ed25519_public


# ─── Signing ─────────────────────────────────────────────────────────────────

def sign(message: bytes, keypair: KeyPair) -> bytes:
    """Sign a message with Ed25519. Returns 64-byte signature."""
    signing_key = nacl.signing.SigningKey(keypair.ed25519_seed)
    signed = signing_key.sign(message)
    return signed.signature  # 64 bytes


def verify_signature(message: bytes, signature: bytes, ed25519_public: bytes) -> bool:
    """Verify an Ed25519 signature. Returns True if valid, False if not."""
    try:
        verify_key = nacl.signing.VerifyKey(ed25519_public)
        verify_key.verify(message, signature)
        return True
    except Exception:
        return False


# ─── Key Exchange + Encryption ───────────────────────────────────────────────

def _derive_encryption_key(shared_secret: bytes, context: bytes = HKDF_CONTEXT_SESSION) -> bytes:
    """
    Derive a 32-byte AES-256-GCM key from an X25519 shared secret via HKDF-SHA256.
    """
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=context,
    )
    return hkdf.derive(shared_secret)


def seal_session_key(
    session_key: bytes,
    sender_keypair: KeyPair,
    recipient_public: bytes,  # Ed25519 public key
) -> bytes:
    """
    Encrypt the session key for a specific recipient.

    Returns 60 bytes:
      12 bytes NONCE + 32 bytes CIPHERTEXT + 16 bytes AUTH_TAG

    Council Round 155: Per-recipient nonce. Each encryption is independent.
    """
    # Derive X25519 public key from recipient's Ed25519 public key
    recipient_x25519_public = nacl.bindings.crypto_sign_ed25519_pk_to_curve25519(recipient_public)

    # X25519 ECDH using nacl box: sender_private × recipient_public → shared_secret
    from nacl.public import PrivateKey, PublicKey, Box
    sender_private_key = PrivateKey(sender_keypair.x25519_private)
    recipient_public_key = PublicKey(recipient_x25519_public)
    box = Box(sender_private_key, recipient_public_key)
    shared_secret = box.shared_key()

    # Derive AES key from shared secret
    aes_key = _derive_encryption_key(shared_secret)

    # Encrypt session key with AES-256-GCM
    nonce = os.urandom(AES_NONCE_BYTES)
    aesgcm = AESGCM(aes_key)
    ciphertext_with_tag = aesgcm.encrypt(nonce, session_key, None)  # No additional data

    # ciphertext_with_tag = 32 bytes ciphertext + 16 bytes tag = 48 bytes
    return nonce + ciphertext_with_tag  # 12 + 48 = 60 bytes


def open_session_key(
    encrypted_session_key: bytes,  # 60 bytes: nonce(12) + ciphertext+tag(48)
    recipient_keypair: KeyPair,
    sender_ed25519_public: bytes,
) -> bytes:
    """
    Decrypt the session key using recipient's private key and sender's public key.
    Returns the 32-byte session key.
    """
    if len(encrypted_session_key) != 60:
        raise ValueError(f"Encrypted session key must be 60 bytes, got {len(encrypted_session_key)}")

    nonce = encrypted_session_key[:AES_NONCE_BYTES]
    ciphertext_with_tag = encrypted_session_key[AES_NONCE_BYTES:]

    # Derive X25519 public key from sender's Ed25519 public key
    sender_x25519_public = nacl.bindings.crypto_sign_ed25519_pk_to_curve25519(sender_ed25519_public)

    # X25519 ECDH: recipient_private × sender_public → shared_secret
    from nacl.public import PrivateKey, PublicKey, Box
    recipient_private_key = PrivateKey(recipient_keypair.x25519_private)
    sender_public_key = PublicKey(sender_x25519_public)
    box = Box(recipient_private_key, sender_public_key)
    shared_secret = box.shared_key()

    # Derive AES key
    aes_key = _derive_encryption_key(shared_secret)

    # Decrypt session key
    aesgcm = AESGCM(aes_key)
    try:
        session_key = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    except Exception:
        raise ValueError("Session key decryption failed — wrong recipient or tampered DOT")

    return session_key


def encrypt_payload(payload: bytes, session_key: bytes) -> Tuple[bytes, bytes]:
    """
    Encrypt payload with AES-256-GCM using session key.

    Returns:
        (nonce, ciphertext_with_tag) — two separate byte strings
        Together they form the encrypted payload section.
    """
    nonce = os.urandom(AES_NONCE_BYTES)
    aesgcm = AESGCM(session_key)
    ciphertext_with_tag = aesgcm.encrypt(nonce, payload, None)
    return nonce, ciphertext_with_tag  # 12 bytes, len(payload) + 16 bytes


def decrypt_payload(nonce: bytes, ciphertext_with_tag: bytes, session_key: bytes) -> bytes:
    """Decrypt payload. Raises ValueError if authentication fails."""
    aesgcm = AESGCM(session_key)
    try:
        return aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    except Exception:
        raise ValueError("Payload decryption failed — wrong key or tampered DOT")


# ─── Content-Addressable Hashing ─────────────────────────────────────────────

def dot_hash(dot_bytes: bytes) -> bytes:
    """
    Compute the canonical DOT hash: SHA-256 of complete DOT bytes.
    This hash IS the DOT's address in the content-addressable sense.
    """
    return hashlib.sha256(dot_bytes).digest()


def dot_hash_hex(dot_bytes: bytes) -> str:
    """Hex-encoded DOT hash."""
    return dot_hash(dot_bytes).hex()
