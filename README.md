# DOT Protocol SDK

> 153 bytes. Ed25519 + SHA-256. Zero external dependencies.
> Published: [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)

## What is a DOT

A DOT is a contact between two things that changes both. 153 bytes, cryptographically signed:

| Offset | Size | Field | Purpose |
|--------|------|-------|---------|
| 0 | 32 | pubkey | WHO — Ed25519 public key |
| 32 | 64 | sig | PROOF — Ed25519 signature |
| 96 | 32 | chain | SEQUENCE — SHA-256 of previous DOT (zeros = genesis) |
| 128 | 8 | ts | WHEN — Unix timestamp in milliseconds (big-endian) |
| 136 | 1 | type | VISIBILITY — 0x00=public, 0x01=circle, 0x02=private, 0x03=ephemeral |
| 137 | 16 | payload | WHAT — content hash, key reference, or zero (PING) |

The empty DOT (zero payload) is called a **PING**. It is the default.

## Packages

| Package | Purpose |
|---------|---------|
| [`@dot-protocol/core`](./packages/core) | Wire format, Ed25519 sign/verify, SHA-256 chain hashing |
| [`@dot-protocol/identity`](./packages/identity) | Keypair generation, genesis DOT, export/import |
| [`@dot-protocol/chain`](./packages/chain) | Append-only worldline with pluggable storage |
| [`@dot-protocol/relay`](./packages/relay) | CHORUS relay client + server (185-byte frames) |

## Quick Start

```bash
pnpm add @dot-protocol/core @dot-protocol/identity @dot-protocol/chain
```

```typescript
import { createIdentity } from '@dot-protocol/identity';
import { createChain, appendDOT } from '@dot-protocol/chain';
import { createDOT, verifyDOT, DotType } from '@dot-protocol/core';

// Create an identity
const identity = await createIdentity();

// Start a worldline
const chain = await createChain(identity.genesisDOT);

// Add a DOT
const dot = await createDOT({
  keypair: identity.keypair,
  type: DotType.PUBLIC,
  payload: new TextEncoder().encode('hello').slice(0, 16),
  previous: identity.genesisDOT,
});
await appendDOT(chain, dot);

// Verify
const ok = await verifyDOT(dot);
console.log(ok); // true
```

## Relay (CHORUS)

The relay package enables DOTs to travel over WebSocket. The wire frame is 185 bytes: 32B circle ID + 153B DOT.

```typescript
import { RelayClient } from '@dot-protocol/relay';

const client = new RelayClient({ url: 'ws://localhost:8765', keypair });
await client.connect();

client.onFrame((frame) => {
  console.log('received DOT from circle:', frame.circleId);
});

await client.sendFrame('my-circle', dotBytes);
```

## Design Principles

1. **No central control.** No server required. Devices are peers.
2. **Best-effort delivery.** The SDK creates and verifies DOTs. Transport is the builder's choice.
3. **Stateless relays.** A relay passes 153 bytes without understanding, storing, or tracking them.
4. **End-to-end verification.** Signing and verification happen on user devices.
5. **Payload is a pointer.** 16 bytes can hold a content hash pointing to media stored anywhere.

## DOT Types

| Value | Name | Visibility |
|-------|------|-----------|
| `0x00` | PUBLIC | Anyone can see |
| `0x01` | CIRCLE | Circle members only |
| `0x02` | PRIVATE | Encrypted, addressee only |
| `0x03` | EPHEMERAL | Dissolve after display |

## Development

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Test all packages
pnpm test

# Typecheck all packages
pnpm typecheck
```

## License

MIT — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)
