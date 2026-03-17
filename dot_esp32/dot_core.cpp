// projects/dot-protocol/dot_esp32/dot_core.cpp
#include "dot_core.h"

// ── Keypair management ───────────────────────────────────────────────────────

bool dot_load_keypair(DotKeypair& kp) {
    if (!SPIFFS.exists(KEYPAIR_PATH)) return false;
    File f = SPIFFS.open(KEYPAIR_PATH, FILE_READ);
    if (!f) return false;
    size_t r = f.read((uint8_t*)&kp, sizeof(DotKeypair));
    f.close();
    return (r == sizeof(DotKeypair));
}

void dot_generate_keypair(DotKeypair& kp) {
    // Arduino-Ed25519 generates a keypair from a 32-byte random private seed.
    // Ed25519::generatePrivateKey fills kp.privateKey with random bytes.
    // Ed25519::derivePublicKey computes kp.publicKey from kp.privateKey.
    Ed25519::generatePrivateKey(kp.privateKey);
    Ed25519::derivePublicKey(kp.publicKey, kp.privateKey);
}

bool dot_save_keypair(const DotKeypair& kp) {
    File f = SPIFFS.open(KEYPAIR_PATH, FILE_WRITE);
    if (!f) return false;
    f.write((const uint8_t*)&kp, sizeof(DotKeypair));
    f.close();
    return true;
}

// ── Big-endian helpers ───────────────────────────────────────────────────────

void dot_write_u16_be(uint8_t* buf, size_t off, uint16_t val) {
    buf[off]     = (uint8_t)(val >> 8);
    buf[off + 1] = (uint8_t)(val & 0xFF);
}

uint16_t dot_read_u16_be(const uint8_t* buf, size_t off) {
    return ((uint16_t)buf[off] << 8) | buf[off + 1];
}

void dot_write_ts_be(DotBuffer dot, uint64_t ts_ms) {
    // Write 8 bytes big-endian at TS_OFF
    for (int i = 7; i >= 0; i--) {
        dot[TS_OFF + i] = (uint8_t)(ts_ms & 0xFF);
        ts_ms >>= 8;
    }
}

uint64_t dot_read_ts_be(const DotBuffer dot) {
    uint64_t ts = 0;
    for (int i = 0; i < 8; i++) {
        ts = (ts << 8) | dot[TS_OFF + i];
    }
    return ts;
}

// ── Signed bytes extraction ───────────────────────────────────────────────────
// Signed bytes = pubkey(32) + chain(32) + ts(8) + type(1) + payload(16) = 89 bytes

void dot_build_signed_bytes(const DotBuffer dot, uint8_t out[SIGNED_SIZE]) {
    memcpy(out,      dot + PUBKEY_OFF,  32);  // pubkey
    memcpy(out + 32, dot + CHAIN_OFF,   32);  // chain
    memcpy(out + 64, dot + TS_OFF,       8);  // ts
    out[72] = dot[TYPE_OFF];                  // type
    memcpy(out + 73, dot + PAYLOAD_OFF, 16);  // payload
}

// ── Energy payload packing ────────────────────────────────────────────────────

void dot_pack_energy_payload(DotBuffer dot, const EnergyPayload& ep) {
    uint8_t* p = dot + PAYLOAD_OFF;
    memset(p, 0, 16);
    dot_write_u16_be(p, 0, ep.voltage_mv);   // bytes 0-1
    dot_write_u16_be(p, 2, ep.rpm_est);      // bytes 2-3
    p[4] = ep.adc_pin;                        // byte 4
    p[5] = ep.sensor_type;                    // byte 5
    // bytes 6-15 remain zero (padding)
}

// ── SHA-256 chain hash ────────────────────────────────────────────────────────

void dot_hash(const DotBuffer dot, uint8_t out_hash[32]) {
    SHA256 hasher;
    hasher.update(dot, DOT_SIZE);
    hasher.finalize(out_hash, 32);
}

// ── Sign a DOT buffer in-place ────────────────────────────────────────────────

