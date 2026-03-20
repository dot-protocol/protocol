# @dotprotocol/sign

Universal DOT observation signing. Content is opaque bytes — any size. Face tells type. TEACH tells how to read.

[![npm](https://img.shields.io/npm/v/@dotprotocol/sign)](https://www.npmjs.com/package/@dotprotocol/sign)

## Install

```bash
npm install @dotprotocol/sign
```

## Quick start

```js
import { createKeypair, sign, verify, chain, describe } from '@dotprotocol/sign';

const key = await createKeypair();

// Sign a PING (empty DOT — the default)
const ping = await sign({ key });

// Sign with content — stored directly if <=16 bytes
const dot = await sign({ key, content: 'hello', prev: ping.hash });

// Sign with large content — truncated SHA-256 hash stored as payload pointer
const big = await sign({ key, content: someLargeBuffer, prev: dot.hash });

// Verify any format: SignedDOT, DOT object, or raw 153 bytes
await verify(dot);          // true
await verify(dot.bytes);    // true

// Verify chain integrity
const result = await chain([ping, dot, big]);
// { valid: true, length: 3 }

// Human-readable description
const info = describe(dot);
// { key, chain, time, ts, access, payload, faces, teach, isGenesis, isPing, size }
```

## API

### `sign(input): Promise<SignedDOT>`

Sign any content into a DOT. Content handling is automatic:
- **No content** — produces a PING (zero payload)
- **<=16 bytes** — stored directly in the 16-byte payload
- **>16 bytes** — truncated SHA-256 hash stored as a pointer in payload

```js
const result = await sign({
  key,                        // Ed25519 keypair (required)
  content: 'hello',           // string | Uint8Array (optional)
  access: AccessLevel.PUBLIC, // public | circle | private | ephemeral
  face: composeFaces(Face.Camera, Face.QR),  // bitfield (optional)
  teach: TeachByte.SelfDescribing,           // how to read (optional)
  prev: previousDot.hash,    // chain to previous DOT (optional)
  transform: 'time-capsule', // named transform (optional)
  ts: Date.now(),             // explicit timestamp (optional)
});

result.dot;         // DOT object (153 bytes)
result.bytes;       // Uint8Array(153) — wire format
result.hash;        // SHA-256 of wire bytes — use as `prev` for next DOT
result.contentHash; // full SHA-256 of content (only if content > 16 bytes)
```

### `verify(input): Promise<boolean>`

Verify a DOT's Ed25519 signature. Accepts a `SignedDOT`, a `DOT` object, or raw `Uint8Array(153)`.

```js
await verify(signedDot);    // true
await verify(dot.bytes);    // true
await verify(rawBytes);     // true
```

### `chain(dots): Promise<ChainResult>`

Verify chain integrity for an array of DOTs (any supported format).

```js
const result = await chain([genesis, dot2, dot3]);
// { valid: true, length: 3 }
// { valid: false, length: 3, brokenAt: 1, reason: 'chain hash mismatch' }
```

### `describe(input): DOTDescription`

Human-readable description of any DOT.

```js
const info = describe(signedDot);
info.key;       // public key hex
info.chain;     // chain hash hex
info.time;      // ISO 8601 timestamp
info.access;    // 'public' | 'circle' | 'private' | 'ephemeral'
info.payload;   // payload hex
info.faces;     // ['Camera', 'QR']
info.teach;     // 'self-describing'
info.isGenesis; // true if chain hash is all zeros
info.isPing;    // true if payload is all zeros
info.size;      // 153
```

### `contentHash(content): Promise<Uint8Array>`

Full SHA-256 hash of content bytes.

### `truncatedHash(content): Promise<Uint8Array>`

First 16 bytes of SHA-256 — fits in a DOT payload as a content pointer.

## Types

```js
import { Face, AccessLevel, TeachByte } from '@dotprotocol/sign';

// AccessLevel (re-exported from core)
AccessLevel.PUBLIC    // 0x00
AccessLevel.CIRCLE    // 0x01
AccessLevel.PRIVATE   // 0x02
AccessLevel.EPHEMERAL // 0x03

// TeachByte — how to read this DOT
TeachByte.None            // 0x00
TeachByte.SelfDescribing  // 0x01
TeachByte.SchemaRef       // 0x02
TeachByte.HumanReadable   // 0x03
TeachByte.MachineReadable // 0x04
```

## License

MIT
