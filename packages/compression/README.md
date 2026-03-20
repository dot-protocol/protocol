# @dot-protocol/compression

Batch packing for DOT Protocol — Ed25519 + BLS12-381 signature aggregation.

[![npm](https://img.shields.io/npm/v/@dot-protocol/compression)](https://www.npmjs.com/package/@dot-protocol/compression)

## Install

```bash
npm install @dot-protocol/compression
```

## Quick start

```js
import { pack, unpack } from '@dot-protocol/compression';

// Pack 1000 DOTs for storage/transport
const packed  = pack(dots);         // much smaller than 1000 × 153 bytes
const restored = unpack(packed);    // original DOTs, fully verified
```

## When to use

- Storing large numbers of DOTs in a database
- Transmitting batches over bandwidth-constrained channels
- Archiving worldlines
- Feed snapshots

## API

### `pack(dots, options?)`

Aggregate a batch of DOTs into a compact representation.

```js
const packed = pack(dots, {
  method: 'ed25519',    // default — lossless compression
  // method: 'bls'     // BLS12-381 signature aggregation (experimental)
});
// Returns: Uint8Array
```

### `unpack(packed)`

Restore DOTs from a packed batch. Verifies all signatures.

```js
const dots = unpack(packed);
// Returns: DOT[]
```

### `packStream(dotStream)`

Streaming pack — useful for very large archives:

```js
import { packStream } from '@dot-protocol/compression';

const writer = packStream(outputStream);
for await (const dot of dotStream) {
  writer.write(dot);
}
await writer.end();
```

## Compression ratios

Typical results with `ed25519` method (LZ4 + deduplication):

| DOTs | Raw size | Packed size | Ratio |
|------|----------|-------------|-------|
| 100 | 15.3 KB | ~4-6 KB | ~3x |
| 1,000 | 153 KB | ~35-55 KB | ~3-4x |
| 10,000 | 1.53 MB | ~300-500 KB | ~4-5x |

Actual ratios depend on payload entropy.

## License

MIT
