// projects/dot-protocol/dot_esp32/dot_esp32.ino
//
// DOT Protocol — ESP32 Energy Observer
// Build 2: DC motor shaft → signed DOT chain
//
// Serial commands (115200 baud):
//   CHAIN    → dump all DOTs as newline-delimited lowercase hex (306 chars/line)
//   VERIFY   → verify all DOTs, print pass/fail per DOT + summary
//
// Private key stays on device. Never printed. Never transmitted.

#include <Arduino.h>
#include <SPIFFS.h>
#include "dot_core.h"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — edit these for your hardware
// ─────────────────────────────────────────────────────────────────────────────

#define LED_PIN          2      // GPIO2 = built-in LED on most ESP32 DevKit boards
#define ADC_PIN         34      // GPIO34: input-only ADC pin (GPIO34 or GPIO35)
#define SENSOR_TYPE_VAL 0x01    // 0x01 = DC motor voltage
#define DOT_INTERVAL_MS 5000    // Sign a DOT every 5 seconds

// WiFi (optional POST) — set WIFI_ENABLED to 1 to enable
#define WIFI_ENABLED 0
#if WIFI_ENABLED
  #include <WiFi.h>
  #include <HTTPClient.h>
  static const char* WIFI_SSID     = "your-ssid";
  static const char* WIFI_PASS     = "your-password";
  static const char* DOT_ENDPOINT  = "http://192.168.1.100:8080/dot";
#endif

// ─────────────────────────────────────────────────────────────────────────────
// Globals
// ─────────────────────────────────────────────────────────────────────────────

DotKeypair g_kp;                 // loaded from SPIFFS or generated on first boot
uint8_t    g_prev_chain[32];     // SHA-256 of last DOT, or zeros for genesis
bool       g_genesis_needed;     // true if chain is empty → emit genesis DOT first
uint32_t   g_last_dot_ms;        // millis() at last DOT
uint16_t   g_prev_adc;           // previous ADC reading for RPM estimation

// Epoch offset so timestamps look reasonable (2026-01-01 00:00:00 UTC = 1767225600000 ms)
static const uint64_t EPOCH_OFFSET_MS = 1767225600000ULL;

// ─────────────────────────────────────────────────────────────────────────────
// RPM estimation
// Simple approach: ADC delta over time correlates with motor speed.
// At 5s interval, delta/5s ≈ (ADC_range * frequency). This is coarse.
// Replace with interrupt-based hall sensor counting for real RPM.
// ─────────────────────────────────────────────────────────────────────────────

uint16_t estimate_rpm(uint16_t adc_now, uint16_t adc_prev) {
    int32_t delta = (int32_t)adc_now - (int32_t)adc_prev;
    if (delta < 0) delta = -delta;
    // Empirical: delta of 100 ADC units at 5s interval ≈ 300 RPM (adjust for your motor)
    uint32_t rpm = (uint32_t)delta * 3;
    if (rpm > 65535) rpm = 65535;
    return (uint16_t)rpm;
}

// ─────────────────────────────────────────────────────────────────────────────
// LED blink helper
// ─────────────────────────────────────────────────────────────────────────────

