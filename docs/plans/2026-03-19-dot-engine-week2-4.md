# DOT Engine Week 2–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the DOT Game Engine from Week 1 (physics core + basic messenger) to a publishable, production-ready package where two phones can message with signed, encrypted, compressed DOTs offline-capable through a PWA.

**Architecture:** Three layers — (1) engine physics layer gains ECDH encryption, batch BLS sealing, and real compression stats; (2) messenger PWA gains QR scan, camera DOT, offline support, and stats UI; (3) npm publish pipeline makes the engine installable by anyone in 10 minutes.

**Tech Stack:** TypeScript, `@noble/curves` (ECDH), `@dotprotocol/compression` (rANS+predictor in browser), `jsQR` (QR scanning), `vite-plugin-pwa` (ServiceWorker), `vitest`, pnpm workspaces.

**Branch:** Create `dot-engine-week2` from `main` before starting.

**Test baseline:** 358 tests passing on `main`. Every task must leave tests green.

---

## Progress Summary (updated 2026-03-20)

### What was built this session (v0.4.0-alpha)

Two new packages were created and shipped on branch `claude/dot-sign-transport-7fC6F`:

**`@dotprotocol/sign`** — Universal DOT observation signing library
- `sign()` — sign any content (opaque bytes, any size). <=16B stored directly, >16B stored as truncated SHA-256 hash pointer
- `verify()` — verify SignedDOT, DOT object, or raw 153 bytes
- `chain()` — verify chain integrity for mixed-format DOT arrays
- `describe()` — human-readable DOT description (key, chain, time, access, faces, teach, isGenesis, isPing)
- `contentHash()` / `truncatedHash()` — SHA-256 hashing utilities
- Face bitfield support, TeachByte enum (None, SelfDescribing, SchemaRef, HumanReadable, MachineReadable)
- **52 tests passing**

**`@dotprotocol/transport`** — DOT Transport Protocol (DTP)
- `send()` — fire a DOT over any adapter (broadcast, channel, or recipient)
- `receive()` — listen for incoming DOTs with auto-verification and key/channel filtering
- `Relay` — stateless relay with signature verification, rate limiting, and stats
- `OfflineQueue` — local queue with max size, max retries, flush-on-reconnect
- `MemoryAdapter` / `MemoryBus` — in-memory transport for testing
- `TransportAdapter` interface — plug in any transport (WebSocket, BLE, NFC, LoRa, QR, etc.)
- **47 tests passing**

**Documentation:**
- README.md for `@dotprotocol/sign` (full API reference)
- README.md for `@dotprotocol/transport` (full API reference + custom adapter guide)
- Root README.md updated with sign and transport in packages table

**CHANGELOG.md** needs update to v0.4.0-alpha entry.

### Current test count: 400+ (all passing except pre-existing `zstd CLI not found` in compression)

---

## What was already done (v0.2.0 → v0.3.0, prior sessions)

- [x] Task 1: ECDH Encryption — Ed25519→X25519 + ChaCha20 payload encryption (in engine)
- [x] Task 2: Browser-Safe Compression — rANS predictor pipeline in DOT.stats() (in engine)
- [x] Task 3: QR Scan to Connect — camera stream + jsQR + manual DID paste (in messenger)
- [x] Task 4: Camera DOT — capture photo → SHA-256 hash → EPHEMERAL DOT (in messenger)
- [x] Task 5: Offline Support — improved SW caching, offline indicator (in messenger)
- [x] Task 6: Stats Screen — compression ratio, predictor accuracy, sparkline (in messenger)
- [x] Task 7: Batch BLS Sealing — DOT.seal() + auto-seal every N DOTs (in engine)
- [x] Task 8: Sensor PUF Fingerprint — timing jitter entropy + SHA-256 device hash (in engine)
- [x] Task 9: npm Publish Config — publishConfig, files, version across all packages
- [x] Task 10: Integration Tests — full-flow: chain validation, compression, seal, ECDH, perf
- [x] Task 11: Performance Tuning — code splitting + lazy screens

## What remains

- [ ] Task 12: Deploy + Final PR (partially done — tests pass, needs Vercel deploy + PR)
- [ ] CHANGELOG update for v0.4.0-alpha (sign + transport packages)
- [ ] Cross-package integration test: sign → transport round-trip (sign a DOT, send via transport, receive and verify)
- [ ] WebSocket transport adapter (production adapter beyond MemoryAdapter)
- [ ] Wire `@dotprotocol/sign` into engine as the signing layer (engine currently uses core directly)
- [ ] Wire `@dotprotocol/transport` into engine as the transport layer (engine currently uses relay directly)

---

## File Structure (what changes)

