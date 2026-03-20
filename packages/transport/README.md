# @dotprotocol/transport

DOT Transport Protocol (DTP). No handshake. No session. No TLS. DOTs as the message unit.

[![npm](https://img.shields.io/npm/v/@dotprotocol/transport)](https://www.npmjs.com/package/@dotprotocol/transport)

## Install

```bash
npm install @dotprotocol/transport
```

## Quick start

```js
import { send, receive, MemoryAdapter, MemoryBus } from '@dotprotocol/transport';
import { createKeypair, sign } from '@dotprotocol/sign';

const bus = new MemoryBus();
const alice = new MemoryAdapter('alice', bus);
const bob   = new MemoryAdapter('bob', bus);

await alice.connect();
await bob.connect();

// Receive DOTs (auto-verified by default)
const unsub = receive(bob, (received) => {
  console.log(received.dot);       // verified DOT object
  console.log(received.verified);  // true
  console.log(received.transport); // 'memory'
});

// Sign and send
const key = await createKeypair();
const dot = await sign({ key, content: 'hello' });
await send(dot, alice, { channel: 'bob' });

// Clean up
unsub();
await alice.disconnect();
await bob.disconnect();
```

## API

### `send(input, adapter, opts?, queue?): Promise<boolean>`

Fire a DOT over any transport adapter. Accepts a `SignedDOT`, `DOT` object, or raw `Uint8Array(153)`.

Returns `true` if sent, `false` if queued offline.

```js
await send(dot, adapter);                              // broadcast
await send(dot, adapter, { channel: 'room-name' });    // to channel
await send(dot, adapter, { recipientKey: pubkey });     // to recipient
await send(dot, adapter, {}, offlineQueue);             // queue if disconnected
```

### `receive(adapter, handler, opts?): () => void`

Listen for incoming DOTs. Returns an unsubscribe function.

```js
const unsub = receive(adapter, (received) => {
  received.dot;        // DOT object
  received.bytes;      // Uint8Array(153)
  received.transport;  // 'memory' | 'websocket' | 'custom'
  received.receivedAt; // local timestamp
  received.verified;   // true if signature verified
}, {
  autoVerify: true,    // verify signatures (default: true)
  filterKey: pubkey,   // only DOTs from this sender
});

unsub(); // stop listening
```

### `Relay`

Stateless relay — dumb pipe, passes 153 bytes without understanding, storing, or tracking them.

```js
import { Relay, MemoryAdapter, MemoryBus } from '@dotprotocol/transport';

const bus = new MemoryBus();
const relay = new Relay({ verify: true, maxRate: 100 });

relay.addAdapter(new MemoryAdapter('peer-1', bus));
relay.addAdapter(new MemoryAdapter('peer-2', bus));

await relay.start();

const stats = relay.getStats();
// { relayed: 0, rejected: 0, peers: 2, uptime: 1234 }

await relay.stop();
```

Options:
- `verify` — verify Ed25519 signatures before relaying (default: `true`)
- `read` — relay can read content (default: `false` — dumb pipe)
- `maxRate` — max DOTs per second (0 = unlimited)

### `OfflineQueue`

DOTs queue locally when transport is disconnected, sync on reconnect.

```js
import { OfflineQueue, send } from '@dotprotocol/transport';

const queue = new OfflineQueue({ maxSize: 10_000, maxRetries: 5 });

// DOTs auto-queue when adapter is disconnected
await send(dot, adapter, {}, queue);

queue.size;   // 1
queue.peek(); // read-only view of queued entries

// Flush when reconnected
const { sent, failed } = await queue.flush(adapter);

queue.clear(); // drop all queued DOTs
```

### `MemoryAdapter` / `MemoryBus`

In-memory transport for testing and local communication.

```js
import { MemoryAdapter, MemoryBus, defaultBus } from '@dotprotocol/transport';

// Shared bus (or use the default singleton)
const bus = new MemoryBus();
const adapter = new MemoryAdapter('my-address', bus);

await adapter.connect();
await adapter.send(bytes, 'destination-address');
await adapter.disconnect();
```

### `WebSocketAdapter`

Production WebSocket transport with auto-reconnect.

```js
import { WebSocketAdapter, send, receive } from '@dotprotocol/transport';

const ws = new WebSocketAdapter({
  url: 'wss://dotdotdot.rocks',
  reconnect: true,           // auto-reconnect on disconnect (default: true)
  maxReconnectAttempts: 10,  // 0 = infinite (default: 10)
  reconnectDelay: 1000,      // base delay in ms, exponential backoff (default: 1000)
  peerId: 'my-node-id',     // optional, sent as WebSocket subprotocol
});

await ws.connect();

// Send and receive DOTs over WebSocket
receive(ws, (dot) => console.log('received:', dot.verified));
await send(signedDot, ws, { channel: 'room-name' });

await ws.disconnect();
```

## Custom transport adapters

Implement `TransportAdapter` to plug in any transport — WebSocket, Bluetooth, NFC, LoRa, QR, anything:

```ts
import type { TransportAdapter, TransportState, TransportType } from '@dotprotocol/transport';

class MyAdapter implements TransportAdapter {
  readonly type: TransportType = 'custom';
  get state(): TransportState { /* ... */ }

  async send(bytes: Uint8Array, destination: string): Promise<void> { /* ... */ }
  onReceive(handler: (bytes: Uint8Array, source: string) => void): () => void { /* ... */ }
  async connect(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
}
```

## License

MIT
