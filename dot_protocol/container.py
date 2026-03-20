"""
DOT Protocol — Wire Format Encoder/Decoder
v1 Specification (Council of Minds, March 10, 2026)

Wire format:
  MAGIC(4) VERSION(1) CRYPTO_SUITE(1) FLAGS(1) DOT_TYPE(1) PAYLOAD_LENGTH(4)
  CREATOR_KEY_SECTION
  TIMESTAMP_SECTION
  [PARENT_HASH_SECTION]   — if HAS_PARENT flag
  [RECIPIENTS_SECTION]    — if HAS_RECIPIENT flag
  PAYLOAD_SECTION
  [TLV_EXTENSIONS]        — if HAS_EXTENSIONS flag
  SIGNATURE_SECTION

Five public functions: create, open, verify, chain, rotate
"""

import os
import struct
import time
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

from . import crypto


# ─── Constants ───────────────────────────────────────────────────────────────

MAGIC = b"\x89DOT"
VERSION_1 = 0x01
CRYPTO_SUITE_1 = 0x01  # Ed25519 + X25519 + AES-256-GCM + SHA-256

# FLAGS byte
FLAG_ENCRYPTED = 0x01
FLAG_HAS_RECIPIENT = 0x02
FLAG_HAS_EXTENSIONS = 0x04
FLAG_HAS_PARENT = 0x08
FLAG_IS_ANTI_DOT = 0x10
FLAG_IS_ROSETTA = 0x20

# DOT_TYPE byte
TYPE_OBSERVATION = 0x01
TYPE_IDENTITY = 0x02
TYPE_ROTATION = 0x03
TYPE_ATTESTATION = 0x04
TYPE_ANTI_DOT = 0x05
TYPE_SEALED_LETTER = 0x06
TYPE_CHAIN_LINK = 0x07

TYPE_NAMES = {
    TYPE_OBSERVATION: "OBSERVATION",
    TYPE_IDENTITY: "IDENTITY",
    TYPE_ROTATION: "ROTATION",
    TYPE_ATTESTATION: "ATTESTATION",
    TYPE_ANTI_DOT: "ANTI_DOT",
    TYPE_SEALED_LETTER: "SEALED_LETTER",
    TYPE_CHAIN_LINK: "CHAIN_LINK",
}

# TLV extension tags (optional — safe to skip if unknown)
TLV_CONTENT_TYPE = 0x0001
TLV_FILENAME = 0x0002
TLV_DESCRIPTION = 0x0003
TLV_LABELS = 0x0004
TLV_GEO_LOCATION = 0x0005
TLV_LANGUAGE = 0x0006
TLV_REPLY_TO = 0x0007
TLV_EXPIRES = 0x0008
TLV_ENCODING = 0x0009
TLV_NAMESPACE = 0x000A
TLV_ROSETTA_DECODER = 0x000B

# TLV critical tags (high bit set — decoder MUST understand or reject)
TLV_CRYPTO_UPGRADE = 0x8001
TLV_MULTI_SIGNATURE = 0x8002
TLV_CHAIN_CONSTRAINT = 0x8003
TLV_ROTATION_PROOF = 0x8004

TLV_SENTINEL = b"\x00\x00\x00\x00\x00\x00"  # TAG=0x0000 LENGTH=0x00000000

# Hash algorithm IDs
HASH_SHA256 = 0x01

# Key type IDs
KEY_TYPE_ED25519 = 0x01

KNOWN_OPTIONAL_TLV_TAGS = {
    TLV_CONTENT_TYPE, TLV_FILENAME, TLV_DESCRIPTION, TLV_LABELS,
    TLV_GEO_LOCATION, TLV_LANGUAGE, TLV_REPLY_TO, TLV_EXPIRES,
    TLV_ENCODING, TLV_NAMESPACE, TLV_ROSETTA_DECODER,
}

KNOWN_CRITICAL_TLV_TAGS = {
    TLV_CRYPTO_UPGRADE, TLV_MULTI_SIGNATURE, TLV_CHAIN_CONSTRAINT, TLV_ROTATION_PROOF,
}


