# @dotprotocol/identity

Persistent keypair + DID for DOT Protocol. Your key, your identity.

[![npm](https://img.shields.io/npm/v/@dotprotocol/identity)](https://www.npmjs.com/package/@dotprotocol/identity)

## Install

```bash
npm install @dotprotocol/identity
```

## Quick start

```js
import { loadOrCreate, generateDID } from '@dotprotocol/identity';

// Load existing keypair or create a new one
const keypair = await loadOrCreate('./my-identity.json');

// Derive a DID from the public key
const did = generateDID(keypair.pubkey);
// "did:dot:abc123def456..."
```

## API

### `loadOrCreate(path, options?)`

Load keypair from file. If the file doesn't exist, generate and save a new one.

```js
const keypair = await loadOrCreate('./identity.json');
// { pubkey: Uint8Array(32), privkey: Uint8Array(64) }
```

### `loadKeypair(path)`

Load keypair from file. Throws if not found.

```js
const keypair = await loadKeypair('./identity.json');
```

### `saveKeypair(keypair, path)`

Save keypair to file.

```js
await saveKeypair(keypair, './identity.json');
```

### `generateDID(pubkey)`

Derive a `did:dot:` DID from an Ed25519 public key.

```js
const did = generateDID(keypair.pubkey);
// "did:dot:z6Mk..." (base58btc-encoded)
```

## Identity file format

```json
{
  "pubkey": "hex-encoded-32-bytes",
  "privkey": "hex-encoded-64-bytes",
  "created": 1709000000000
}
```

Store this file securely. Anyone with the `privkey` can sign DOTs as you.

## Key backup

Your keypair IS your identity. There is no recovery service. Back it up:

```bash
# Backup
cp identity.json identity.backup.json

# Or export as hex
node -e "const k = require('./identity.json'); console.log(k.privkey)"
```

## License

MIT
