---
phase: dot-engine-week2
plan: tasks-1-2-7-8
subsystem: engine
tags: [ecdh, encryption, bls, compression, sensor, puf, chacha20, x25519]

dependency-graph:
  requires:
    - "@dotprotocol/core (BLS, Ed25519, createDOT)"
    - "@dotprotocol/compression (LinearPredictor)"
    - "@noble/curves/ed25519 (X25519 key conversion)"
    - "@noble/ciphers/chacha (ChaCha20 stream cipher)"
  provides:
    - "ECDH encryption for DOT payloads"
    - "Browser-safe batch compression stats"
    - "BLS12-381 batch sealing"
    - "Sensor PUF device fingerprinting"
  affects:
    - "Week 3 features that depend on encrypted DOT payloads"
    - "Any consumers of DOT.stats() — now returns real compression data"

tech-stack:
  added:
    - "@noble/ciphers ^2.1.1"
    - "@noble/curves ^2.0.1"
  patterns:
    - "ECDH with Ed25519→X25519 conversion via toMontgomery/toMontgomerySecret"
    - "ChaCha20 stream cipher with chain-position nonce"
    - "Deterministic BLS key derivation from Ed25519 private key via SHA-256"
    - "LinearPredictor residual estimation for browser-safe compression"
    - "Timing jitter entropy collection for device fingerprinting"

key-files:
  created:
    - "packages/engine/src/crypto.ts"
    - "packages/engine/src/compress.ts"
    - "packages/engine/src/sensor.ts"
    - "packages/engine/src/tests/crypto.test.ts"
    - "packages/engine/src/tests/compress.test.ts"
    - "packages/engine/src/tests/sensor.test.ts"
  modified:
    - "packages/engine/src/engine.ts"
    - "packages/engine/src/physics.ts"
    - "packages/engine/src/identity.ts"
    - "packages/engine/src/index.ts"
    - "packages/engine/package.json"

decisions:
  - "Used ed25519.utils.toMontgomery() / toMontgomerySecret() from @noble/curves v2 — not edwardsToMontgomery (v1 API). Plan referenced old API."
  - "createKeypair() is async — plan tests called it synchronously. Fixed all test cases."
  - "BLS seal uses first 32 bytes of each DOT as message (public key field). Deterministic per-DOT."
  - "Compression ratio estimate uses per-DOT overhead (73B fixed) + residual payload size — avoids native zstd dep."
  - "PUF mixes timing jitter fractional bits with crypto RNG — not hardware PUF but device-biased."

metrics:
  tests-before: 26
  tests-after: 41
  new-tests: 15
  completed: "2026-03-19"
  commits: 4
---

# DOT Engine Week 2: Tasks 1, 2, 7, 8 Summary

One-liner: ECDH ChaCha20 payload encryption, BLS batch sealing, browser-safe LinearPredictor compression stats, and sensor PUF device fingerprinting — 41 tests, 4 atomic commits.

## What Was Built

### Task 1: ECDH Encryption (`crypto.ts`)

Ed25519 identity keys converted to X25519 via `ed25519.utils.toMontgomery()` / `toMontgomerySecret()`. ECDH shared secret derived, then used as ChaCha20 key. Chain position becomes the nonce (deterministic per-DOT encryption without IV storage). Physics layer auto-encrypts when `Datom.WHO` is present. `DOT.decryptDot()` added to the API for the receiving side.

### Task 2: Browser-Safe Compression (`compress.ts`)

`createBatchCompressor()` measures compression ratio using LinearPredictor residuals — no native zstd, works in browser. `DOT.stats()` now returns real `compressionRatio` and `predictorAccuracy` from the last 100 DOTs. The estimate: fixed overhead (73B/DOT for sig+ts+type) + 16B per non-predicted payload + ~1B for zero-residual payloads.

### Task 7: BLS Batch Sealing (engine.ts)

`DOT.seal(n)` signs the last N DOTs with BLS12-381 (G1 short signatures, 48 bytes). BLS private key derived deterministically: `SHA-256(ed25519_privkey || "bls-seal")`. `aggregateSignatures()` from `@dotprotocol/core` reduces N signatures to one 48-byte proof. `sealEvery` option enables auto-sealing.

### Task 8: Sensor PUF Fingerprint (`sensor.ts`)

`collectEntropy()` loops `performance.now()` for up to 200ms, extracting fractional bits, then mixes in 32 bytes of `crypto.getRandomValues()`. `hashEntropy()` SHA-256s the result to 32 bytes. `deviceFingerprint()` returns a 64-char hex string. The `puf` field is now on `DotIdentity` — populated on new identity creation.

## Test Results

| Suite | Tests |
|-------|-------|
| relay.test.ts | 14 |
| engine.test.ts | 14 (+2 seal tests) |
| crypto.test.ts | 6 (new) |
| compress.test.ts | 3 (new) |
| sensor.test.ts | 4 (new) |
| **Total** | **41** |

## Deviations from Plan

### [Rule 1 - Bug] Fixed async createKeypair() test calls

- **Found during:** Task 1 — crypto.test.ts
- **Issue:** Plan's test code called `createKeypair()` synchronously. It returns a Promise in `@dotprotocol/core`.
- **Fix:** Added `await` to all `createKeypair()` calls in crypto.test.ts. Made all affected `it()` callbacks `async`.
- **Commit:** 9039058e

### [Rule 1 - Bug] Updated @noble/curves API for v2

- **Found during:** Task 1 — crypto.ts implementation
- **Issue:** Plan referenced `ed25519.utils.edwardsToMontgomery()` and `edwardsToMontgomeryPriv()` (v1 API). v2 uses `ed25519.utils.toMontgomery()` and `toMontgomerySecret()`. The `x25519` export moved from `@noble/curves/montgomery` to `@noble/curves/ed25519.js`.
- **Fix:** Used v2 API throughout crypto.ts.
- **Commit:** 9039058e

## Commits

| Hash | Message |
|------|---------|
| 9039058e | feat(engine): ECDH encryption — Ed25519→X25519 ECDH + ChaCha20 payload encryption |
| 714d810f | feat(engine): browser-safe compression stats — rANS predictor pipeline wired into DOT.stats() |
| c96445df | feat(engine): BLS batch sealing — DOT.seal() + auto-seal every N DOTs |
| 4e6e762f | feat(engine): sensor PUF fingerprint — timing jitter entropy + SHA-256 device hash |