# ─── Result Types ─────────────────────────────────────────────────────────────

@dataclass
class DotResult:
    """Result of dot.open() — everything decoded from a DOT."""
    payload: bytes
    creator_key: bytes          # Ed25519 public key (32 bytes)
    creator_key_hex: str
    timestamp_us: int           # Microseconds since Unix epoch
    dot_type: int
    dot_type_name: str
    verified: bool              # True = signature valid, content untampered
    encrypted: bool
    parent_hash: Optional[bytes] = None
    parent_hash_hex: Optional[str] = None
    extensions: Dict[int, bytes] = field(default_factory=dict)
    dot_hash: Optional[bytes] = None
    dot_hash_hex: Optional[str] = None


@dataclass
class VerifyResult:
    """Result of dot.verify() — signature check without opening payload."""
    verified: bool
    creator_key: bytes
    creator_key_hex: str
    timestamp_us: int
    dot_type: int
    dot_type_name: str
    encrypted: bool
    dot_hash: bytes
    dot_hash_hex: str
    error: Optional[str] = None


# ─── Errors ──────────────────────────────────────────────────────────────────

class DotError(Exception):
    """Base error for DOT protocol operations."""
    pass

class InvalidMagicError(DotError):
    """Not a DOT file."""
    pass

class UnsupportedVersionError(DotError):
    """DOT version not supported by this decoder."""
    pass

class UnsupportedCryptoSuiteError(DotError):
    """Crypto suite not supported by this decoder."""
    pass

class SignatureVerificationError(DotError):
    """DOT signature verification failed — may be tampered."""
    pass

class NotAddressedToYouError(DotError):
    """Encrypted DOT is not addressed to the provided keypair."""
    pass

class UnknownCriticalExtensionError(DotError):
    """Unknown critical TLV extension — cannot safely process this DOT."""
    pass


# ─── Internal: Encoder ───────────────────────────────────────────────────────

def _encode_key_section(ed25519_public: bytes) -> bytes:
    """Encode the CREATOR PUBLIC KEY section."""
    return bytes([KEY_TYPE_ED25519]) + struct.pack(">H", len(ed25519_public)) + ed25519_public


def _encode_timestamp(timestamp_us: Optional[int] = None) -> bytes:
    """Encode TIMESTAMP section (8 bytes, big-endian int64, microseconds UTC)."""
    if timestamp_us is None:
        timestamp_us = int(time.time() * 1_000_000)
    return struct.pack(">q", timestamp_us)


def _encode_parent_hash(parent_dot_bytes: bytes) -> bytes:
    """Encode PARENT_HASH section from parent DOT bytes."""
    parent_hash = crypto.dot_hash(parent_dot_bytes)
    return bytes([HASH_SHA256, len(parent_hash)]) + parent_hash


def _encode_recipient(
    recipient_ed25519_public: bytes,
    session_key: bytes,
    sender_keypair: "crypto.KeyPair",
) -> bytes:
    """Encode one recipient entry including encrypted session key."""
    encrypted_sk = crypto.seal_session_key(session_key, sender_keypair, recipient_ed25519_public)
    # KEY_TYPE(1) + KEY_LENGTH(2) + PUBLIC_KEY(32) + ENCRYPTED_SESSION_KEY(60)
    return (
        bytes([KEY_TYPE_ED25519])
        + struct.pack(">H", len(recipient_ed25519_public))
        + recipient_ed25519_public
        + encrypted_sk
    )


def _encode_recipients_section(
    recipient_keys: List[bytes],
    session_key: bytes,
    sender_keypair: "crypto.KeyPair",
) -> bytes:
    """Encode RECIPIENTS section."""
    if len(recipient_keys) > 255:
        raise DotError("Maximum 255 recipients per DOT")
    data = bytes([len(recipient_keys)])
    for pub_key in recipient_keys:
        data += _encode_recipient(pub_key, session_key, sender_keypair)
    return data


