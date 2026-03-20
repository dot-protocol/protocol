# @dot-protocol/sdk

Everything DOT Protocol in one install. Re-exports all packages.

[![npm](https://img.shields.io/npm/v/@dot-protocol/sdk)](https://www.npmjs.com/package/@dot-protocol/sdk)

## Install

```bash
npm install @dot-protocol/sdk
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
} from '@dot-protocol/sdk';
```

## When to use

- **Prototyping** — one install gets everything
- **CLI tools** — don't need minimal bundle size
- **Server-side** — Node.js apps where install size doesn't matter

## When NOT to use

For production apps that run in the browser, import only what you need:

```bash
npm install @dot-protocol/core        # if you only need primitives
npm install dot-protocol              # if you want the high-level API
npm install @dot-protocol/qr          # if you only need QR
```

The SDK is the kitchen sink. Smaller focused installs produce smaller bundles.

## Included packages

| Package | Exports |
|---|---|
| `dot-protocol` | `DOT` |
| `@dot-protocol/core` | Primitives, types, faces, transforms |
| `@dot-protocol/chain` | WorldLine, Four-Score |
| `@dot-protocol/relay` | RelayClient, frames |
| `@dot-protocol/identity` | Keypair persistence, DID |
| `@dot-protocol/compression` | pack / unpack |
| `@dot-protocol/qr` | QR encode / decode |
| `@dot-protocol/arena` | Elo, resolution |
| `@dot-protocol/wrapper` | Binary wrap / unwrap |

## License

MIT
