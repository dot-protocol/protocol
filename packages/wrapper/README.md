# @dot-protocol/wrapper

Wrap any binary data as a DOT chain. Legacy bridge for existing binary formats.

[![npm](https://img.shields.io/npm/v/@dot-protocol/wrapper)](https://www.npmjs.com/package/@dot-protocol/wrapper)

## Install

```bash
npm install @dot-protocol/wrapper
```

## Quick start

```js
import { wrap, unwrap } from '@dot-protocol/wrapper';
import { createKeypair } from '@dot-protocol/core';

const keypair = await createKeypair();

// Wrap a file as a DOT chain
const fileBytes = fs.readFileSync('document.pdf');
const chain     = await wrap(keypair, fileBytes);

// chain is DOT[] — 153-byte DOTs containing the full file
console.log(`${fileBytes.length} bytes → ${chain.length} DOTs`);

// Reconstruct original bytes
const recovered = await unwrap(chain);
```

## How it works

`wrap()` chunks input bytes into 16-byte payload slices. Each chunk becomes one DOT, cryptographically chained to the previous. The full chain is the original data plus provenance.

```
[file bytes] → chunks of 16 → [DOT 1] → [DOT 2] → ... → [DOT N]
                                   ↑          ↑               ↑
                              chain hash  chain hash      chain hash
```

`unwrap()` reads payloads in order, verifies every link, and reconstructs the original bytes.

## API

### `wrap(keypair, data, options?)`

```js
const chain = await wrap(keypair, data, {
  chunkSize: 16,      // bytes per DOT payload (default 16 = max)
  type:      0x00,    // DOT type for all wrapped DOTs
});
// Returns: DOT[]
```

### `unwrap(chain)`

```js
const bytes = await unwrap(chain);
// Verifies all signatures and chain hashes before returning
// Throws if any DOT is invalid or chain is broken
```

### `wrapStream(keypair, readableStream)`

```js
import { wrapStream } from '@dot-protocol/wrapper';

const dots = [];
for await (const dot of wrapStream(keypair, fs.createReadStream('big-file.bin'))) {
  dots.push(dot);
}
```

## Use cases

- Make existing binary files verifiable (who created it, when, has it changed?)
- Archive files with cryptographic provenance
- Stream media with tamper detection on every 16-byte chunk
- Bridge non-DOT-native data into DOT-compatible systems

## Storage efficiency

Each 16 bytes of data requires 153 bytes of DOT — a 9.6× overhead. For large files, store the file externally (IPFS, S3) and use a single DOT as an attestation instead:

```js
import { createDOT } from '@dot-protocol/core';
import { sha256 } from '@dot-protocol/core';

const hash    = await sha256(fileBytes);
const pointer = hash.slice(0, 16);        // first 16 bytes of hash
const dot     = await createDOT({ keypair, payload: pointer });
// One DOT = proof of who created the file and when
```

Use `wrap()` only when you need the data itself to be chain-verifiable and DOT-portable.

## License

MIT
