"""
Experiment 34: Metadata Leakage on Nostr
Enumerate ALL metadata visible to a passive Nostr relay observer
even when DOT payloads are fully encrypted.
Compare to Signal's sealed sender. Expected: FAIL (significant leakage).
"""

import sys
import os
import hashlib
import time
import struct

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import (
    create, verify, open as dot_open, TYPE_OBSERVATION
)

# ─── Setup ────────────────────────────────────────────────────────────────────
alice_kp = crypto.generate_keypair(hashlib.sha256(b"exp34-alice").digest())
bob_kp   = crypto.generate_keypair(hashlib.sha256(b"exp34-bob").digest())
BASE_TS  = 1741564800_000_000

FIXED_OVERHEAD = 12 + 35 + 8 + 96 + 28 + 67  # 246 bytes for 1 recipient

print("=" * 70)
print("  EXPERIMENT 34: METADATA LEAKAGE ON NOSTR")
print("=" * 70)
print()

# ─── Build a realistic DM conversation: 20 messages, varying lengths ──────────
messages = [
    b"hey",
    b"what are you up to tonight?",
    b"we should meet, I have something important to discuss about the axxis project",
    b"ok",
    b"7pm works",
    b"can you bring the laptop with the keys",
    b"yes, the wallet keys - but don't say that over text",
    b"lol too late, we are using the dot protocol",
    b"is this actually private?",
    b"the content yes, but not the metadata",
    b"what metadata?",
    b"read exp34 when it runs",
    b"ok",
    b"wait are they watching right now?",
    b"a passive relay observer sees everything I'm about to enumerate",
    b"ok show me",
    b"1. your public key - that's your identity, forever pseudonymous",
    b"2. my public key - they know who I am too",
    b"3. timestamps of every message - relationship activity patterns",
    b"4. message sizes - short=emoji, long=paragraph, they know",
]

dms = []
prev = None
for i, msg in enumerate(messages):
    d = create(
        payload=msg,
        keypair=alice_kp,
        recipient_keys=[bob_kp.ed25519_public],
        timestamp_us=BASE_TS + i * 30_000_000,  # 30s apart
    )
    dms.append(d)

print(f"  Simulated conversation: {len(dms)} encrypted DMs between Alice and Bob")
print(f"  All payloads encrypted with AES-256-GCM. Content is private.")
print()

# ─── What a passive Nostr relay observer can extract ─────────────────────────
print(f"  METADATA VISIBLE TO PASSIVE RELAY OBSERVER:")
print(f"  (Observer never has Alice or Bob's private key)")
print()

leakage_items = []

# Parse the raw DOT bytes WITHOUT decrypting — as an attacker would
for i, dot_bytes in enumerate(dms):
    # Parse fixed header manually (12 bytes)
    magic    = dot_bytes[0:4]
    version  = dot_bytes[4]
    suite    = dot_bytes[5]
    flags    = dot_bytes[6]
    dot_type = dot_bytes[7]
    payload_length = struct.unpack(">I", dot_bytes[8:12])[0]

    # Parse CREATOR_KEY section (12 → 12+35 = offset 47)
    key_type_byte = dot_bytes[12]
    key_len = struct.unpack(">H", dot_bytes[13:15])[0]
    creator_pubkey = dot_bytes[15:15+key_len]  # 32 bytes

    # Parse TIMESTAMP (offset 47 → 47+8 = 55)
    ts_offset = 12 + 35  # = 47
    timestamp_us = struct.unpack(">q", dot_bytes[ts_offset:ts_offset+8])[0]

    # Parse RECIPIENTS section (offset 55 → 55+1+95 = 151)
    rec_offset = ts_offset + 8  # 55
    count = dot_bytes[rec_offset]
    # First recipient: KEY_TYPE(1) + KEY_LENGTH(2) + PUBLIC_KEY(32) + ENCRYPTED_SK(60) = 95
    rec_start = rec_offset + 1
    rec_key_type = dot_bytes[rec_start]
    rec_key_len  = struct.unpack(">H", dot_bytes[rec_start+1:rec_start+3])[0]
    recipient_pubkey = dot_bytes[rec_start+3:rec_start+3+rec_key_len]  # 32 bytes

    # Infer plaintext length from payload_length
    # PAYLOAD_LENGTH = nonce(12) + ciphertext + tag(16) → plaintext = payload_length - 28
    inferred_plaintext_len = payload_length - 28

    leakage_items.append({
        "msg_index": i,
        "creator_pubkey_hex": creator_pubkey.hex()[:16] + "...",
        "recipient_pubkey_hex": recipient_pubkey.hex()[:16] + "...",
        "timestamp_us": timestamp_us,
        "inferred_plaintext_len": inferred_plaintext_len,
        "actual_payload": messages[i],
        "dot_size": len(dot_bytes),
    })

