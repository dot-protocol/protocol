# @dotprotocol/relay

CHORUS relay client — WebSocket transport for DOT Protocol.

[![npm](https://img.shields.io/npm/v/@dotprotocol/relay)](https://www.npmjs.com/package/@dotprotocol/relay)

## Install

```bash
npm install @dotprotocol/relay
```

## Quick start

```js
import { RelayClient } from '@dotprotocol/relay';
import { toBytes, fromBytes } from '@dotprotocol/core';

const relay = new RelayClient('wss://dotdotdot.rocks');

await relay.connect();

// Listen for incoming DOTs
relay.on('dot', (bytes, from) => {
  const dot = fromBytes(bytes);
  console.log('received', dot.timestamp, 'from', from);
});

// Send a DOT
const bytes = toBytes(myDot);
await relay.send(bytes);

// Disconnect
await relay.disconnect();
```

## API

### `new RelayClient(url, options?)`

```js
const relay = new RelayClient('wss://dotdotdot.rocks', {
  reconnect:      true,    // auto-reconnect on disconnect (default: true)
  reconnectDelay: 1000,    // ms between reconnect attempts (default: 1000)
  maxRetries:     10,      // max reconnect attempts (default: 10)
});
```

### `relay.connect()`

Open WebSocket connection. Resolves when connected.

```js
await relay.connect();
```

### `relay.disconnect()`

Close connection cleanly.

```js
await relay.disconnect();
```

### `relay.send(bytes)`

Send a 153-byte DOT to the relay.

```js
await relay.send(toBytes(dot));
```

### `relay.on(event, handler)`

```js
// Incoming DOT
relay.on('dot', (bytes: Uint8Array, from: Uint8Array) => { ... });

// Connection events
relay.on('connect',    ()    => { ... });
relay.on('disconnect', ()    => { ... });
relay.on('error',      (err) => { ... });
```

### `packFrame(bytes)` / `unpackFrame(frame)`

Low-level frame serialization. Usually not needed directly:

```js
import { packFrame, unpackFrame } from '@dotprotocol/relay';

const frame    = packFrame(dotBytes);   // Uint8Array — relay wire frame
const dotBytes = unpackFrame(frame);    // Uint8Array(153)
```

## Relay protocol

The relay is intentionally dumb:

- Receives 153-byte DOTs wrapped in a minimal frame
- Routes `PUBLIC` (0x00) DOTs to all connected clients
- Routes `CIRCLE` (0x01) DOTs to subscribed circle members
- Routes `PRIVATE` (0x02) DOTs to the recipient public key only
- Does NOT store, index, or read payloads
- Does NOT authenticate connections

The relay knows nothing. It forwards 153 bytes.

## Self-hosting

The CHORUS relay is open source. Run your own:

```bash
npx @dotprotocol/relay-server --port 8765
```

Point clients at `ws://localhost:8765`.

## License

MIT
