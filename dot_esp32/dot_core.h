// projects/dot-protocol/dot_esp32/dot_core.h
#pragma once

#include <Arduino.h>
#include <Ed25519.h>   // rweather/arduinolibs — Ed25519::sign, Ed25519::verify
#include <SHA256.h>    // rweather/arduinolibs — SHA256 class
#include <SPIFFS.h>

// ── Wire layout constants ────────────────────────────────────────────────────
static const size_t DOT_SIZE      = 153;
static const size_t PUBKEY_OFF    = 0;    // [0..31]   Ed25519 public key   32B
static const size_t SIG_OFF       = 32;   // [32..95]  Ed25519 signature    64B
static const size_t CHAIN_OFF     = 96;   // [96..127] SHA-256(prev DOT)    32B
static const size_t TS_OFF        = 128;  // [128..135] Unix ms big-endian   8B
static const size_t TYPE_OFF      = 136;  // [136]     type byte             1B
static const size_t PAYLOAD_OFF   = 137;  // [137..152] payload             16B
static const size_t SIGNED_SIZE   = 89;   // pubkey(32)+chain(32)+ts(8)+type(1)+payload(16)

// ── Type constants ───────────────────────────────────────────────────────────
static const uint8_t DOT_TYPE_PUBLIC    = 0x00;
static const uint8_t DOT_TYPE_CIRCLE    = 0x01;
static const uint8_t DOT_TYPE_PRIVATE   = 0x02;
static const uint8_t DOT_TYPE_EPHEMERAL = 0x03;

// ── Raw 153-byte DOT buffer ──────────────────────────────────────────────────
typedef uint8_t DotBuffer[DOT_SIZE];

// ── Keypair: 32B private seed + 32B public key ──────────────────────────────
struct DotKeypair {
    uint8_t privateKey[32];  // Ed25519 seed — NEVER print, NEVER transmit
    uint8_t publicKey[32];   // Ed25519 public key — safe to share
};

// ── Energy DOT payload (16 bytes) ────────────────────────────────────────────
// voltage_mv (2B uint16 BE) + rpm_est (2B uint16 BE) + adc_pin (1B) + sensor_type (1B) + padding (10B zeros)
struct EnergyPayload {
    uint16_t voltage_mv;   // raw ADC → mV, 0-3300
    uint16_t rpm_est;      // estimated RPM from ADC delta, 0-65535
    uint8_t  adc_pin;      // GPIO pin number
    uint8_t  sensor_type;  // 0x01 = DC motor voltage
};

// ── SPIFFS paths ─────────────────────────────────────────────────────────────
static const char* KEYPAIR_PATH = "/keypair.bin";  // 64 bytes: priv(32) + pub(32)
static const char* CHAIN_PATH   = "/chain.bin";    // N * 153 bytes, append-only

// ── Function declarations ────────────────────────────────────────────────────

// Keypair management
bool     dot_load_keypair(DotKeypair& kp);
void     dot_generate_keypair(DotKeypair& kp);
bool     dot_save_keypair(const DotKeypair& kp);

// DOT construction
void     dot_build_signed_bytes(const DotBuffer dot, uint8_t out_signed[SIGNED_SIZE]);
void     dot_write_ts_be(DotBuffer dot, uint64_t ts_ms);
uint64_t dot_read_ts_be(const DotBuffer dot);
void     dot_write_u16_be(uint8_t* buf, size_t off, uint16_t val);
uint16_t dot_read_u16_be(const uint8_t* buf, size_t off);
void     dot_pack_energy_payload(DotBuffer dot, const EnergyPayload& ep);

// Sign a complete DOT buffer in-place (fills sig[32..95])
// Sets pubkey, chain, ts, type, payload first — then signs
void     dot_sign(DotBuffer dot, const DotKeypair& kp,
                  const uint8_t prev_chain[32],
                  uint64_t ts_ms, uint8_t type,
                  const uint8_t payload[16]);

// SHA-256 of the entire 153-byte DOT → 32-byte output
void     dot_hash(const DotBuffer dot, uint8_t out_hash[32]);

// Verify a single DOT's signature
bool     dot_verify_sig(const DotBuffer dot);

// Chain storage
bool     dot_append_chain(const DotBuffer dot);
size_t   dot_chain_count();
bool     dot_read_dot(size_t index, DotBuffer out);

// Human-readable hex output helpers
void     dot_print_hex(const uint8_t* buf, size_t len);  // no newline
void     dot_println_dot_hex(const DotBuffer dot);       // 306-char hex + newline

// Timestamp → human-readable string (fills buf, max 32 bytes)
void     dot_ts_to_str(uint64_t ts_ms, char* buf, size_t buflen);
