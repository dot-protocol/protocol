# DOT Protocol — Project State

**Date:** 2026-03-23
**Version:** v0.4.0-alpha
**Published:** [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)
**License:** MIT

---

## What DOT Protocol Is

DOT is a 153-byte cryptographic observation format. Ed25519 signatures. SHA-256 chain hashing. A contact between two things that changes both. No server required. No owner. No variable-length fields. No configuration.

153 bytes = 32B public key + 64B signature + 32B chain hash + 8B timestamp + 1B type + 16B payload. Always.

---

## What Exists Right Now

**14 packages. ~11,000 lines of source. ~13,600 lines of tests. 616 tests.**

### Packages

| Package | What it does | Tests | Lines |
|---------|-------------|-------|-------|
| **@dotprotocol/core** | 153-byte wire format, Ed25519 signing, SHA-256 chaining, BLS12-381 sealing, DOT Faces (12+1 bitfield), TEACH byte royalty, Transform Registry, .dot binary file format, batch pack/unpack | 128 | 1,475 |
| **@dotprotocol/engine** | One-import game engine. `DOT.boot()` → identity, signing, chaining, ECDH encryption (Ed25519→X25519 + ChaCha20), BLS sealing, rANS compression, relay connection, BLE discovery, self-aware health system + watchdog auto-healing — all automatic | 191 | 2,342 |
| **@dotprotocol/sign** | Universal signing: `sign()`, `verify()`, `chain()`, `describe()`. Content <=16B stored directly, >16B becomes SHA-256 hash pointer. Face composition, TEACH byte, transforms | 52 | 332 |
| **@dotprotocol/transport** | DOT Transport Protocol (DTP). `send()`/`receive()` over any adapter. Stateless relay with rate limiting + signature verification. Offline queue with flush-on-reconnect. Memory adapter (testing), WebSocket adapter (production, auto-reconnect with exponential backoff) | 72 | 696 |
| **@dotprotocol/chain** | Append-only worldlines. Four-Score reputation: depth, width, Elo, W (compression density). Tiers: observer → contributor → architect → luminary | 29 | 335 |
| **@dotprotocol/compression** | rANS entropy coding, LinearPredictor, batch-v2 column serialization, timestamp delta encoding, payload type RLE, Weissman scoring, zstd dictionary. W=29.2 over gzip at N=1000 | 210 | 2,168 |
| **@dotprotocol/relay** | CHORUS WebSocket relay. Client + server. 185-byte binary frame format. Ed25519 challenge-auth. Circle routing. Default: `wss://dotdotdot.rocks` | 42 | 326 |
| **@dotprotocol/identity** | Keypair persistence (load/save/create). DID derivation (`did:dot:` — base58btc-encoded) | 8 | 65 |
| **@dotprotocol/wrapper** | Wrap any binary as cryptographically-chained DOTs (16B chunks). BLS-sealed batch frames. Streaming support. HTTP bridge for existing protocols | 75 | 1,241 |
| **@dotprotocol/qr** | Falooda Protocol — DOT as QR code. 19 DOTs per QR. Binary, steganographic (PNG LSB), and nested encoding. Batch verify. Physical DOT = printed QR = self-verifying, no internet | 12 | 334 |
| **@dotprotocol/arena** | Blind prediction evaluation. Commit-reveal protocol. Elo engine with domain-specific ratings, percentiles, leaderboard ranking | 8 | 239 |
| **@dotprotocol/kin** | MCP server. 11 tools for AI agents: boot, create, verify, seal, encrypt, decrypt, inspect, stats, health. Agent worldline = audit log | — | 688 |
| **@dotprotocol/sdk** | Unified import — everything re-exported from one install | — | 110 |
| **@dotprotocol/messenger** | Reference React PWA app (private, in progress) | — | 87 |

### Architecture

```
Layer 4: Applications     messenger (React PWA), kin (MCP server), examples
Layer 3: Orchestration    engine (physics auto-apply), sdk (unified import)
Layer 2: Capabilities     sign, transport, chain, compression, relay, qr, arena, wrapper, identity
Layer 1: Primitives       core (153 bytes, Ed25519, SHA-256, BLS12-381)
```

### What Can Be Built On This Today

- **Encrypted messenger** — Two keypairs, ECDH auto-triggers on WHO parameter
- **Verifiable camera/notary** — Photo → SHA-256 → 16B hash pointer → DOT chain
- **Prediction markets** — Blind commit → oracle resolve → Elo scoring, all on-chain
- **Offline-first QR communication** — Print DOTs as QR. No internet. No device. Paper IS the protocol (Falooda)
- **AI agent trust layer** — MCP server gives any LLM a cryptographic worldline
- **IoT sensor chains** — 153 bytes fits LoRa, NFC, BLE advertisement
- **File attestation** — Wrap any binary, BLS-seal it, verify per-chunk
- **Reputation systems** — Worldline IS the score. Four-Score: depth, width, Elo, W
- **Custom transport** — Implement `TransportAdapter` for WebSocket, Bluetooth, NFC, LoRa, QR, sound, light, paper
- **Decentralized identity** — `did:dot:` derived from Ed25519 public key. No registry. No server.
- **Mesh networks** — Any binary channel that can carry 153 bytes is a DOT transport