void dot_sign(DotBuffer dot, const DotKeypair& kp,
              const uint8_t prev_chain[32],
              uint64_t ts_ms, uint8_t type,
              const uint8_t payload[16]) {
    // 1. Zero-fill the entire buffer
    memset(dot, 0, DOT_SIZE);

    // 2. pubkey [0..31]
    memcpy(dot + PUBKEY_OFF, kp.publicKey, 32);

    // 3. chain [96..127]: SHA-256(prev DOT bytes) or 32 zero bytes for genesis
    if (prev_chain != nullptr) {
        memcpy(dot + CHAIN_OFF, prev_chain, 32);
    }
    // else genesis: already zeroed

    // 4. timestamp [128..135] big-endian uint64
    dot_write_ts_be(dot, ts_ms);

    // 5. type [136]
    dot[TYPE_OFF] = type;

    // 6. payload [137..152]
    if (payload != nullptr) {
        memcpy(dot + PAYLOAD_OFF, payload, 16);
    }

    // 7. Build signed bytes (89 bytes)
    uint8_t signed_bytes[SIGNED_SIZE];
    dot_build_signed_bytes(dot, signed_bytes);

    // 8. Sign: Ed25519::sign(signature, privateKey, publicKey, message, messageLen)
    // sig goes into [32..95]
    Ed25519::sign(dot + SIG_OFF, kp.privateKey, kp.publicKey, signed_bytes, SIGNED_SIZE);
}

// ── Signature verification ────────────────────────────────────────────────────

bool dot_verify_sig(const DotBuffer dot) {
    uint8_t signed_bytes[SIGNED_SIZE];
    dot_build_signed_bytes(dot, signed_bytes);
    // Ed25519::verify(signature, publicKey, message, messageLen) → true/false
    return Ed25519::verify(dot + SIG_OFF, dot + PUBKEY_OFF, signed_bytes, SIGNED_SIZE);
}

// ── Chain SPIFFS storage ──────────────────────────────────────────────────────

bool dot_append_chain(const DotBuffer dot) {
    File f = SPIFFS.open(CHAIN_PATH, FILE_APPEND);
    if (!f) return false;
    size_t written = f.write(dot, DOT_SIZE);
    f.close();
    return (written == DOT_SIZE);
}

size_t dot_chain_count() {
    if (!SPIFFS.exists(CHAIN_PATH)) return 0;
    File f = SPIFFS.open(CHAIN_PATH, FILE_READ);
    if (!f) return 0;
    size_t sz = f.size();
    f.close();
    return sz / DOT_SIZE;
}

bool dot_read_dot(size_t index, DotBuffer out) {
    File f = SPIFFS.open(CHAIN_PATH, FILE_READ);
    if (!f) return false;
    f.seek(index * DOT_SIZE);
    size_t r = f.read(out, DOT_SIZE);
    f.close();
    return (r == DOT_SIZE);
}

// ── Print helpers ─────────────────────────────────────────────────────────────

void dot_print_hex(const uint8_t* buf, size_t len) {
    for (size_t i = 0; i < len; i++) {
        if (buf[i] < 0x10) Serial.print('0');
        Serial.print(buf[i], HEX);
    }
}

void dot_println_dot_hex(const DotBuffer dot) {
    dot_print_hex(dot, DOT_SIZE);
    Serial.println();
}

// ── Timestamp formatter ───────────────────────────────────────────────────────
// Formats Unix ms as ISO-8601-ish string: "YYYY-MM-DD HH:MM:SS.mmm UTC"
// ESP32 has no RTC — we use millis() as offset from compile time if NTP unavailable.
// Output in buf must be at least 32 bytes.

void dot_ts_to_str(uint64_t ts_ms, char* buf, size_t buflen) {
    // ts_ms is seconds since epoch in millis
    uint64_t ts_sec = ts_ms / 1000;
    uint32_t ms     = (uint32_t)(ts_ms % 1000);

    // Simple epoch breakdown (no DST, UTC only)
    uint32_t s  = (uint32_t)(ts_sec % 60); ts_sec /= 60;
    uint32_t m  = (uint32_t)(ts_sec % 60); ts_sec /= 60;
    uint32_t h  = (uint32_t)(ts_sec % 24); ts_sec /= 24;

    // Days since 1970-01-01
    uint32_t days = (uint32_t)ts_sec;
    uint32_t year = 1970;
    while (true) {
        uint32_t days_in_year = ((year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) ? 366 : 365);
        if (days < days_in_year) break;
        days -= days_in_year;
        year++;
    }
    static const uint8_t days_in_month[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    bool leap = (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
    uint32_t month = 1;
    for (uint32_t i = 0; i < 12; i++) {
        uint32_t dim = days_in_month[i] + (i == 1 && leap ? 1 : 0);
        if (days < dim) { month = i + 1; break; }
        days -= dim;
    }
    uint32_t day = days + 1;

    snprintf(buf, buflen, "%04lu-%02lu-%02lu %02lu:%02lu:%02lu.%03lu UTC",
             (unsigned long)year, (unsigned long)month, (unsigned long)day,
             (unsigned long)h, (unsigned long)m, (unsigned long)s,
             (unsigned long)ms);
}
