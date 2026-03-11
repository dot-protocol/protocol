"""
EXP-50: 153 DOT OVER SMS
Encode minimum DOT as Base64, verify SMS transport and round-trip.
"""

import sys, os, base64, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from dot_protocol import crypto
from dot_protocol.container import create, verify, open as open_dot, TYPE_OBSERVATION

print("=" * 65)
print("  EXPERIMENT 50: DOT OVER SMS")
print("=" * 65)
print()

# Generate minimum DOT
seed = hashlib.sha256(b"sms-transport-test").digest()
kp = crypto.generate_keypair(seed)

# Payload: ◉ (the DOT symbol, U+25C9)
PAYLOAD = "◉".encode("utf-8")
payload_bytes = len(PAYLOAD)

dot_bytes = create(
    payload=PAYLOAD,
    keypair=kp,
    dot_type=TYPE_OBSERVATION,
    timestamp_us=1741564800_000_000,
)

print(f"Original DOT:")
print(f"  Bytes: {len(dot_bytes)}")
print(f"  Payload: \"◉\" ({payload_bytes} bytes UTF-8)")
print()

# Base64 encode
b64 = base64.b64encode(dot_bytes).decode("ascii")
b64_chars = len(b64)

# SMS capacity
SMS_CHARS = 160  # GSM-7, pure text SMS

sms_needed = (b64_chars + SMS_CHARS - 1) // SMS_CHARS  # ceiling division
sms1_chars = min(b64_chars, SMS_CHARS)
sms2_chars = max(0, b64_chars - SMS_CHARS)

overhead_pct = (b64_chars - len(dot_bytes)) / len(dot_bytes) * 100

print(f"Base64 encoding:")
print(f"  Characters: {b64_chars}")
print(f"  SMS messages needed: {sms_needed} (at 160 chars/SMS)")
print(f"  Characters in SMS 1: {sms1_chars} of {b64_chars}")
if sms2_chars > 0:
    print(f"  Characters in SMS 2: {sms2_chars} of {b64_chars}")
print()

# Round-trip: decode and verify
decoded_bytes = base64.b64decode(b64)
result = verify(decoded_bytes)
dot_open = open_dot(decoded_bytes)

payload_recovered = dot_open.payload.decode("utf-8")
payload_matches = payload_recovered == "◉"
sig_valid = result.verified

print(f"Round-trip:")
print(f"  Decode Base64: DONE")
print(f"  Verify signature: {'VALID' if sig_valid else 'INVALID'}")
print(f"  Payload recovered: \"{payload_recovered}\" {'MATCH' if payload_matches else 'MISMATCH'}")
print()

passed = sms_needed <= 2 and sig_valid and payload_matches

print(f"RESULT: DOT survives SMS round-trip: {'YES' if (sig_valid and payload_matches) else 'NO'}")
print(f"Overhead: Base64 inflates {len(dot_bytes)} bytes → {b64_chars} chars ({overhead_pct:.0f}% overhead)")
print()

if passed:
    print("EXPERIMENT 50 PASSED")
else:
    print(f"EXPERIMENT 50 PARTIAL (sms_needed={sms_needed}, sig={sig_valid}, match={payload_matches})")
print("=" * 65)