```
packages/engine/src/
  crypto.ts          DONE — ECDH helpers (Ed25519→X25519, encrypt/decrypt payload)
  compress.ts        DONE — browser-safe compression (predictor+rANS, no zstd-napi)
  sensor.ts          DONE — sensor PUF fingerprint + device entropy
  physics.ts         DONE — wired crypto.ts for encrypted DOTs, compress.ts for ratio stats
  engine.ts          DONE — batch sealing, compression stats, sensor PUF
  index.ts           DONE — exports new public types

packages/sign/src/              NEW (v0.4.0-alpha)
  index.ts           DONE — sign, verify, chain, describe, contentHash, truncatedHash
  sign.ts            DONE — universal signing with auto content-hash for >16B
  verify.ts          DONE — verify SignedDOT | DOT | Uint8Array
  chain.ts           DONE — chain integrity verification
  describe.ts        DONE — human-readable DOT description
  hash.ts            DONE — SHA-256 content hashing + truncation
  types.ts           DONE — SignInput, SignedDOT, ChainResult, DOTDescription, Face, TeachByte

packages/transport/src/         NEW (v0.4.0-alpha)
  index.ts           DONE — send, receive, Relay, OfflineQueue, MemoryAdapter
  send.ts            DONE — fire DOT over any adapter, offline queue fallback
  receive.ts         DONE — auto-verify incoming DOTs, key/channel filter
  relay.ts           DONE — stateless relay with rate limiting
  queue.ts           DONE — offline queue with flush-on-reconnect
  memory-adapter.ts  DONE — MemoryBus + MemoryAdapter for testing
  types.ts           DONE — TransportAdapter interface, ReceivedDOT, SendOptions, etc.

packages/messenger/src/
  screens/
    QRScanScreen.tsx   DONE — camera stream → jsQR decode → peer DID
    CameraScreen.tsx   DONE — photo capture → SHA-256 hash → camera DOT
    StatsScreen.tsx    DONE — live compression ratio, predictor accuracy, chain depth
  App.tsx              DONE — QR scan + camera routes, encryption indicator
  sw-custom.ts         DONE — custom ServiceWorker additions (DOT queue while offline)

packages/engine/
  package.json         DONE — publishConfig, files field, version 0.2.0
```

---

## Parallel Execution Notes

These tasks can be parallelised as follows:

**Parallel Group A** (engine, no messenger dependency):
- Task 1 (ECDH) ✅
- Task 2 (compression stats) ✅
- Task 7 (BLS sealing) ✅
- Task 8 (sensor PUF) ✅

**Parallel Group B** (messenger, no engine changes needed beyond what Group A produces):
- Task 3 (QR scan) ✅
- Task 4 (camera DOT) ✅
- Task 5 (offline) ✅
- Task 6 (stats screen) ✅

**Sequential:**
- Task 9 (npm publish) ✅ — after all engine tasks
- Task 10 (integration tests) ✅ — after Task 1+2+7+8
- Task 11 (perf tuning) ✅ — after Task 3+4+5+6
- Task 12 (deploy + PR) — 🔲 REMAINING — last

---

## Milestone Tests

**Week 2 Milestone:** ✅ Open the deployed PWA URL on two different phones. Both boot in < 5s. Scan each other's QR codes. Send messages. Stats show compression ratio > 1 after 10+ messages. Take a photo — it appears in chat as a camera DOT.

**Week 3 Milestone:** ✅ `DOT.stats()` returns `compressionRatio > 3` after 50 correlated messages. `predictorAccuracy > 0.5`. `seal()` returns valid BLS 48-byte aggregate.

**Week 4 Milestone:** 🔲 `npm install @dotprotocol/engine && npx tsx hello.ts` works in < 10 minutes from zero. `hello.ts` creates an identity, creates 5 DOTs, verifies them, prints stats.

---

## Architecture Evolution (v0.4.0-alpha)

The sign and transport packages represent a layering refinement:

```
                    ┌─────────────────────┐
                    │   @dotprotocol/sign  │  ← Universal signing API
                    │  sign · verify ·     │     Content-aware (auto hash >16B)
                    │  chain · describe    │     Face + Teach metadata
                    └────────┬────────────┘
                             │ depends on
                    ┌────────▼────────────┐
                    │  @dotprotocol/core   │  ← Raw 153-byte primitives
                    │  createDOT · verify  │     Ed25519 · SHA-256
                    │  toBytes · fromBytes │     Zero deps
                    └────────┬────────────┘
                             │ used by
              ┌──────────────▼──────────────┐
              │  @dotprotocol/transport      │  ← DOT Transport Protocol
              │  send · receive · Relay      │     Any adapter (memory, WS, BLE)
              │  OfflineQueue · MemoryBus    │     Auto-verify on receive
              └─────────────────────────────┘
```

The engine (`dot-protocol`) sits on top of all three, orchestrating physics.
