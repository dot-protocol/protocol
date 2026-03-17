#!/usr/bin/env python3
"""
dot_verify.py — DOT Protocol serial chain verifier
Reads DOT chain from ESP32 via serial. Verifies Ed25519 signatures and
SHA-256 chain links. Requires: pip install pyserial cryptography

Usage:
    python dot_verify.py /dev/tty.usbserial-0001 115200
    python dot_verify.py --file chain.hex   # verify offline hex dump
"""

import sys
import hashlib
import argparse
from typing import Optional

# ── Parse args ────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description='DOT Protocol chain verifier')
parser.add_argument('port', nargs='?', default=None,
                    help='Serial port, e.g. /dev/tty.usbserial-0001 or COM3')
parser.add_argument('baud', nargs='?', type=int, default=115200,
                    help='Baud rate (default 115200)')
parser.add_argument('--file', '-f', default=None,
                    help='Verify from offline hex dump file instead of serial')
parser.add_argument('--timeout', '-t', type=int, default=10,
                    help='Seconds to wait for CHAIN response (default 10)')
args = parser.parse_args()

# ── Wire layout constants ─────────────────────────────────────────────────────

DOT_SIZE     = 153
PUBKEY_OFF   = 0    # [0..31]    Ed25519 public key   32B
SIG_OFF      = 32   # [32..95]   Ed25519 signature    64B
CHAIN_OFF    = 96   # [96..127]  SHA-256(prev DOT)    32B
TS_OFF       = 128  # [128..135] Unix ms big-endian    8B
TYPE_OFF     = 136  # [136]      type byte              1B
PAYLOAD_OFF  = 137  # [137..152] payload               16B
SIGNED_SIZE  = 89   # pubkey(32)+chain(32)+ts(8)+type(1)+payload(16)

HEX_LEN = DOT_SIZE * 2  # 306 hex chars per DOT

TYPE_NAMES = {0x00: 'public', 0x01: 'circle', 0x02: 'private', 0x03: 'ephemeral'}

# ── DOT parsing helpers ───────────────────────────────────────────────────────

def parse_dot_hex(line: str) -> Optional[bytes]:
    """Parse a 306-char hex line into 153 raw bytes. Returns None on error."""
    line = line.strip().lower()
    if len(line) != HEX_LEN:
        return None
    try:
        return bytes.fromhex(line)
    except ValueError:
        return None

def extract_fields(dot: bytes):
    """Extract all fields from 153-byte DOT."""
    return {
        'pubkey':  dot[PUBKEY_OFF:PUBKEY_OFF+32],
        'sig':     dot[SIG_OFF:SIG_OFF+64],
        'chain':   dot[CHAIN_OFF:CHAIN_OFF+32],
        'ts':      int.from_bytes(dot[TS_OFF:TS_OFF+8], 'big'),
        'type':    dot[TYPE_OFF],
        'payload': dot[PAYLOAD_OFF:PAYLOAD_OFF+16],
    }

def build_signed_bytes(dot: bytes) -> bytes:
    """Reconstruct the 89 signed bytes from a DOT."""
    out = bytearray(SIGNED_SIZE)
    out[0:32]  = dot[PUBKEY_OFF:PUBKEY_OFF+32]    # pubkey
    out[32:64] = dot[CHAIN_OFF:CHAIN_OFF+32]       # chain
    out[64:72] = dot[TS_OFF:TS_OFF+8]              # ts
    out[72]    = dot[TYPE_OFF]                      # type
    out[73:89] = dot[PAYLOAD_OFF:PAYLOAD_OFF+16]   # payload
    return bytes(out)

def format_ts(ts_ms: int) -> str:
    """Format Unix-ms timestamp as ISO-8601 UTC string."""
    import datetime
    try:
        dt = datetime.datetime.fromtimestamp(ts_ms / 1000.0, tz=datetime.timezone.utc)
        return dt.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + ' UTC'
    except Exception:
        return f'ts_ms={ts_ms}'

def parse_energy_payload(payload: bytes) -> str:
    """Decode energy DOT payload fields."""
    voltage_mv  = (payload[0] << 8) | payload[1]
    rpm_est     = (payload[2] << 8) | payload[3]
    adc_pin     = payload[4]
    sensor_type = payload[5]
    return f'voltage={voltage_mv}mV rpm={rpm_est} pin={adc_pin} sensor=0x{sensor_type:02x}'

# ── Ed25519 verification via PyCA ─────────────────────────────────────────────

