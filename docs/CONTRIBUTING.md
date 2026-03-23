# Contributing to DOT Protocol

**DOT Protocol is open source under the MIT license.** Contributions are welcome from anyone — regardless of background, location, or experience.

> *153 bytes is the tax humans pay for being the only known species that can lie. The tree communicates for free.*

---

## Table of Contents

- [Getting Started](#getting-started)
- [Repository Structure](#repository-structure)
- [Development Workflow](#development-workflow)
- [Package Guidelines](#package-guidelines)
- [Testing](#testing)
- [Code Style](#code-style)
- [Adding a New Package](#adding-a-new-package)
- [Transport Adapters](#writing-a-transport-adapter)
- [The 50-Line Rule](#the-50-line-rule)
- [Philosophy](#philosophy)

---

## Getting Started

### Prerequisites

- **Node.js 18+** (LTS recommended)
- **pnpm** (package manager) — `npm install -g pnpm`
- **Git**

### Clone and install

```bash
git clone https://github.com/dot-protocol/protocol.git
cd protocol
pnpm install
```

### Run all tests

```bash
pnpm test
```

### Run tests for a specific package

```bash
pnpm --filter @dotprotocol/core test
pnpm --filter @dotprotocol/sign test
pnpm --filter @dotprotocol/transport test
```

### Build all packages

```bash
pnpm build
```

### Type checking

```bash
pnpm typecheck
```

---

## Repository Structure

```
protocol/
├── packages/
│   ├── core/           153-byte primitives. Ed25519, SHA-256, BLS12-381.
│   ├── engine/         Game engine. One import, physics auto-apply.
│   ├── sign/           Universal signing: sign(), verify(), chain(), describe().
│   ├── transport/      DOT Transport Protocol. send(), receive(), relay.
│   ├── chain/          Append-only worldlines. Four-Score reputation.
│   ├── compression/    rANS, LinearPredictor, batch-v2, Weissman scoring.
│   ├── relay/          CHORUS relay client + server (WebSocket).
│   ├── identity/       Keypair persistence + did:dot: DID derivation.
│   ├── wrapper/        Wrap any binary as signed DOT chain.
│   ├── qr/             Falooda Protocol. DOT as QR code.
│   ├── arena/          Elo engine + blind prediction evaluation.
│   ├── kin/            MCP server for AI agents.
│   ├── sdk/            Unified re-export of all packages.
│   └── messenger/      Reference React PWA (private).
├── examples/
│   ├── hello.ts        Minimal boot + create + seal.
│   ├── camera.ts       Photo attestation via hash pointer.
│   └── messenger.ts    Two-device encrypted chat over relay.
├── docs/
│   ├── api.md          Complete API reference.
│   ├── patterns.md     Copy-paste building patterns.
│   ├── architecture.md System architecture.
│   └── STATE.md        Current project capabilities.
├── SPEC.md             Full wire format specification.
├── ARCHITECTURE.md     Architecture overview.
├── CHANGELOG.md        Version history.
├── CLAUDE.md           Build directive.
└── README.md           Project introduction.
```

### Dependency graph

```
Layer 4 (Apps):        messenger → engine
Layer 3 (Engine):      engine → core, compression, relay
Layer 2 (Modules):     sign → core
                       transport → core, sign
                       chain → core
                       compression → core
                       relay → core
                       wrapper → core, compression
                       qr → core
                       arena → core, chain
                       identity → core
                       kin → engine
Layer 1 (Primitives):  core (zero external deps except @noble/curves)
```

**Rules:**
- No circular dependencies.
- Each layer depends only on layers below it.
- Core has exactly one dependency (`@noble/curves` for Ed25519/BLS12-381).
- The engine makes all physics invisible to application developers.

---

## Development Workflow

### 1. Create a branch

```bash
git checkout -b feat/my-feature
```

### 2. Make changes

Edit files in `packages/<name>/src/`. Tests go in `packages/<name>/src/tests/`.

### 3. Write tests

Every function that creates, verifies, or transforms DOTs **must** have a corresponding test. See [Testing](#testing).

### 4. Run tests locally

```bash
pnpm --filter @dotprotocol/<name> test
```

### 5. Commit

Use conventional commits:

```
feat(sign): add batch signing support
fix(transport): handle reconnection edge case
test(core): add cross-language vector tests
docs(patterns): add mesh networking example
chore(deps): update @noble/curves to 2.1.0
```

### 6. Open a PR

PRs should:
- Have a clear title (under 70 chars)
- Describe the **why**, not just the **what**
- Include test results
- Reference any related issues

---

## Package Guidelines

### Naming

- Product names: **AXXIS**, **MEVICI**, **DOT** — always capitalized exactly this way.
- A **PING** is an empty DOT. Never call it "empty DOT" in user-facing code.
- A **worldline** is a chain of DOTs. Never call it "history" or "log."
- The six universal functions: **Gate, Pulse, Chain, Mesh, Bloom, Fade.**

### Exports

Every package has a single entry point: `src/index.ts`. All public API is exported from here.

```typescript
// Good: explicit named exports
export { sign } from './sign.js';
export { verify } from './verify.js';
export type { SignedDOT } from './types.js';

// Bad: barrel re-exports that pull in everything
export * from './internals.js';
```

### Types

- Define types in `src/types.ts` (or co-locate with implementation if small).
- Export types from `src/index.ts` using `export type { ... }`.
- Use strict TypeScript — no `any`, no implicit `any`.

---

## Testing

### Framework

[Vitest](https://vitest.dev/) with TypeScript. Tests live alongside source in `src/tests/`.

### Running tests

```bash
# All packages
pnpm test

# Single package
pnpm --filter @dotprotocol/core test

# Watch mode
pnpm --filter @dotprotocol/sign test -- --watch

# Single test file
cd packages/sign && npx vitest run src/tests/sign.test.ts
```

### Test requirements

| Requirement | Description |
|---|---|
| Every creation function | Must produce a valid 153-byte DOT |
| Every verification function | Must accept valid DOTs, reject tampered |
| Every chain function | Must validate chain integrity |
| Cross-format support | Functions accepting DOTs must handle: DOT objects, raw `Uint8Array(153)`, and `SignedDOT` |
| Deterministic tests | Use fixed seeds/timestamps for reproducibility |
| No network | All tests must run offline (use `MemoryAdapter` for transport) |

### Test structure

```typescript
import { describe, it, expect } from 'vitest';

describe('sign()', () => {
  it('creates a valid PING by default', async () => {
    const key = await createKeypair();
    const result = await sign({ key });
    expect(result.bytes.length).toBe(153);
    expect(result.dot.payload.every(b => b === 0)).toBe(true);
    expect(await verify(result)).toBe(true);
  });
});
```

### Current test counts

| Package | Tests | Status |
|---|---|---|
| core | 128 | passing |
| engine | 191 | 189 passing (2 env-dependent) |
| sign | 52 | passing |
| transport | 72 | passing |
| chain | 29 | passing |
| compression | 210 | 191 passing (19 env-dependent) |
| relay | 42 | passing |
| identity | 8 | passing |
| wrapper | 75 | passing |
| qr | 12 | passing |
| arena | 8 | passing |

---

## Code Style

- **TypeScript** — strict mode, no `any`.
- **Zero dependencies** in core. One dependency (`@noble/curves`) for crypto.
- **Async/await** — all crypto operations return Promises.
- **Named exports** — no default exports.
- **Functional style** — prefer pure functions. Classes only for stateful objects (Relay, Queue, Adapter).
- **No comments stating the obvious.** Comments explain *why*, not *what*.
- **No emojis** in source code or commit messages.

---

## Adding a New Package

### 1. Create the package directory

```bash
mkdir -p packages/my-package/src/tests
```

### 2. Create `package.json`

```json
{
  "name": "@dotprotocol/my-package",
  "version": "0.4.0-alpha",
  "type": "module",
  "main": "src/index.ts",
  "license": "MIT",
  "dependencies": {
    "@dotprotocol/core": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "typescript": "^5.4.5"
  },
  "scripts": {
    "test": "vitest run",
    "build": "tsdown src/index.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

### 3. Create `src/index.ts`

Export your public API.

### 4. Create `src/tests/my-package.test.ts`

Write tests.

### 5. Install workspace dependencies

```bash
pnpm install
```

### 6. Verify

```bash
pnpm --filter @dotprotocol/my-package test
```

### The 50-Line Rule

> If a feature adds more than 50 lines to the core SDK, it belongs in a separate module, not in the core.

Core (`@dotprotocol/core`) is the invariant layer — 153-byte primitives. Everything else is ecosystem. When in doubt, create a new package.

---

## Writing a Transport Adapter

The `@dotprotocol/transport` package defines a `TransportAdapter` interface. Implement it to add any physical transport.

### Interface

```typescript
import type { TransportAdapter, TransportState, TransportType } from '@dotprotocol/transport';

class MyAdapter implements TransportAdapter {
  readonly type: TransportType = 'custom';

  get state(): TransportState {
    // 'disconnected' | 'connecting' | 'connected' | 'error'
  }

  async send(bytes: Uint8Array, destination: string): Promise<void> {
    // Send 153 bytes to destination.
    // Throw if disconnected or bytes.length !== 153.
  }

  onReceive(handler: (bytes: Uint8Array, source: string) => void): () => void {
    // Register a handler for incoming bytes.
    // Return an unsubscribe function.
    // Only forward 153-byte messages (drop anything else).
  }

  async connect(): Promise<void> {
    // Establish the underlying connection.
  }

  async disconnect(): Promise<void> {
    // Clean up the underlying connection.
  }
}
```

### Built-in adapters

| Adapter | Transport | Use case |
|---|---|---|
| `MemoryAdapter` | In-process `MemoryBus` | Testing, local IPC |
| `WebSocketAdapter` | WebSocket (wss://) | Production, auto-reconnect |

### Adapter ideas for contributors

| Transport | Notes |
|---|---|
| **Bluetooth LE** | 153 bytes fits in a single BLE advertisement (max 255) |
| **NFC** | NDEF record, tap-to-exchange |
| **LoRa** | Long-range, low-power, 153 bytes fits easily |
| **WebRTC DataChannel** | Peer-to-peer, NAT traversal |
| **MQTT** | IoT publish/subscribe |
| **UDP** | Minimal overhead, single datagram per DOT |
| **Serial/UART** | Hardware devices, microcontrollers |
| **Li-Fi** | Light-based transmission |
| **Sound (ultrasonic)** | Air-gapped transfer |
| **QR code** | Via `@dotprotocol/qr`, scan-to-receive |
| **SMS** | Hex-encode 153 bytes = 306 characters |
| **Email** | Binary attachment or hex body |
| **libp2p** | Full P2P networking stack |
| **Tor** | Anonymous transport |

### Testing your adapter

```typescript
import { send, receive, MemoryBus } from '@dotprotocol/transport';
import { sign, verify, createKeypair } from '@dotprotocol/sign';

// Create a signed DOT
const key = await createKeypair();
const dot = await sign({ key, content: 'test' });

// Send via your adapter
const adapter = new MyAdapter(/* config */);
await adapter.connect();
await send(dot, adapter, { channel: 'test-channel' });

// Receive and verify
receive(adapter, (received) => {
  console.log(received.verified);    // true
  console.log(received.transport);   // 'custom'
  console.log(received.bytes.length); // 153
});
```

---

## Philosophy

### What DOT is

1. **Minimum viable fact** — the smallest unit of verifiable observation
2. **Noun-verb fusion** — the state that records its own transition
3. **Integration engine** — each DOT is a derivative, the chain is the integral
4. **External honest identity** — the chain cannot lie about what the self narrates
5. **Lens, not thermometer** — transforms what passes through it according to fixed laws

### What DOT is not

- Not a blockchain (no consensus, no mining, no tokens)
- Not a messaging protocol (transport is the builder's choice)
- Not a database (no queries, no indexes in the protocol layer)
- Not a programming language (no Turing-completeness in transforms)
- Not a company (no owner, MIT license, published DOI)

### Hard rules

- DOT is always exactly **153 bytes**. No variable length. No extensions.
- **Ed25519** for signing. **SHA-256** for hashing. No pluggable crypto.
- Payload max **16 bytes**. If it doesn't fit, it's a hash pointer.
- The SDK does NOT include storage, networking, identity management, UI, consensus, or tokens.
- **MIT license. Always.**

### Ping-first design

The default API call should produce a valid empty DOT (PING). Content is the exception, not the rule. The most meaningful thing a DOT can do is exist.

```javascript
const dot = await sign({ key });  // PING — zero payload, maximum meaning
```

---

## Contact

- **Issues:** [github.com/dot-protocol/protocol/issues](https://github.com/dot-protocol/protocol/issues)
- **DOI:** [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)

---

*The act of contact leaves its dot.*
