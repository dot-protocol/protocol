# dot-protocol

The DOT Protocol engine — one-liner API for boot, create, verify. Start here.

[![npm](https://img.shields.io/npm/v/dot-protocol)](https://www.npmjs.com/package/dot-protocol)
[![doi](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.18946074-blue)](https://doi.org/10.5281/zenodo.18946074)

## Install

```bash
npm install dot-protocol
```

## Quick start

### Offline

```js
import { DOT } from 'dot-protocol';

await DOT.boot({ offline: true });

const bytes = await DOT.create({ WHAT: 'hello' });
console.log(bytes.length); // 153
```

### Connected to relay

```js
import { DOT } from 'dot-protocol';

await DOT.boot(); // connects to wss://dotdotdot.rocks

DOT.on('dot', (bytes, from) => {
  console.log(`153-byte DOT from ${from}`);
});

// Public message
await DOT.create({ WHAT: 'visible to all' });

// Private message to a specific recipient
await DOT.create({ WHAT: 'encrypted', WHO: recipientPublicKey });
```

## API

### `DOT.boot(options?)`

Initialize identity and optionally connect to relay.

```js
await DOT.boot({
  offline:  false,                   // default false — connects to relay
  relay:    'wss://dotdotdot.rocks', // default relay URL
  identity: './identity.json',       // keypair path (created if missing)
});
```

### `DOT.create(options?)`

Create a signed, chained 153-byte DOT.

```js
const bytes = await DOT.create({
  WHAT: 'hello',              // string | Uint8Array — up to 16 bytes
  WHO:  recipientPublicKey,   // Uint8Array(32) — for PRIVATE type
  type: 0x00,                 // override type byte
});
// Returns: Uint8Array(153)
```

Empty call is a PING (presence signal):

```js
await DOT.create({}); // 153 bytes, payload all zeros
```

### `DOT.on(event, handler)`

```js
DOT.on('dot', (bytes, from) => {
  // bytes: Uint8Array(153)
  // from:  Uint8Array(32) — sender public key
});
```

### `DOT.seal(data)` / `DOT.verifySeal(dot)`

Sealed envelope — encrypted payload that can only be opened by the intended recipient.

```js
const sealed = await DOT.seal(data, recipientPublicKey);
const opened = await DOT.verifySeal(sealed);
```

### `DOT.decryptDot(dot)`

Decrypt a PRIVATE (0x02) DOT using ECDH.

```js
const plaintext = await DOT.decryptDot(dot);
```

### `DOT.stats()`

Runtime metrics.

```js
const stats = DOT.stats();
// { dotsCreated, dotsReceived, relayConnected, uptime }
```

### `DOT.health()`

Health check — relay connection + identity status.

```js
const health = await DOT.health();
// { relay: 'connected' | 'disconnected', identity: 'loaded' | 'missing' }
```

### `DOT.shutdown()`

Clean teardown — disconnect from relay, flush pending work.

```js
await DOT.shutdown();
```

## Transform executor (v0.3.0)

```js
import { executeTransform, evaluateCondition } from 'dot-protocol';

// Execute a named transform
const result = executeTransform('time-capsule', inputDOT, outputDOT);

// Evaluate a condition directly
const open = evaluateCondition(condition, {
  nowMs:        Date.now(),
  currentDepth: 42,
  approvalDOT:  someApprovalDOT,
});
```

## Underlying packages

`dot-protocol` orchestrates these lower-level packages. Use them directly when you need more control:

| Package | Purpose |
|---|---|
| `@dot-protocol/core` | Raw primitives — keypair, sign, verify, bytes |
| `@dot-protocol/chain` | Worldlines + Four-Score reputation |
| `@dot-protocol/relay` | CHORUS WebSocket transport |
| `@dot-protocol/identity` | Persistent keypair + DID |
| `@dot-protocol/qr` | Physical DOT — QR codes |
| `@dot-protocol/arena` | Elo + blind prediction evaluation |
| `@dot-protocol/compression` | Batch packing |
| `@dot-protocol/wrapper` | Wrap binary as DOT chain |
| `@dot-protocol/sdk` | Everything in one install |

## Wire format

153 bytes. Always.

```
Bytes    Field
0–31     pubkey     Ed25519 32B — WHO
32–95    signature  Ed25519 64B — PROOF
96–127   chain      SHA-256 32B — SEQUENCE
128–135  timestamp  Unix ms 8B  — WHEN
136      type       1B          — VISIBILITY
137–152  payload    16B         — WHAT
```

## License

MIT © DOT Protocol — [doi.org/10.5281/zenodo.18946074](https://doi.org/10.5281/zenodo.18946074)