def _encode_tlv_extensions(extensions: Dict[int, bytes]) -> bytes:
    """Encode TLV EXTENSIONS section including sentinel terminator."""
    data = b""
    for tag, value in extensions.items():
        data += struct.pack(">H", tag) + struct.pack(">I", len(value)) + value
    data += TLV_SENTINEL
    return data


def _encode_signature(message: bytes, keypair: "crypto.KeyPair") -> bytes:
    """Encode SIGNATURE section."""
    sig = crypto.sign(message, keypair)
    return bytes([KEY_TYPE_ED25519]) + struct.pack(">H", len(sig)) + sig


# ─── Internal: Decoder ───────────────────────────────────────────────────────

class _Reader:
    """Streaming byte reader for DOT parsing."""
    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0

    @property
    def pos(self) -> int:
        return self._pos

    def remaining(self) -> int:
        return len(self._data) - self._pos

    def read(self, n: int) -> bytes:
        if self._pos + n > len(self._data):
            raise DotError(f"Unexpected end of DOT at offset {self._pos} (need {n} more bytes)")
        chunk = self._data[self._pos:self._pos + n]
        self._pos += n
        return chunk

    def read_u8(self) -> int:
        return struct.unpack("B", self.read(1))[0]

    def read_u16_be(self) -> int:
        return struct.unpack(">H", self.read(2))[0]

    def read_u32_be(self) -> int:
        return struct.unpack(">I", self.read(4))[0]

    def read_i64_be(self) -> int:
        return struct.unpack(">q", self.read(8))[0]

    def peek_u16_be(self) -> int:
        if self._pos + 2 > len(self._data):
            return 0
        return struct.unpack(">H", self._data[self._pos:self._pos + 2])[0]


def _decode_header(r: _Reader) -> tuple:
    """Parse fixed 12-byte header. Returns (version, crypto_suite, flags, dot_type, payload_length)."""
    magic = r.read(4)
    if magic != MAGIC:
        raise InvalidMagicError(f"Invalid magic bytes {magic!r} — not a DOT file")

    version = r.read_u8()
    if version != VERSION_1:
        raise UnsupportedVersionError(
            f"This DOT requires decoder version {version} or higher "
            f"(this decoder supports up to version {VERSION_1})"
        )

    crypto_suite = r.read_u8()
    if crypto_suite != CRYPTO_SUITE_1:
        raise UnsupportedCryptoSuiteError(
            f"Unsupported crypto suite {crypto_suite:#04x}"
        )

    flags = r.read_u8()
    dot_type = r.read_u8()
    payload_length = r.read_u32_be()

    return version, crypto_suite, flags, dot_type, payload_length


def _decode_key_section(r: _Reader) -> bytes:
    """Decode creator public key section. Returns Ed25519 public key bytes."""
    key_type = r.read_u8()
    key_length = r.read_u16_be()
    public_key = r.read(key_length)
    return public_key


def _decode_timestamp(r: _Reader) -> int:
    """Decode 8-byte timestamp. Returns microseconds UTC."""
    return r.read_i64_be()


def _decode_parent_hash(r: _Reader) -> bytes:
    """Decode parent hash section. Returns hash bytes."""
    hash_algo = r.read_u8()
    hash_length = r.read_u8()
    return r.read(hash_length)


def _decode_recipients(r: _Reader) -> List[dict]:
    """Decode recipients section. Returns list of recipient dicts."""
    count = r.read_u8()
    recipients = []
    for _ in range(count):
        key_type = r.read_u8()
        key_length = r.read_u16_be()
        public_key = r.read(key_length)
        encrypted_sk = r.read(60)  # 12 nonce + 32 ciphertext + 16 tag
        recipients.append({
            "key_type": key_type,
            "public_key": public_key,
            "encrypted_session_key": encrypted_sk,
        })
    return recipients