void blink_led(int times, int on_ms, int off_ms) {
    for (int i = 0; i < times; i++) {
        digitalWrite(LED_PIN, HIGH);
        delay(on_ms);
        digitalWrite(LED_PIN, LOW);
        if (i < times - 1) delay(off_ms);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WiFi POST (optional)
// ─────────────────────────────────────────────────────────────────────────────

#if WIFI_ENABLED
void wifi_post_dot(const DotBuffer dot) {
    if (WiFi.status() != WL_CONNECTED) return;
    HTTPClient http;
    http.begin(DOT_ENDPOINT);
    http.addHeader("Content-Type", "application/octet-stream");
    int code = http.POST((uint8_t*)dot, DOT_SIZE);
    if (code > 0) {
        Serial.printf("WIFI_POST: HTTP %d\n", code);
    } else {
        Serial.printf("WARN: WIFI_POST_FAIL code=%d\n", code);
    }
    http.end();
}
#endif

// ─────────────────────────────────────────────────────────────────────────────
// Serial command: CHAIN — dump all DOTs as hex
// ─────────────────────────────────────────────────────────────────────────────

void cmd_chain() {
    size_t count = dot_chain_count();
    if (count == 0) {
        Serial.println("CHAIN:0");
        return;
    }
    Serial.printf("CHAIN:%u\n", (unsigned)count);
    DotBuffer buf;
    for (size_t i = 0; i < count; i++) {
        if (!dot_read_dot(i, buf)) {
            Serial.printf("ERROR: READ_FAIL index=%u\n", (unsigned)i);
            continue;
        }
        dot_println_dot_hex(buf);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serial command: VERIFY — verify chain integrity
// ─────────────────────────────────────────────────────────────────────────────

void cmd_verify() {
    size_t count = dot_chain_count();
    if (count == 0) {
        Serial.println("CHAIN:0 RESULT: 0/0 PASS");
        return;
    }
    size_t pass = 0;
    DotBuffer cur, prev_buf;
    uint8_t expected_chain[32];

    for (size_t i = 0; i < count; i++) {
        if (!dot_read_dot(i, cur)) {
            Serial.printf("DOT %u: FAIL (read error)\n", (unsigned)(i + 1));
            continue;
        }

        bool sig_ok = dot_verify_sig(cur);
        if (!sig_ok) {
            Serial.printf("DOT %u: FAIL (signature)\n", (unsigned)(i + 1));
            continue;
        }

        if (i == 0) {
            // Genesis: chain field must be 32 zero bytes
            bool is_genesis = true;
            for (int j = 0; j < 32; j++) {
                if (cur[CHAIN_OFF + j] != 0) { is_genesis = false; break; }
            }
            if (!is_genesis) {
                Serial.printf("DOT %u: FAIL (genesis chain not zero)\n", (unsigned)(i + 1));
                continue;
            }
        } else {
            // Chain link: cur.chain == SHA-256(prev_buf)
            dot_hash(prev_buf, expected_chain);
            bool chain_ok = (memcmp(cur + CHAIN_OFF, expected_chain, 32) == 0);
            if (!chain_ok) {
                Serial.printf("DOT %u: FAIL (chain hash mismatch)\n", (unsigned)(i + 1));
                continue;
            }
        }

        Serial.printf("DOT %u: PASS\n", (unsigned)(i + 1));
        pass++;
        memcpy(prev_buf, cur, DOT_SIZE);
    }

    Serial.printf("RESULT: %u/%u PASS\n", (unsigned)pass, (unsigned)count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign and emit one energy DOT
// ─────────────────────────────────────────────────────────────────────────────

void emit_dot(bool genesis) {
    // 1. Read ADC
    uint16_t adc_raw = 0;
    int adc_reading = analogRead(ADC_PIN);
    if (adc_reading < 0) {
        Serial.printf("WARN: ADC_READ_FAIL pin=%d\n", ADC_PIN);
        adc_reading = 0;
    }
    adc_raw = (uint16_t)adc_reading;

    // 2. Convert to voltage_mv: (raw * 3300) / 4095
    uint16_t voltage_mv = (uint16_t)((adc_raw * 3300UL) / 4095);

    // 3. Estimate RPM
    uint16_t rpm = genesis ? 0 : estimate_rpm(adc_raw, g_prev_adc);
    g_prev_adc = adc_raw;

    // 4. Build payload struct
    uint8_t payload[16];
    memset(payload, 0, 16);
    payload[0] = (uint8_t)(voltage_mv >> 8);
    payload[1] = (uint8_t)(voltage_mv & 0xFF);
    payload[2] = (uint8_t)(rpm >> 8);
    payload[3] = (uint8_t)(rpm & 0xFF);
    payload[4] = (uint8_t)ADC_PIN;
    payload[5] = (uint8_t)SENSOR_TYPE_VAL;
    // [6..15] = 0 (padding)

    // 5. Timestamp: millis() + EPOCH_OFFSET_MS gives us a plausible Unix-ms value
    uint64_t ts_ms = EPOCH_OFFSET_MS + (uint64_t)millis();

    // 6. Sign the DOT
    DotBuffer dot;
    dot_sign(dot, g_kp,
             genesis ? nullptr : g_prev_chain,
             ts_ms,
             DOT_TYPE_PUBLIC,
             payload);

    // 7. Append to SPIFFS chain
    if (!dot_append_chain(dot)) {
        Serial.println("ERROR: SPIFFS_APPEND_FAIL");
        return;
    }

    // 8. Update chain head: g_prev_chain = SHA-256(dot)
    dot_hash(dot, g_prev_chain);

    // 9. Blink LED
    blink_led(1, 80, 0);

    // 10. Print DOT hex (306 chars)
    Serial.print("DOT ");
    Serial.print((unsigned)dot_chain_count());
    Serial.print(" ");
    dot_println_dot_hex(dot);

    // 11. Print human-readable summary
    char ts_str[32];
    dot_ts_to_str(ts_ms, ts_str, sizeof(ts_str));
    if (genesis) {
        Serial.printf("  genesis  ts=%s  voltage=%umV  rpm=%u\n",
                      ts_str, voltage_mv, rpm);
    } else {
        Serial.printf("  ts=%s  voltage=%umV  rpm=%u\n",
                      ts_str, voltage_mv, rpm);
    }

    // 12. Optional WiFi POST
    #if WIFI_ENABLED
    wifi_post_dot(dot);
    #endif
}

// ─────────────────────────────────────────────────────────────────────────────
// setup()
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== DOT Protocol Build 2 — ESP32 Energy Observer ===");

    // GPIO setup
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
    analogReadResolution(12);   // 0-4095 on ESP32
    analogSetPinAttenuation(ADC_PIN, ADC_11db);  // 0-3.3V range

    // Mount SPIFFS
    if (!SPIFFS.begin(true)) {   // true = format on mount fail
        Serial.println("ERROR: SPIFFS_MOUNT_FAIL");
        // Halt with rapid blinks
        while (true) { blink_led(5, 50, 50); delay(500); }
    }
    Serial.println("SPIFFS: mounted");

    // Load or generate keypair
    bool loaded = dot_load_keypair(g_kp);
    if (!loaded) {
        Serial.println("KEYPAIR: generating new identity...");
        dot_generate_keypair(g_kp);
        if (!dot_save_keypair(g_kp)) {
            Serial.println("ERROR: KEYPAIR_SAVE_FAIL");
        } else {
            Serial.println("KEYPAIR: saved to SPIFFS");
        }
    } else {
        Serial.println("KEYPAIR: loaded from SPIFFS");
    }

    // Print public key (safe to share — it IS the DOT identity)
    Serial.print("PUBKEY: ");
    dot_print_hex(g_kp.publicKey, 32);
    Serial.println();

    // Determine chain state
    size_t chain_count = dot_chain_count();
    Serial.printf("CHAIN: %u DOTs in SPIFFS\n", (unsigned)chain_count);

    if (chain_count == 0) {
        // Fresh device — emit genesis DOT
        g_genesis_needed = true;
        memset(g_prev_chain, 0, 32);
    } else {
        // Resume from last DOT in chain
        g_genesis_needed = false;
        DotBuffer last;
        if (dot_read_dot(chain_count - 1, last)) {
            dot_hash(last, g_prev_chain);
            Serial.print("CHAIN_HEAD: ");
            dot_print_hex(g_prev_chain, 32);
            Serial.println();
        } else {
            Serial.println("WARN: CHAIN_HEAD_READ_FAIL — resetting chain hash to zeros");
            memset(g_prev_chain, 0, 32);
        }
    }

    // Optional WiFi connect
    #if WIFI_ENABLED
    Serial.printf("WIFI: connecting to %s...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint8_t wifi_tries = 0;
    while (WiFi.status() != WL_CONNECTED && wifi_tries < 20) {
        delay(500);
        Serial.print('.');
        wifi_tries++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\nWIFI: connected, IP=%s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\nWIFI: connect timeout — continuing without WiFi");
    }
    #endif

    // Boot complete
    blink_led(3, 100, 100);
    Serial.println("READY. Commands: CHAIN | VERIFY");
    Serial.println("=================================================");

    // Emit genesis DOT immediately if chain is empty
    if (g_genesis_needed) {
        Serial.println("GENESIS: signing first DOT...");
        emit_dot(true);
        g_genesis_needed = false;
    }

    g_last_dot_ms = millis();
    g_prev_adc = (uint16_t)analogRead(ADC_PIN);
}

// ─────────────────────────────────────────────────────────────────────────────
// loop()
// ─────────────────────────────────────────────────────────────────────────────

void loop() {
    // Check serial commands
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        cmd.toUpperCase();
        if (cmd == "CHAIN") {
            cmd_chain();
        } else if (cmd == "VERIFY") {
            cmd_verify();
        } else if (cmd.length() > 0) {
            Serial.printf("UNKNOWN: %s\n", cmd.c_str());
        }
    }

    // Periodic DOT emission
    uint32_t now = millis();
    if (now - g_last_dot_ms >= DOT_INTERVAL_MS) {
        emit_dot(false);
        g_last_dot_ms = now;
    }
}
