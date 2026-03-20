# Changelog

## v0.4.0-alpha — 2026-03-20

### @dotprotocol/sign (NEW)
- Universal DOT observation signing: `sign()`, `verify()`, `chain()`, `describe()`
- Content-aware: <=16B stored directly in payload, >16B stored as truncated SHA-256 hash pointer
- Face bitfield composition for DOT type classification
- TeachByte enum: None, SelfDescribing, SchemaRef, HumanReadable, MachineReadable
- `contentHash()` / `truncatedHash()` — SHA-256 hashing utilities
- 52 tests passing

### @dotprotocol/transport (NEW)
- DOT Transport Protocol (DTP): no handshake, no session, no TLS
- `send()` — fire a DOT over any adapter (broadcast, channel, or recipient key)
- `receive()` — listen for incoming DOTs with auto-verification and key/channel filtering
- `Relay` — stateless relay with signature verification, rate limiting, stats
- `OfflineQueue` — local queue with max size, max retries, flush-on-reconnect
- `MemoryAdapter` / `MemoryBus` — in-memory transport for testing
- `TransportAdapter` interface — plug in any transport (WebSocket, BLE, NFC, LoRa, QR)
- 47 tests passing

## v0.2.0 — 2026-03-19

### @dotprotocol/engine (NEW)
- DOT Game Engine: one import, physics runs automatically
- Identity from device entropy (WebCrypto + timing jitter PUF)
- Ed25519 signing on every DOT.create()
- SHA-256 chain linking (append-only worldline)
- ECDH encryption: Ed25519→X25519 + ChaCha20 (auto when WHO specified)
- BLS12-381 sealing: DOT.seal(n) → 48-byte aggregate G1 proof
- BLS seal verification: DOT.verifySeal()
- rANS + LinearPredictor compression (browser-safe, no native deps)
- CHORUS relay: wss://dotdotdot.rocks with Ed25519 challenge-auth
- Web Bluetooth peer discovery (Android Chrome, fallback to relay/QR)
- Self-aware health system: DOT.health() → HealthReport
- Self-healing watchdog: auto-reconnect, predictor reset, auto-seal
- 191 tests passing, 100% coverage

### @dotprotocol/core
- BLS12-381 signing and aggregation (signBLS, aggregateSignatures, verifyAggregateSameSigner)
- .dot binary file format (writeDotFile, readDotFile, inspectDotFile)
- Batch pack/unpack for Ed25519 and BLS frames

### @dotprotocol/compression
- rANS (range Asymmetric Numeral Systems) entropy coding
- LinearPredictor: context-4 last-value prediction
- Weissman score computation
- Browser-safe (no native deps, no zstd-napi)
- W=29.2 over gzip at N=1000

### @dotprotocol/relay
- CHORUS relay client with Ed25519 challenge-auth
- Standalone relay server (WebSocket)
- 185-byte binary frame format

### @dotprotocol/chain, @dotprotocol/identity, @dotprotocol/wrapper, @dotprotocol/sdk
- Stability improvements and 100% test coverage

## v0.1.0 — 2026-02-01

- Initial release: core, compression, chain, identity
- 153-byte DOT wire format
- Ed25519 signing and verification
- SHA-256 chain hashing