def verify_signature(dot: bytes) -> bool:
    """Verify Ed25519 signature of a DOT. Returns True if valid."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature

        pubkey_bytes = dot[PUBKEY_OFF:PUBKEY_OFF+32]
        sig_bytes    = dot[SIG_OFF:SIG_OFF+64]
        signed_bytes = build_signed_bytes(dot)

        pub_key = Ed25519PublicKey.from_public_bytes(pubkey_bytes)
        try:
            pub_key.verify(sig_bytes, signed_bytes)
            return True
        except InvalidSignature:
            return False
    except ImportError:
        print('ERROR: pip install cryptography')
        sys.exit(1)

def sha256_dot(dot: bytes) -> bytes:
    """SHA-256 of a complete 153-byte DOT."""
    return hashlib.sha256(dot).digest()

# ── Chain verification ────────────────────────────────────────────────────────

def verify_chain(dots: list) -> dict:
    """
    Verify a list of raw 153-byte DOTs.
    Returns {
        'total': int,
        'pass': int,
        'fail': int,
        'results': [(index, 'PASS'|'FAIL', reason)]
    }
    """
    results = []
    pass_count = 0
    prev_dot = None

    for i, dot in enumerate(dots):
        if len(dot) != DOT_SIZE:
            results.append((i+1, 'FAIL', f'wrong size {len(dot)} bytes'))
            continue

        fields = extract_fields(dot)

        # 1. Signature check
        if not verify_signature(dot):
            results.append((i+1, 'FAIL', 'signature invalid'))
            continue

        # 2. Chain link check
        if i == 0:
            # Genesis: chain field must be 32 zero bytes
            if fields['chain'] != bytes(32):
                results.append((i+1, 'FAIL', 'genesis chain not zero'))
                continue
        else:
            expected = sha256_dot(prev_dot)
            if fields['chain'] != expected:
                results.append((i+1, 'FAIL',
                    f'chain mismatch — expected {expected.hex()[:16]}... got {fields["chain"].hex()[:16]}...'))
                continue

        # PASS
        results.append((i+1, 'PASS', ''))
        pass_count += 1
        prev_dot = dot

    return {
        'total':   len(dots),
        'pass':    pass_count,
        'fail':    len(dots) - pass_count,
        'results': results,
    }

# ── Collect DOTs from serial ──────────────────────────────────────────────────

def collect_from_serial(port: str, baud: int, timeout: int):
    """
    Send CHAIN command to ESP32, collect hex lines.
    Returns (list of raw DOT bytes, pubkey bytes or None).
    """
    try:
        import serial
    except ImportError:
        print('ERROR: pip install pyserial')
        sys.exit(1)

    print(f'Connecting to {port} at {baud} baud...')
    ser = serial.Serial(port, baud, timeout=timeout)
    ser.reset_input_buffer()

    # Send CHAIN command
    ser.write(b'CHAIN\n')
    ser.flush()

    dots = []
    pubkey = None
    chain_total = None

    while True:
        line = ser.readline().decode('utf-8', errors='replace').strip()
        if not line:
            break

        # PUBKEY line
        if line.startswith('PUBKEY:'):
            pk_hex = line[7:].strip()
            if len(pk_hex) == 64:
                pubkey = bytes.fromhex(pk_hex)
            continue

        # CHAIN:N header
        if line.startswith('CHAIN:'):
            try:
                chain_total = int(line[6:])
                if chain_total == 0:
                    print('CHAIN:0 — no DOTs on device')
                    break
                print(f'Downloading {chain_total} DOTs...')
            except ValueError:
                pass
            continue

        # 306-char hex DOT line
        dot = parse_dot_hex(line)
        if dot is not None:
            dots.append(dot)
            if chain_total is not None and len(dots) >= chain_total:
                break

    ser.close()
    print(f'Received {len(dots)} DOTs.')
    return dots, pubkey

# ── Collect DOTs from hex file ────────────────────────────────────────────────

def collect_from_file(path: str):
    """Load DOTs from a newline-delimited hex file (as produced by CHAIN command)."""
    dots = []
    pubkey = None
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('PUBKEY:'):
                pk_hex = line[7:].strip()
                if len(pk_hex) == 64:
                    pubkey = bytes.fromhex(pk_hex)
                continue
            dot = parse_dot_hex(line)
            if dot is not None:
                dots.append(dot)
    print(f'Loaded {len(dots)} DOTs from {path}.')
    return dots, pubkey

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if args.file:
        dots, pubkey = collect_from_file(args.file)
    elif args.port:
        dots, pubkey = collect_from_serial(args.port, args.baud, args.timeout)
    else:
        print('Usage: dot_verify.py <port> [baud]  OR  dot_verify.py --file chain.hex')
        sys.exit(1)

    if not dots:
        print('CHAIN:0 RESULT: 0/0 PASS')
        return

    if pubkey:
        print(f'Device PUBKEY: {pubkey.hex()[:32]}...')

    print(f'\nVerifying {len(dots)} DOTs...\n')

    result = verify_chain(dots)

    for (idx, status, reason) in result['results']:
        fields = extract_fields(dots[idx - 1])
        ts_str = format_ts(fields['ts'])
        type_name = TYPE_NAMES.get(fields['type'], f'0x{fields["type"]:02x}')
        payload_str = parse_energy_payload(fields['payload'])
        if status == 'PASS':
            print(f'DOT {idx:4d}: PASS  [{ts_str}]  type={type_name}  {payload_str}')
        else:
            print(f'DOT {idx:4d}: FAIL  reason={reason}')

    print(f'\nRESULT: {result["pass"]}/{result["total"]} PASS')
    sys.exit(0 if result['fail'] == 0 else 1)

if __name__ == '__main__':
    main()
