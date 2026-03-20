# @dotprotocol/sdk

Everything DOT Protocol in one install. Re-exports all packages.

[![npm](https://img.shields.io/npm/v/@dotprotocol/sdk)](https://www.npmjs.com/package/@dotprotocol/sdk)

## Install

```bash
npm install @dotprotocol/sdk
```

## Usage

```js
import {
  // Engine (high-level)
  DOT,

  // Core primitives
  createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes,
  DotType, DOTFace, composeFaces, hasFace, activeFaces,
  TransformRegistry,

  // Chain + scoring
  buildScores, computeTier, updateElo, applyEloUpdates, computeW,

  // Relay
  RelayClient, packFrame, unpackFrame,

  // Identity
  loadKeypair, saveKeypair, generateDID,

  // QR
  encodeBinary, decodeBinary, encodeSteganographic, selectQRSpec,

  // Arena
  resolveSession, rankLeaderboard, computeEloFromMatches,

  // Compression
  pack, unpack,

  // Wrapper
  wrap, unwrap,
} from '@dotprotocol/sdk';
```

## When to use

- **Prototyping** — one install gets everything
- **CLI tools** — don't need minimal bundle size
- **Server-side** — Node.js apps where install size doesn't matter

## When NOT to use

For production apps that run in the browser, import only what you need:

```bash
npm install @dotprotocol/core        # if you only need primitives
npm install dot-protocol              # if you want the high-level API
npm install @dotprotocol/qr          # if you only need QR
```

The SDK is the kitchen sink. Smaller focused installs produce smaller bundles.

## Included packages

| Package | Exports |
|---|---|
| `dot-protocol` | `DOT` |
| `@dotprotocol/core` | Primitives, types, faces, transforms |
| `@dotprotocol/chain` | WorldLine, Four-Score |
| `@dotprotocol/relay` | RelayClient, frames |
| `@dotprotocol/identity` | Keypair persistence, DID |
| `@dotprotocol/compression` | pack / unpack |
| `@dotprotocol/qr` | QR encode / decode |
| `@dotprotocol/arena` | Elo, resolution |
| `@dotprotocol/wrapper` | Binary wrap / unwrap |

## License

MIT