def _decode_tlv_extensions(r: _Reader) -> Dict[int, bytes]:
    """Decode TLV extensions until sentinel. Rejects unknown critical tags."""
    extensions = {}
    while True:
        if r.remaining() < 6:
            break
        tag = r.read_u16_be()
        if tag == 0x0000:
            # Sentinel: read the 4 LENGTH bytes (should be 0x00000000)
            r.read(4)
            break
        length = r.read_u32_be()
        value = r.read(length)

        is_critical = (tag & 0x8000) != 0
        if is_critical and tag not in KNOWN_CRITICAL_TLV_TAGS:
            raise UnknownCriticalExtensionError(
                f"Critical extension tag {tag:#06x} not understood — cannot safely process this DOT"
            )
        # Optional unknown tags are silently skipped (value still stored for transparency)
        extensions[tag] = value

    return extensions


def _decode_signature(r: _Reader) -> bytes:
    """Decode signature section. Returns signature bytes."""
    sig_type = r.read_u8()
    sig_length = r.read_u16_be()
    return r.read(sig_length)


# ─── Five Public Functions ────────────────────────────────────────────────────

def create(
    payload: bytes,
    keypair: "crypto.KeyPair",
    *,
    dot_type: int = TYPE_OBSERVATION,
    recipient_keys: Optional[List[bytes]] = None,
    extensions: Optional[Dict[int, bytes]] = None,
    parent: Optional[bytes] = None,  # parent DOT bytes (not hash)
    timestamp_us: Optional[int] = None,
    is_anti_dot: bool = False,
) -> bytes:
    """
    Create a DOT.

    Args:
        payload:        Raw bytes — any content. The DOT doesn't interpret it.
        keypair:        Creator's keypair. Their public key IS their identity.
        dot_type:       DOT type byte (default: OBSERVATION).
        recipient_keys: List of Ed25519 public keys to encrypt for.
        extensions:     Dict of TLV tag (int) → value (bytes).
        parent:         Parent DOT bytes (sets HAS_PARENT flag, computes hash).
        timestamp_us:   Microseconds since Unix epoch (default: now).
        is_anti_dot:    If True, sets IS_ANTI_DOT flag. Payload should contain target DOT hash.

    Returns:
        Complete DOT as bytes. This is the unit of truth.
    """
    # Compute flags
    encrypted = bool(recipient_keys)
    flags = 0
    if encrypted:
        flags |= FLAG_ENCRYPTED
        flags |= FLAG_HAS_RECIPIENT
    if extensions:
        flags |= FLAG_HAS_EXTENSIONS
    if parent is not None:
        flags |= FLAG_HAS_PARENT
    if is_anti_dot:
        flags |= FLAG_IS_ANTI_DOT
        dot_type = TYPE_ANTI_DOT

    # Build payload section (encrypt if recipients specified)
    if encrypted:
        session_key = os.urandom(32)
        payload_nonce, payload_ciphertext_tag = crypto.encrypt_payload(payload, session_key)
        encrypted_payload = payload_nonce + payload_ciphertext_tag  # 12 + (len(payload) + 16)
        payload_length = len(encrypted_payload)
    else:
        encrypted_payload = payload
        payload_length = len(payload)

    # Build header
    header = MAGIC + bytes([VERSION_1, CRYPTO_SUITE_1, flags, dot_type]) + struct.pack(">I", payload_length)

    # Build body (everything before signature)
    body = _encode_key_section(keypair.ed25519_public)
    body += _encode_timestamp(timestamp_us)

    if parent is not None:
        body += _encode_parent_hash(parent)

    if encrypted and recipient_keys:
        body += _encode_recipients_section(recipient_keys, session_key, keypair)

    body += encrypted_payload

    if extensions:
        body += _encode_tlv_extensions(extensions)

    # Sign everything: header + body
    message_to_sign = header + body
    signature_section = _encode_signature(message_to_sign, keypair)

    return message_to_sign + signature_section


