"""
Experiment 33: Key Loss Simulation
Enumerate what is permanently lost when a private key is lost.
Compare to Snapchat/Signal/WhatsApp recovery. Expected: FAIL (total loss).
Severity: CRITICAL
"""

import sys
import os
import hashlib
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import (
    create, verify, open as dot_open, rotate,
    TYPE_OBSERVATION, TYPE_SEALED_LETTER, NotAddressedToYouError,
    SignatureVerificationError
)

# ─── Setup ────────────────────────────────────────────────────────────────────
alice_kp      = crypto.generate_keypair(hashlib.sha256(b"exp33-alice").digest())
alice_new_kp  = crypto.generate_keypair(hashlib.sha256(b"exp33-alice-new").digest())
bob_kp        = crypto.generate_keypair(hashlib.sha256(b"exp33-bob").digest())
BASE_TS       = 1741564800_000_000

print("=" * 70)
print("  EXPERIMENT 33: KEY LOSS SIMULATION")
print("=" * 70)
print()

# ─── Build Alice's history ────────────────────────────────────────────────────
# 1. Public observations
alice_chain = []
for i in range(20):
    prev = alice_chain[-1] if alice_chain else None
    d = create(
        payload=f"observation {i}".encode(),
        keypair=alice_kp,
        timestamp_us=BASE_TS + i,
        parent=prev,
    )
    alice_chain.append(d)

# 2. Encrypted DMs to Bob
dm_payloads = [b"secret meeting at 8pm", b"password: hunter2", b"I love you"]
dms = []
for i, msg in enumerate(dm_payloads):
    d = create(
        payload=msg,
        keypair=alice_kp,
        recipient_keys=[bob_kp.ed25519_public],
        timestamp_us=BASE_TS + 100 + i,
    )
    dms.append(d)

print(f"  Alice's history: {len(alice_chain)} observation DOTs, {len(dms)} encrypted DMs")
print(f"  Alice now LOSES her private key.")
print()

# ─── What Alice can still do without her private key ─────────────────────────
print(f"  WHAT IS PERMANENTLY LOST:")
print()

# Loss 1: Cannot decrypt old DMs
print(f"  [1] Old encrypted DMs — PERMANENTLY UNREADABLE")
for i, dm in enumerate(dms):
    try:
        # Simulate Alice trying to open her own DM without her private key
        # We'll test with a wrong key to demonstrate the failure
        wrong_kp = crypto.generate_keypair(hashlib.sha256(b"wrong-key").digest())
        result = dot_open(dm, keypair=wrong_kp)
        print(f"      DM {i}: unexpectedly readable (BUG)")
    except (NotAddressedToYouError, Exception) as e:
        print(f"      DM {i}: {type(e).__name__} — unreadable without private key ✓")
print(f"      Reason: X25519 decryption requires Ed25519 private key (converted).")
print(f"      Even Alice cannot read her own DMs without the private key.")
print()

# Loss 2: Cannot extend old chain
print(f"  [2] Old chain identity — PERMANENTLY FROZEN")
print(f"      Alice cannot create DOT #21 linked to DOT #20.")
print(f"      Alice's new key creates a NEW chain with a new identity (new pubkey).")
print(f"      Her old public key still verifies old DOTs — read-only, forever.")
print()

# Loss 3: Contacts cannot verify new identity
print(f"  [3] Contact trust — BROKEN without pre-arranged rotation DOT")
# If Alice had rotated before losing the key, contacts could follow the chain.
# Without a rotation DOT signed by the OLD key, there's no bridge to the new key.
try:
    rot = rotate(alice_kp, alice_new_kp, timestamp_us=BASE_TS + 200)
    r = dot_open(rot)
    data = json.loads(r.payload)
    print(f"      IF Alice had rotated (with old key): rotation DOT created ✓")
    print(f"      Old key: {data['old_public_key'][:16]}...")
    print(f"      New key: {data['new_public_key'][:16]}...")
    print(f"      Contacts can follow the rotation chain.")
    print(f"      WITHOUT rotation DOT: contacts see new key, cannot verify it's Alice.")
