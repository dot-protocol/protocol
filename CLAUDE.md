# CLAUDE.md — DOT Protocol Build Directive

## Identity
You are building the DOT Protocol ecosystem. DOT is a 153-byte cryptographic observation format using Ed25519 signatures and SHA-256 chain hashing. Published: doi.org/10.5281/zenodo.18946074

## What is a DOT
A DOT is a contact between two things that changes both. 153 bytes:
- [0..31] Public key (Ed25519, 32B) — WHO
- [32..95] Signature (Ed25519, 64B) — PROOF
- [96..127] Chain hash (SHA-256 of previous DOT, or zeros for genesis) — SEQUENCE
- [128..135] Timestamp (Unix ms, big-endian, 8B) — WHEN
- [136] Type (1B) — VISIBILITY: 0x00=public, 0x01=circle, 0x02=private, 0x03=ephemeral
- [137..152] Payload (16B, zero-padded) — WHAT

The empty DOT (zero payload) is called a PING. It is the default. Content is the exception.

## SDK Location
- JS core: `dot-protocol/js/dot.mjs` (177 lines, zero deps, Node 18+)
- Python core: `dot-protocol/python/dot.py` (158 lines, requires `cryptography`)
- Browser: `dot-protocol/js/dot.browser.mjs` (126 lines, Web Crypto API)
- CLI: `dot-protocol/js/cli.mjs` — commands: init, ping, sign, verify, chain, inspect, export
- Package: `dot-protocol/package.json` — name: `dot-protocol`, MIT license

## Core API (memorize these)
```javascript
import { createKeypair, createDot, verifyDot, checkChain, toBytes, fromBytes, ping, inspect, TYPE } from 'dot-protocol'

const key = createKeypair()              // { publicKey(32B), privateKey(32B), publicKeyObj, privateKeyObj }
const dot = createDot({ key })           // PING — the default
const dot = createDot({ key, payload: 'hello', type: TYPE.PUBLIC, previous: lastDot })
const ok  = verifyDot(dot)               // boolean
const res = checkChain([dot1, dot2, ...]) // { valid: true } or { valid: false, brokenAt: N, reason: '...' }
const buf = toBytes(dot)                 // Uint8Array(153) — wire format
const dot = fromBytes(buf)               // reconstruct from 153 bytes
const p   = ping(key, previousDot)       // empty DOT, zero payload, maximum meaning
const i   = inspect(dot)                 // { key, chain, time, type, payload, size }
```

## Architecture Principles
1. **No central control.** No server required. Devices are peers. If any node dies, the chain survives elsewhere.
2. **Best-effort delivery.** The SDK creates and verifies DOTs. Transport is the builder's choice (HTTP, WebSocket, Bluetooth, NFC, LoRa, QR code, SMS, Li-Fi, sound, paper).
3. **Stateless relays.** A relay passes 153 bytes without understanding, storing, or tracking them.
4. **End-to-end verification.** Signing and verification happen on user devices. The network is dumb pipes.
5. **Payload is a pointer, not a prison.** 16 bytes can hold a truncated content hash pointing to media stored anywhere (IPFS, local, peer cache). Attestation (DOT) and content (storage) are separate concerns.

## DOT URI Scheme
```
dot://three.word.location/timestamp/type/chain-name
```
- Location: What3Words-style human-readable coordinates
- Timestamp: ISO 8601
- Type: public/circle/private/ephemeral
- Chain: human-readable name mapped to public key
- Resolution is LOCAL: scan physical space via BLE/NFC/WiFi/mesh for matching DOTs

## Building Patterns

### Contact (two-party)
Both devices create a DOT. Each DOT's payload contains the OTHER party's public key (first 16 bytes). A contact = two DOTs, one on each chain, cross-referencing. This is the handshake.

### Chain (worldline)
A sequence of DOTs where each DOT's chainHash = SHA-256(toBytes(previousDot)). Genesis DOT has chainHash = 32 zero bytes. The worldline IS the identity over time.

### Channel/Room
A shared chain. Genesis DOT declares the room name + admin public key. Members post DOTs referencing the channel's genesis hash. Moderation = signed DOTs from moderator keys.

### Tunnel (encrypted DM)
Two chains with encrypted payloads. Use X25519 key exchange derived from each party's Ed25519 key to establish a shared secret. Encrypt payload with XChaCha20-Poly1305 or AES-256-GCM. Only the two endpoints can decrypt.

### Stream (audio/video)
High-frequency chain of ephemeral DOTs (type 0x03). Each payload = 16 bytes of compressed delta frame data, or a hash pointer to larger frame stored in a WebRTC data channel. Dissolve after display.

### Bot/Agent
A bot is a keypair that reads channel DOTs and signs response DOTs. Expose capabilities via MCP server. Other agents discover via A2A Agent Card. The bot's DOTs are distinguishable by its public key.

### Media
16-byte payload = truncated SHA-256 hash of media content. Content stored in IPFS, local filesystem, or peer cache. DOT proves who posted, when, and the content hash for verification.

### Reputation
A user's reputation IS their worldline — chain length, contact count, ban-DOTs received, server memberships. No central score. The chain is the score.

### Discovery (Genesis DOT)
First DOT in a chain. Payload declares what the chain is: a compressed 16-byte descriptor (4-byte type code + 12-byte name/metadata). This is the DOT equivalent of an Agent Card or llms.txt.

## Constraints (hard rules)
- DOT is always exactly 153 bytes. No variable length. No extensions.
- Payload max 16 bytes. If it doesn't fit, it's a hash pointer to external content.
- Ed25519 for signing. SHA-256 for hashing. No alternatives. No "pluggable crypto."
- The SDK does NOT include storage, networking, identity management, UI, consensus, or tokens. Those are ecosystem, not protocol.
- Zero dependencies in JS core. One dependency (`cryptography`) in Python.
- MIT license. Always.

## Product Context
- **AXXIS** — the OS/identity layer. Philosophy: "Finance as game."
- **MEVICI** — prediction markets terminal. "Michelin Guide for finance."
- **dotdotdot.rocks** — worldline map. Your life as a light trail.
- **Kin** — private local LLM. The last app. Intent → execution via open source stack + DOT trust layer.
- **Falooda Protocol** — zero-cost communication for people without devices. A DOT printed as QR on paper IS Falooda.

## Naming
- Product names: AXXIS, MEVICI, DOT — always capitalized exactly this way.
- A PING is an empty DOT. Never call it "empty DOT" in user-facing code.
- A worldline is a chain of DOTs. Never call it "history" or "log."
- The six universal functions: Gate, Pulse, Chain, Mesh, Bloom, Fade.

## Quality
- Every function that creates, verifies, or transforms DOTs must have a corresponding test.
- Cross-language interop: any DOT created in JS must verify in Python and vice versa. Same 153 bytes.
- If a feature adds more than 50 lines to the core SDK, it belongs in a separate module, not in the core.
- Ping-first design: the default API call should produce a valid empty DOT. Content is opt-in.

## Philosophy
153 bytes is the tax humans pay for being the only known species that can lie. The tree communicates for free. The protocol exists to let a lying species speak truth again. The destination is not better code. The destination is no code — machines that sign by existing, chain by growing, contact by touching, and verify by physics. The plant in Nashik soil is already there.

---
*The act of contact leaves its dot.*
