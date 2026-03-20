# @dot-protocol/core

Raw primitives for the DOT Protocol. Zero runtime dependencies. This is the atom — everything else is built on top of it.

[![npm](https://img.shields.io/npm/v/@dot-protocol/core)](https://www.npmjs.com/package/@dot-protocol/core)

## Install

```bash
npm install @dot-protocol/core
```

## Quick start

```js
import { createKeypair, createDOT, verifyDOT, checkChain, toBytes, fromBytes } from '@dot-protocol/core';

const keypair = await createKeypair();
const genesis = await createDOT({ keypair });
const next    = await createDOT({ keypair, payload: 'hello', previous: genesis });

const ok    = await verifyDOT(next);              // true
const chain = await checkChain([genesis, next]);   // { valid: true }
const buf   = toBytes(genesis);                    // Uint8Array(153)
const dot   = fromBytes(buf);                      // reconstructed
```

## API

### `createKeypair()`

Generate a new Ed25519 keypair.

```js
const keypair = await createKeypair();
// { pubkey: Uint8Array(32), privkey: Uint8Array(64) }
```

### `createDOT(options)`

Create a signed, chained DOT.

```js
const dot = await createDOT({
  keypair,                         // required
  payload,                         // string | Uint8Array — up to 16 bytes
  type:     DotType.PUBLIC,        // optional — default PUBLIC
  previous: previousDot,           // optional — enables chaining
});
```

### `verifyDOT(dot)`

Verify Ed25519 signature. Returns `true` or `false`.

```js
const valid = await verifyDOT(dot);
```

### `checkChain(dots)`

Validate a sequence of DOTs — checks chain hashes link correctly.

```js
const result = await checkChain([genesis, dot2, dot3]);
// { valid: true }
// { valid: false, brokenAt: 1, reason: 'chain hash mismatch' }
```

### `toBytes(dot)` / `fromBytes(bytes)`

Serialize to/from the 153-byte wire format.

```js
const bytes  = toBytes(dot);      // Uint8Array(153)
const parsed = fromBytes(bytes);  // DOT object
```

### `DotType`

```js
import { DotType } from '@dot-protocol/core';

DotType.PUBLIC    // 0x00 — visible to anyone
DotType.CIRCLE    // 0x01 — visible to circle members
DotType.PRIVATE   // 0x02 — encrypted, recipient-only
DotType.EPHEMERAL // 0x03 — dissolves after receipt
```

### Face architecture (`DOTFace`, `composeFaces`, `hasFace`, `activeFaces`)

Composable bitfield that describes what a DOT is:

```js
import { DOTFace, composeFaces, hasFace, activeFaces } from '@dot-protocol/core';

const mask = composeFaces(DOTFace.QR, DOTFace.Container);
hasFace(mask, DOTFace.QR);  // true
activeFaces(mask);           // ['QR', 'Container']
```

### `TransformRegistry`

Register and retrieve deterministic transforms:

```js
import { TransformRegistry } from '@dot-protocol/core';

const spec = TransformRegistry.get('time-capsule');
const valid = spec.verify(inputDOT, outputDOT);

// Custom transform
TransformRegistry.register({
  id:     'my-transform',
  verify: (input, output) => Boolean(/* your logic */),
});
```

Built-in transforms: `time-capsule`, `signer-approval`, `chain-depth-gate`.

### Constants

```js
import { DOT_SIZE, PAYLOAD_SIZE, OFF } from '@dot-protocol/core';

DOT_SIZE     // 153
PAYLOAD_SIZE // 16
OFF.PUBKEY   // 0
OFF.SIG      // 32
OFF.CHAIN    // 96
OFF.TIME     // 128
OFF.TYPE     // 136
OFF.PAYLOAD  // 137
```

## Wire format

```
Bytes    Field       Size   Description
0–31     pubkey      32B    Ed25519 public key — WHO
32–95    signature   64B    Ed25519 signature — PROOF
96–127   chain       32B    SHA-256 of previous DOT — SEQUENCE
128–135  timestamp   8B     Unix milliseconds, big-endian — WHEN
136      type        1B     Visibility flag — VISIBILITY
137–152  payload     16B    Content pointer or data — WHAT
```

153 bytes. Always.

## License

MIT