def open(
    dot_bytes: bytes,
    keypair: Optional["crypto.KeyPair"] = None,
) -> DotResult:
    """
    Open a DOT. Verify its signature and optionally decrypt its payload.

    Args:
        dot_bytes:  Complete DOT bytes (from file, network, QR code, anywhere).
        keypair:    Optional. Required only if the DOT is encrypted and addressed to you.

    Returns:
        DotResult with payload, creator identity, timestamp, and verified=True.

    Raises:
        InvalidMagicError:              Not a DOT.
        UnsupportedVersionError:        Version requires newer decoder.
        SignatureVerificationError:     DOT has been tampered with.
        NotAddressedToYouError:         Encrypted DOT, but not your DOT.
        UnknownCriticalExtensionError:  Unknown critical extension.
    """
    r = _Reader(dot_bytes)

    # Parse header
    version, crypto_suite, flags, dot_type, payload_length = _decode_header(r)

    is_encrypted = bool(flags & FLAG_ENCRYPTED)
    has_recipient = bool(flags & FLAG_HAS_RECIPIENT)
    has_extensions = bool(flags & FLAG_HAS_EXTENSIONS)
    has_parent = bool(flags & FLAG_HAS_PARENT)

    # Parse body
    creator_key = _decode_key_section(r)
    timestamp_us = _decode_timestamp(r)

    parent_hash = None
    if has_parent:
        parent_hash = _decode_parent_hash(r)

    recipients = []
    if has_recipient:
        recipients = _decode_recipients(r)

    # Read payload bytes (raw, possibly encrypted)
    raw_payload = r.read(payload_length)

    extensions = {}
    if has_extensions:
        extensions = _decode_tlv_extensions(r)

    # Read signature section (it's the final section)
    sig_pos = r.pos
    signature_section = _decode_signature(r)

    # Verify signature over everything before the signature section
    signed_bytes = dot_bytes[:sig_pos]
    if not crypto.verify_signature(signed_bytes, signature_section, creator_key):
        raise SignatureVerificationError(
            "DOT signature verification failed — this DOT may have been tampered with"
        )

    # Decrypt payload if encrypted
    if is_encrypted:
        if keypair is None:
            raise NotAddressedToYouError(
                "This DOT is encrypted. Provide your keypair to decrypt it."
            )

        # Find our key in recipients
        my_encrypted_sk = None
        for recipient in recipients:
            if recipient["public_key"] == keypair.ed25519_public:
                my_encrypted_sk = recipient["encrypted_session_key"]
                break

        if my_encrypted_sk is None:
            raise NotAddressedToYouError(
                "This DOT is not addressed to you"
            )

        # Decrypt session key
        session_key = crypto.open_session_key(my_encrypted_sk, keypair, creator_key)

        # Decrypt payload: nonce(12) + ciphertext+tag
        nonce = raw_payload[:12]
        ciphertext_with_tag = raw_payload[12:]
        payload = crypto.decrypt_payload(nonce, ciphertext_with_tag, session_key)
    else:
        payload = raw_payload

    dot_hash_bytes = crypto.dot_hash(dot_bytes)

    return DotResult(
        payload=payload,
        creator_key=creator_key,
        creator_key_hex=creator_key.hex(),
        timestamp_us=timestamp_us,
        dot_type=dot_type,
        dot_type_name=TYPE_NAMES.get(dot_type, f"UNKNOWN_{dot_type:#04x}"),
        verified=True,
        encrypted=is_encrypted,
        parent_hash=parent_hash,
        parent_hash_hex=parent_hash.hex() if parent_hash else None,
        extensions=extensions,
        dot_hash=dot_hash_bytes,
        dot_hash_hex=dot_hash_bytes.hex(),
    )


