# Changelog

## v0.2.0 — 2026-03-19

### @dot-protocol/engine (NEW)
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

### @dot-protocol/core
- BLS12-381 signing and aggregation (signBLS, aggregateSignatures, verifyAggregateSameSigner)
- .dot binary file format (writeDotFile, readDotFile, inspectDotFile)
- Batch pack/unpack for Ed25519 and BLS frames

### @dot-protocol/compression
- rANS (range Asymmetric Numeral Systems) entropy coding
- LinearPredictor: context-4 last-value prediction
- Weissman score computation
- Browser-safe (no native deps, no zstd-napi)
- W=29.2 over gzip at N=1000

### @dot-protocol/relay
- CHORUS relay client with Ed25519 challenge-auth
- Standalone relay server (WebSocket)
- 185-byte binary frame format

### @dot-protocol/chain, @dot-protocol/identity, @dot-protocol/wrapper, @dot-protocol/sdk
- Stability improvements and 100% test coverage

## v0.1.0 — 2026-02-01

- Initial release: core, compression, chain, identity
- 153-byte DOT wire format
- Ed25519 signing and verification
- SHA-256 chain hashing