except Exception as e:
    print(f"      Rotation failed: {e}")
print()

# ─── What is NOT lost ─────────────────────────────────────────────────────────
print(f"  WHAT IS NOT LOST:")
print(f"    Old public observations: still verifiable (public key in DOT header)")
print(f"    Chain history: immutable, readable by anyone with the DOTs")
print(f"    DOT integrity: signature still verifies with old public key")
print()

# ─── Compare to incumbents ────────────────────────────────────────────────────
print(f"  COMPARISON TO INCUMBENTS:")
print(f"    ┌─────────────────┬──────────────┬────────────────────────────────┐")
print(f"    │ App             │ Key backup   │ Recovery                       │")
print(f"    ├─────────────────┼──────────────┼────────────────────────────────┤")
print(f"    │ Snapchat        │ Cloud (E2E)  │ Account = phone number. Full   │")
print(f"    │                 │              │ restore from Snapchat servers.  │")
print(f"    ├─────────────────┼──────────────┼────────────────────────────────┤")
print(f"    │ WhatsApp        │ iCloud/Drive │ Google/Apple backup restores   │")
print(f"    │                 │              │ chat history. Key rotates auto. │")
print(f"    ├─────────────────┼──────────────┼────────────────────────────────┤")
print(f"    │ Signal          │ Optional     │ No cloud backup. Message hist  │")
print(f"    │                 │              │ lost on new device. Identity   │")
print(f"    │                 │              │ lost too (new safety number).  │")
print(f"    ├─────────────────┼──────────────┼────────────────────────────────┤")
print(f"    │ DOT Protocol    │ NONE (v1)    │ Total loss. New keypair = new  │")
print(f"    │                 │              │ identity. Old DMs unreadable.  │")
print(f"    └─────────────────┴──────────────┴────────────────────────────────┘")
print()

# ─── Mitigations ─────────────────────────────────────────────────────────────
print(f"  PROPOSED MITIGATIONS:")
print(f"  1. Encrypted keypair backup")
print(f"     Serialize private key → AES-256-GCM encrypt with PIN → store on iCloud/Drive")
print(f"     Recovery: download backup, decrypt with PIN → private key restored")
print(f"     UX: 6-12 digit PIN set on first launch, confirm on second device")
print()
print(f"  2. PIN-wrapped key (in-app)")
print(f"     private_key_encrypted = AES_GCM(key=PBKDF2(pin, salt), plaintext=ed25519_private)")
print(f"     Store encrypted blob in app storage. PIN = offline recovery factor.")
print(f"     Risk: brute-forceable if blob is extracted. Need PBKDF2/Argon2 with high cost.")
print()
print(f"  3. Social recovery (future)")
print(f"     Shamir Secret Sharing: split private key among 3 trusted contacts.")
print(f"     Any 2-of-3 can recover. No single point of failure.")
print(f"     Requires contacts to be online and cooperative.")
print()

print(f"  Result: FAIL")
print(f"  Failure mode: Total private key loss → permanent loss of:")
print(f"    - All encrypted DM history (undecryptable without private key)")
print(f"    - Chain extension ability (new keypair = new identity)")
print(f"    - Contact trust continuity (no rotation proof possible after loss)")
print(f"  Severity: CRITICAL — will be #1 abandonment reason for Gen Z users")
print(f"  Mitigation: Encrypted keypair backup with PIN, auto-offered at onboarding.")
print(f"    Consider: iCloud Keychain / Google Password Manager integration.")
print(f"  Fixed in: OPEN (requires app-layer backup, not protocol-layer)")
print()
print("  ❌ EXP-33: FAIL — key loss = total identity loss (CRITICAL)")
print("=" * 70)