def verify(dot_bytes: bytes) -> VerifyResult:
    """
    Verify a DOT's signature without decrypting it.

    Works on encrypted DOTs — you can verify WHO created it and WHEN
    without seeing the contents. This is the public accountability function.

    Returns:
        VerifyResult with verified=True if untampered, False if corrupted/forged.
    """
    dot_hash_bytes = crypto.dot_hash(dot_bytes)

    try:
        r = _Reader(dot_bytes)
        version, crypto_suite, flags, dot_type, payload_length = _decode_header(r)

        is_encrypted = bool(flags & FLAG_ENCRYPTED)
        has_recipient = bool(flags & FLAG_HAS_RECIPIENT)
        has_extensions = bool(flags & FLAG_HAS_EXTENSIONS)
        has_parent = bool(flags & FLAG_HAS_PARENT)

        creator_key = _decode_key_section(r)
        timestamp_us = _decode_timestamp(r)

        if has_parent:
            _decode_parent_hash(r)

        if has_recipient:
            _decode_recipients(r)

        r.read(payload_length)  # Skip payload

        if has_extensions:
            _decode_tlv_extensions(r)

        sig_pos = r.pos
        signature_section = _decode_signature(r)

        signed_bytes = dot_bytes[:sig_pos]
        is_valid = crypto.verify_signature(signed_bytes, signature_section, creator_key)

        return VerifyResult(
            verified=is_valid,
            creator_key=creator_key,
            creator_key_hex=creator_key.hex(),
            timestamp_us=timestamp_us,
            dot_type=dot_type,
            dot_type_name=TYPE_NAMES.get(dot_type, f"UNKNOWN_{dot_type:#04x}"),
            encrypted=is_encrypted,
            dot_hash=dot_hash_bytes,
            dot_hash_hex=dot_hash_bytes.hex(),
            error=None if is_valid else "Signature verification failed",
        )

    except InvalidMagicError as e:
        return VerifyResult(
            verified=False,
            creator_key=b"",
            creator_key_hex="",
            timestamp_us=0,
            dot_type=0,
            dot_type_name="UNKNOWN",
            encrypted=False,
            dot_hash=dot_hash_bytes,
            dot_hash_hex=dot_hash_bytes.hex(),
            error=str(e),
        )
    except Exception as e:
        return VerifyResult(
            verified=False,
            creator_key=b"",
            creator_key_hex="",
            timestamp_us=0,
            dot_type=0,
            dot_type_name="UNKNOWN",
            encrypted=False,
            dot_hash=dot_hash_bytes,
            dot_hash_hex=dot_hash_bytes.hex(),
            error=str(e),
        )


def chain(
    payload: bytes,
    keypair: "crypto.KeyPair",
    parent_dot_bytes: bytes,
    **kwargs,
) -> bytes:
    """
    Create a DOT that references a parent DOT by hash.

    The parent's SHA-256 hash is stored in the PARENT_HASH section.
    This creates a Merkle chain of verifiable history.

    Args:
        payload:          Content of this DOT.
        keypair:          Creator's keypair.
        parent_dot_bytes: Complete bytes of the parent DOT.
        **kwargs:         Additional options (dot_type, recipient_keys, extensions, etc.)

    Returns:
        DOT bytes with parent hash embedded.
    """
    # Verify parent DOT is valid before chaining
    parent_verify = verify(parent_dot_bytes)
    if not parent_verify.verified:
        raise DotError(f"Cannot chain from an invalid parent DOT: {parent_verify.error}")

    return create(payload, keypair, parent=parent_dot_bytes, **kwargs)


def rotate(
    old_keypair: "crypto.KeyPair",
    new_keypair: "crypto.KeyPair",
    timestamp_us: Optional[int] = None,
) -> bytes:
    """
    Create a key rotation DOT proving succession from old key to new key.

    The rotation DOT is signed by the NEW key (as creator).
    The payload contains a rotation_proof signed by the OLD key over the new public key.
    Anyone can verify that the holder of the old key deliberately authorized this transition.

    Returns:
        Rotation DOT bytes. Commit this to the mesh immediately after key transition.
    """
    import json

    # rotation_proof: old_private signs new_public_key
    rotation_proof = crypto.sign(new_keypair.ed25519_public, old_keypair)

    payload = json.dumps({
        "old_public_key": old_keypair.ed25519_public.hex(),
        "new_public_key": new_keypair.ed25519_public.hex(),
        "rotation_proof": rotation_proof.hex(),
    }).encode("utf-8")

    # Signed by the NEW key as creator
    return create(
        payload=payload,
        keypair=new_keypair,
        dot_type=TYPE_ROTATION,
        timestamp_us=timestamp_us,
        extensions={TLV_CONTENT_TYPE: b"application/json"},
    )