# Print what observer learns
print(f"  {'#':>3}  {'Alice pubkey':>20}  {'Bob pubkey':>20}  {'Timestamp':>10}  {'Inferred len':>12}  {'Actual len':>10}")
print(f"  {'-'*3}  {'-'*20}  {'-'*20}  {'-'*10}  {'-'*12}  {'-'*10}")
for item in leakage_items:
    ts_str = str(item['timestamp_us'])[:10]  # first 10 digits = seconds since epoch
    print(f"  {item['msg_index']:>3}  {item['creator_pubkey_hex']:>20}  "
          f"{item['recipient_pubkey_hex']:>20}  {ts_str:>10}  "
          f"{item['inferred_plaintext_len']:>12}  {len(item['actual_payload']):>10}")

print()

# ─── Compute relationship intensity metric ────────────────────────────────────
# Attacker can infer: these two pubkeys talk 20 times per 10 minutes → high intensity
total_duration_s = (leakage_items[-1]["timestamp_us"] - leakage_items[0]["timestamp_us"]) / 1_000_000
msgs_per_minute = len(dms) / (total_duration_s / 60)
print(f"  RELATIONSHIP INTENSITY (derived from metadata alone):")
print(f"    {len(dms)} messages in {total_duration_s:.0f}s = {msgs_per_minute:.1f} messages/minute")
print(f"    Conclusion: high-frequency relationship, active conversation")
print()

# ─── Enumerated leakage fields ────────────────────────────────────────────────
print(f"  COMPLETE METADATA LEAKAGE CATALOGUE:")
leakage_fields = [
    ("Alice's pubkey (identity)", "CRITICAL", "permanent pseudonym, linkable across all DOTs"),
    ("Bob's pubkey (#p tag/recipient)", "CRITICAL", "reveals who is communicating"),
    ("Timestamp (microsecond UTC)", "HIGH",     "message timing, active hours, time zone"),
    ("DOT size → plaintext length", "HIGH",     "length pattern (short=emoji, long=essay)"),
    ("Message frequency", "HIGH",               "relationship intensity, conversation patterns"),
    ("Relay URL", "MEDIUM",                     "geography proxy, ISP, jurisdiction"),
    ("Chain position (prev_hash)", "LOW",       "sequential ordering, conversation threading"),
    ("DOT type byte", "LOW",                    "SEALED_LETTER reveals this is a private DM"),
    ("Recipient count", "LOW",                  "1:1 vs group DM vs broadcast"),
]
for field, severity, implication in leakage_fields:
    print(f"    [{severity:>8}] {field}")
    print(f"             → {implication}")

print()

# ─── Compare to Signal's sealed sender ────────────────────────────────────────
print(f"  COMPARISON TO SIGNAL'S METADATA PROTECTION:")
print(f"    ┌─────────────────────────────┬──────────────┬──────────────┐")
print(f"    │ Metadata field              │ DOT/Nostr    │ Signal       │")
print(f"    ├─────────────────────────────┼──────────────┼──────────────┤")
print(f"    │ Sender identity             │ VISIBLE      │ HIDDEN*      │")
print(f"    │ Recipient identity          │ VISIBLE      │ HIDDEN*      │")
print(f"    │ Timestamp                   │ VISIBLE      │ server-only  │")
print(f"    │ Message length              │ VISIBLE      │ PADDED       │")
print(f"    │ Relationship graph          │ VISIBLE      │ HIDDEN*      │")
print(f"    └─────────────────────────────┴──────────────┴──────────────┘")
print(f"    * Signal sealed sender: server sees recipient, not sender.")
print(f"      Signal server sees message size after padding (fixed buckets).")
print(f"      DOT/Nostr: relay sees everything above. No sealed sender equivalent.")
print()

print(f"  Result: FAIL")
print(f"  Failure mode: 9 metadata fields are visible to any passive relay observer")
print(f"  even when DOT payloads are fully encrypted. The most damaging: sender")
print(f"  identity, recipient identity, timing, and message length — together they")
print(f"  expose the social graph and conversation patterns without breaking encryption.")
print(f"  Severity: HIGH — undermines 'private messaging' use case")
print(f"  Mitigation:")
print(f"    Short term: payload padding (EXP-31 fix), minimize retention on relays")
print(f"    Long term: sealed sender equivalent (Noise Protocol XX pattern),")
print(f"    onion routing (Tor-style), or decoy traffic injection")
print(f"  Fixed in: OPEN (requires transport-layer redesign)")
print()
print("  ❌ EXP-34: FAIL — significant metadata leakage to passive observers")
print("=" * 70)
