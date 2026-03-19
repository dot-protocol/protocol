# @dot-protocol/engine

> The DOT Game Engine. Physics for the DOT universe.

One import. One boot. Identity, proof, compression, and chains run automatically.

## Install

```bash
npm install @dot-protocol/engine
```

## Hello World

```typescript
import { DOT } from '@dot-protocol/engine';

await DOT.boot();
console.log(DOT.me.did); // "dot:abc123..."

const bytes = await DOT.create({ WHAT: 'Hello, universe' });
// Already signed. Already on a chain. Physics did it.

DOT.on('dot', (dot, from) => {
  console.log(`DOT from ${from}:`, dot.length, 'bytes');
});

DOT.stats();
// { totalDots: 1000, compressionRatio: 7.4, predictorAccuracy: 0.82 }
```

## The Physics

| Physics | What happens automatically |
|---------|---------------------------|
| Identity | Device boots → keypair exists → DID exists |
| Signing | DOT.create() → signature applied → provable |
| Chaining | Each DOT links to previous → worldline grows |
| Compression | Predictor runs → ratio improves with use |
| Encryption | WHO specified → ECDH → payload encrypted |
| Sealing | Every N DOTs → BLS aggregate proof |

## Benchmark

153 bytes/DOT raw → 3.64 bytes/DOT at N=1000 on sensor streams (Weissman W=29.2 over gzip).
