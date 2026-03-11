"""
Experiment 29: Replay Attack
Tests three detection methods:
  a) Hash-based dedup
  b) Chain position check (chain advanced, old DOT is stale)
  c) Cross-context replay (same DOT bytes, different conversation tag)
"""

import sys
import os
import hashlib
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as dot_open, TYPE_OBSERVATION

# ─── Keypairs ─────────────────────────────────────────────────────────────────
alice_kp = crypto.generate_keypair(hashlib.sha256(b"exp29-alice").digest())
bob_kp   = crypto.generate_keypair(hashlib.sha256(b"exp29-bob").digest())

BASE_TS = 1741564800_000_000

print("=" * 70)
print("  EXPERIMENT 29: REPLAY ATTACK")
print("=" * 70)
print()

# ─── Setup: Alice seals a chain of 50 DOTs ───────────────────────────────────
chain = []
d0 = create(
    payload=b"I agree to pay Bob 100 USDC",
    keypair=alice_kp,
    timestamp_us=BASE_TS,
)
chain.append(d0)

for i in range(1, 50):
    d = create(
        payload=f"message {i}".encode(),
        keypair=alice_kp,
        timestamp_us=BASE_TS + i * 1_000_000,
        parent=chain[-1],
    )
    chain.append(d)

dot1 = chain[0]
dot1_hash = crypto.dot_hash(dot1)

# ─── Detection method (a): Hash-based dedup ───────────────────────────────────
seen_hashes = set()

def process_dot_dedup(dot_bytes):
    h = crypto.dot_hash(dot_bytes)
    if h in seen_hashes:
        return False, "REPLAY: hash already seen"
    seen_hashes.add(h)
    return True, "accepted"

# First presentation — should accept
ok1, msg1 = process_dot_dedup(dot1)
# Re-broadcast (attacker replays exact bytes)
ok2, msg2 = process_dot_dedup(dot1)

dedup_works = ok1 and not ok2
print(f"  (a) Hash-based dedup:")
print(f"      First arrival:     {msg1} → {'✓' if ok1 else '✗'}")
print(f"      Replay (same hash): {msg2} → {'✓' if not ok2 else '✗'} (rejected = good)")
print(f"      Detection:         {'PASS' if dedup_works else 'FAIL'}")
print()

# ─── Detection method (b): Chain position check ───────────────────────────────
# Chain is now at DOT #49. DOT #0 (signed agreement) is replayed.
current_chain_tip_index = 49
current_tip_hash = crypto.dot_hash(chain[49])

def process_dot_chain_check(dot_bytes, current_tip_index, current_tip_hash):
    """Check if DOT is the expected next link. Stale DOTs (earlier chain position) rejected."""
    r = dot_open(dot_bytes)
    # If it has a parent hash, check if that parent is our current tip
    if r.parent_hash is None:
        # It's a genesis DOT — only valid if chain is empty
        if current_tip_index > 0:
            return False, f"REPLAY: genesis DOT replayed on chain at position {current_tip_index}"
        return True, "accepted (genesis)"
    # For chained DOTs: parent_hash must equal current_tip_hash
    if r.parent_hash != current_tip_hash:
        return False, f"STALE: DOT's parent is not current tip"
    return True, "accepted"

# Try to replay DOT #0 (the agreement)
ok3, msg3 = process_dot_chain_check(dot1, current_chain_tip_index, current_tip_hash)
# Try to replay DOT #25 (somewhere in middle)
dot25_result = dot_open(chain[25])
ok4, msg4 = process_dot_chain_check(chain[25], current_chain_tip_index, current_tip_hash)
# The actual next DOT (DOT #49 is tip, but for test: what would #50 look like)
# We check that DOT #49 itself isn't accepted as #50 (it has parent #48, not #49)
ok5, msg5 = process_dot_chain_check(chain[49], current_chain_tip_index, current_tip_hash)

chain_check_works = not ok3 and not ok4 and not ok5
print(f"  (b) Chain position check (chain at DOT #49):")
print(f"      Replay DOT #0  (genesis):  {msg3} → {'✓' if not ok3 else '✗'} (rejected = good)")
print(f"      Replay DOT #25 (middle):   {msg4} → {'✓' if not ok4 else '✗'} (rejected = good)")
print(f"      Replay DOT #49 (current tip): {msg5} → {'✓' if not ok5 else '✗'} (rejected = good)")
print(f"      Detection:                 {'PASS' if chain_check_works else 'FAIL'}")
print()

# ─── Detection method (c): Cross-context replay ───────────────────────────────
# The DOT is valid cryptographically in ANY context. The conversation_tag is in the
# payload, not the DOT header. If the payload doesn't contain a context binding,
# the same DOT bytes are valid in any conversation.

# DOT #0 was created for "Bob payment" context — no context binding in header
# Attacker uses same DOT bytes in a different conversation context

def process_dot_cross_context(dot_bytes, expected_context_tag):
    """
    Attempt to verify context binding. DOT protocol has NO built-in context tag.
    The payload must contain a context binding — pure convention, not enforced by wire format.
    """
    r = dot_open(dot_bytes)
    # Try to extract context from payload (if payload is JSON with context field)
    try:
        data = json.loads(r.payload)
        embedded_context = data.get("context")
        if embedded_context != expected_context_tag:
            return False, f"CONTEXT MISMATCH: DOT context={embedded_context!r}, expected={expected_context_tag!r}"
        return True, "accepted (context verified)"
    except (json.JSONDecodeError, UnicodeDecodeError):
        # Payload is not JSON — no context binding possible
        return None, "NO CONTEXT BINDING: raw payload, context cannot be verified"

ok6, msg6 = process_dot_cross_context(dot1, "alice-bob-payment-channel-2026")

is_genuine_vulnerability = ok6 is None  # raw payload → no context binding

print(f"  (c) Cross-context replay:")
print(f"      DOT #0 payload: {repr(dot_open(dot1).payload[:40])}")
print(f"      Context check:  {msg6}")
print()
print(f"      GENUINE VULNERABILITY: {'YES' if is_genuine_vulnerability else 'NO'}")
print()
print(f"  ANALYSIS:")
print(f"    The cross-context replay IS a genuine vulnerability.")
print(f"    DOT wire format has no context tag in the header.")
print(f"    Same DOT bytes (correct signature) are valid in any context.")
print(f"    Mitigation: Application MUST embed context in payload (JSON convention).")
print(f"    Example: {{'context': 'alice-bob-channel-uuid', 'text': 'pay 100 USDC'}}")
print(f"    Or: use TLV_NAMESPACE extension tag (0x000A) as context binding.")
print(f"    The protocol does not enforce this — it is an application responsibility.")
print()

# ─── Final verdict ────────────────────────────────────────────────────────────
print(f"  RESULTS SUMMARY:")
print(f"    (a) Hash dedup:      {'PASS' if dedup_works else 'FAIL'} — trivially effective")
print(f"    (b) Chain position:  {'PASS' if chain_check_works else 'FAIL'} — effective for single chains")
print(f"    (c) Cross-context:   VULNERABILITY — same DOT valid in any context")
print()
print(f"  Result: PARTIAL — (a) and (b) work, (c) is a genuine protocol gap.")
print("=" * 70)
