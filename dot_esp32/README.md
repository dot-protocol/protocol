# DOT Protocol — ESP32 Energy Observer

Build 2: DC motor shaft -> Ed25519-signed DOT chain on ESP32

---

## Wiring

```
  DC Motor (voltage divider output)
       |
       +-- 100kOhm --+-- GPIO34 (ADC1_CH6)
       |              |
      GND           10kOhm
                      |
                     GND

  +--------------------------------------------------------------+
  |  ESP32 DevKit                                                 |
  |                                                               |
  |  GPIO34 <-- Motor voltage (via divider, max 3.3V input)      |
  |  GPIO2  --> Built-in LED (blinks on each DOT signed)         |
  |  3V3    --> VCC for external sensors (optional)              |
  |  GND    --> GND                                               |
  |                                                               |
  |  USB --> Serial 115200 baud                                   |
  +--------------------------------------------------------------+

  SAFETY: ESP32 ADC pins tolerate max 3.3V. If motor voltage > 3.3V,
  use voltage divider: R1=100kOhm (high side), R2=10kOhm (low side).
  Output = Vin * R2 / (R1 + R2) = Vin * 10/110 ~= Vin/11.
  For 12V motor: 12 * 10/110 = 1.09V (safe).
  Adjust R values for your motor's max voltage.
```

---

## Arduino IDE Setup

1. **Install ESP32 board package**
   - Preferences -> Additional Board Manager URLs:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Tools -> Board Manager -> search "esp32" -> install "esp32 by Espressif Systems"

2. **Install libraries** (Sketch -> Include Library -> Manage Libraries)
   - Search "arduinolibs" by rweather -- install "Crypto" (includes Ed25519 + SHA256)
   - Alternatively, install from GitHub: https://github.com/rweather/arduinolibs
     - Clone/download -> copy `libraries/Crypto` and `libraries/Ed25519` to Arduino libraries folder

3. **Select board**
   - Tools -> Board -> ESP32 Arduino -> ESP32 Dev Module
   - Tools -> Partition Scheme -> Default 4MB with spiffs

4. **Open project**
   - File -> Open -> navigate to `dot_esp32/dot_esp32.ino`

5. **Upload**
   - Select correct port (Tools -> Port)
   - Click Upload

---

## First Boot Expected Output

```
=== DOT Protocol Build 2 -- ESP32 Energy Observer ===
SPIFFS: mounted
KEYPAIR: generating new identity...
KEYPAIR: saved to SPIFFS
PUBKEY: a3f8c2d1e4b5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
CHAIN: 0 DOTs in SPIFFS
READY. Commands: CHAIN | VERIFY
=================================================
GENESIS: signing first DOT...
DOT 1 [306 hex chars]
  genesis  ts=2026-03-17 12:00:00.123 UTC  voltage=824mV  rpm=0
```

---

## Subsequent Boot Expected Output

```
=== DOT Protocol Build 2 -- ESP32 Energy Observer ===
SPIFFS: mounted
KEYPAIR: loaded from SPIFFS
PUBKEY: a3f8c2d1e4b5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
CHAIN: 42 DOTs in SPIFFS
CHAIN_HEAD: 7b2c4e1f8a9d3b5c6f0e2a4d8b1c5f7e9a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0
READY. Commands: CHAIN | VERIFY
=================================================
DOT 43 [306 hex chars]
  ts=2026-03-17 12:05:23.456 UTC  voltage=1240mV  rpm=312
```

---

## Serial Commands

| Command  | Response                                                          |
|----------|-------------------------------------------------------------------|
| `CHAIN`  | `CHAIN:N` header then N lines x 306 hex chars                    |
| `VERIFY` | `DOT 1: PASS`, `DOT 2: FAIL (signature)` etc. + `RESULT: N/N PASS` |

---

## Host Verification

```bash
pip install pyserial cryptography

# Live from serial port
python dot_verify.py /dev/tty.usbserial-0001 115200

# From saved hex dump
python dot_verify.py --file chain.hex
```

---

## SPIFFS Files

| File           | Size      | Contents                                        |
|----------------|-----------|-------------------------------------------------|
| `/keypair.bin` | 64B       | 32B private key seed + 32B public key           |
| `/chain.bin`   | N x 153B  | Append-only DOT chain                           |

**The private key never leaves the device.**

---

## DOT Wire Format (153 bytes)

```
[0..31]    pubkey   32B  Ed25519 public key
[32..95]   sig      64B  Ed25519 signature
[96..127]  chain    32B  SHA-256(prev DOT bytes), or 32 zero bytes for genesis
[128..135] ts        8B  Unix ms big-endian int64
[136]      type      1B  0x00=public, 0x01=circle, 0x02=private, 0x03=ephemeral
[137..152] payload  16B  energy: voltage_mv(2B) + rpm_est(2B) + adc_pin(1B) + sensor_type(1B) + padding(10B)
```

Signed bytes = pubkey(32) + chain(32) + ts(8) + type(1) + payload(16) = 89 bytes

---

## SPIFFS Capacity

Default ESP32 4MB partition scheme allocates 1.5MB to SPIFFS.
153 bytes per DOT -> ~10,000 DOTs before full.
At 5-second interval -> ~14 hours of continuous data.
To extend: use larger SPIFFS partition scheme (Tools -> Partition Scheme -> Huge APP + SPIFFS).
