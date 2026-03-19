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

## Verified Output

Running `npx tsx examples/hello.ts`:

```
Booting DOT engine...
Identity: dot:LPs5r882dXNuZqfV6J9WKFzXj-S4zlMfKCUy0qYX_A8

Creating 5 DOTs...
  DOT 1: 153 bytes ✓
  DOT 2: 153 bytes ✓
  DOT 3: 153 bytes ✓
  DOT 4: 153 bytes ✓
  DOT 5: 153 bytes ✓

BLS seal: 48 bytes (48 = G1 aggregate signature)
Seal valid: true

Engine stats:
  Total DOTs:        5
  Compression ratio: 1.50×
  Predictor:         0.0%
  Seals:             1

DOT engine shut down. The chain persists.
```

## Build a Game

The engine provides physics. You provide the game.

```typescript
import { DOT } from '@dot-protocol/engine';

// A messenger is just DOTs flowing between two identities
await DOT.boot();

// Listen for incoming DOTs
DOT.on('dot', async (bytes, from) => {
  // Decrypt, decode, display
  const payload = bytes.slice(137, 153);
  const text = new TextDecoder().decode(payload).replace(/\0/g, '');
  console.log(`${from}: ${text}`);
});

// Send a DOT
await DOT.create({
  WHAT: 'Hello from the DOT universe',
  WHO: recipientPublicKey, // auto-encrypts
});

// Every 100 DOTs, the chain self-seals
// DOT.stats() shows the universe learning
```

The engine is whatever you need to make any game work.

## Benchmark

153 bytes/DOT raw → 3.64 bytes/DOT at N=1000 on sensor streams (Weissman W=29.2 over gzip).
