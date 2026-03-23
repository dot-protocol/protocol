# DOT Protocol — Sign & Transport Guide

The `@dotprotocol/sign` and `@dotprotocol/transport` packages form the universal observation and delivery layer of DOT Protocol. Sign creates DOTs. Transport moves them. Together they enable any application pattern — from encrypted messaging to IoT sensor chains to offline QR communication.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Sign Package](#sign-package)
  - [sign()](#sign)
  - [verify()](#verify)
  - [chain()](#chain)
  - [describe()](#describe)
  - [Content Handling](#content-handling)
  - [DOT Faces](#dot-faces)
  - [TEACH Byte](#teach-byte)
  - [Access Levels](#access-levels)
  - [Transforms](#transforms)
- [Transport Package](#transport-package)
  - [send()](#send)
  - [receive()](#receive)
  - [Relay](#relay)
  - [OfflineQueue](#offlinequeue)
  - [MemoryAdapter](#memoryadapter)
  - [WebSocketAdapter](#websocketadapter)
  - [Custom Adapters](#custom-adapters)
- [Cross-Package Patterns](#cross-package-patterns)
  - [Sign → Send → Receive → Verify](#sign--send--receive--verify)
  - [Chain of DOTs Over Transport](#chain-of-dots-over-transport)
  - [Contact Exchange](#contact-exchange)
  - [Offline Queue with Signed DOTs](#offline-queue-with-signed-dots)
  - [Relay Between Peers](#relay-between-peers)

---

## Quick Start

```bash
npm install @dotprotocol/sign @dotprotocol/transport
```

```typescript
import { sign, verify, chain, describe, createKeypair, Face, AccessLevel, TeachByte } from '@dotprotocol/sign';
import { send, receive, MemoryAdapter, MemoryBus, WebSocketAdapter, Relay, OfflineQueue } from '@dotprotocol/transport';
```

### Hello world: sign and send a DOT

```typescript
import { sign, verify, createKeypair } from '@dotprotocol/sign';
import { send, receive, MemoryAdapter, MemoryBus } from '@dotprotocol/transport';

// Create identities
const alice = await createKeypair();
const bob = await createKeypair();

// Sign a DOT
const dot = await sign({ key: alice, content: 'hello bob' });
console.log(dot.bytes.length); // 153

// Set up transport
const bus = new MemoryBus();
const aliceAdapter = new MemoryAdapter('alice', bus);
const bobAdapter = new MemoryAdapter('bob', bus);

// Bob listens
receive(bobAdapter, (received) => {
  console.log('Verified:', received.verified);     // true
  console.log('Transport:', received.transport);   // 'memory'
  console.log('Size:', received.bytes.length);     // 153
});

// Connect and send
await aliceAdapter.connect();
await bobAdapter.connect();
await send(dot, aliceAdapter, { channel: 'bob' });
```

---

## Sign Package

`@dotprotocol/sign` provides four functions and content-aware signing. It handles the complexity of DOT creation — payload encoding, hash pointers, face composition, TEACH bytes, and chain linking.

### sign()

Create a signed DOT. The default is a PING (empty DOT).

```typescript
async function sign(input: SignInput): Promise<SignedDOT>
```

#### PING (empty DOT — the default)

```typescript
const key = await createKeypair();
const ping = await sign({ key });
// ping.bytes.length === 153
// ping.dot.payload.every(b => b === 0) === true (all zeros)
```

#### With content

```typescript
// String content (<=16 bytes stored directly in payload)
const dot = await sign({ key, content: 'hello' });

// Uint8Array content
const dot = await sign({ key, content: new Uint8Array([1, 2, 3]) });

// Large content (>16 bytes → truncated SHA-256 hash pointer)
const photo = new Uint8Array(100_000); // 100KB image
const dot = await sign({ key, content: photo });
// dot.contentHash — full 32-byte SHA-256 of the photo
// dot.dot.payload — first 16 bytes of that hash (pointer)
```

#### Full options

```typescript
const dot = await sign({
  key,                                    // Required: Ed25519 keypair
  content: 'observation',                 // Optional: string, Uint8Array, or omit for PING
  access: AccessLevel.CIRCLE,             // Optional: PUBLIC (default), CIRCLE, PRIVATE, EPHEMERAL
  face: Face.Camera | Face.QR,            // Optional: bitfield of DOT Faces
  teach: TeachByte.SelfDescribing,        // Optional: TEACH byte for royalty propagation
  transform: 'time-capsule',             // Optional: named transform ID
  prev: previousDotBytes,                // Optional: previous DOT bytes for chaining
  ts: Date.now(),                         // Optional: override timestamp (Unix ms)
});
```

#### SignedDOT return type

```typescript
interface SignedDOT {
  dot: DOT;                 // Parsed DOT object
  bytes: Uint8Array;        // 153-byte wire format
  hash: Uint8Array;         // SHA-256 of wire bytes (32 bytes)
  face: number;             // Face bitfield
  teach: TeachByte;         // TEACH byte value
  transform?: string;       // Transform ID
  contentHash?: Uint8Array; // Full SHA-256 of large content (only if >16 bytes)
}
```

### verify()

Verify any DOT format — `SignedDOT`, `DOT` object, or raw `Uint8Array(153)`.

```typescript
const ok = await verify(signedDot);     // from sign() result
const ok = await verify(signedDot.dot); // DOT object
const ok = await verify(signedDot.bytes); // raw 153 bytes
const ok = await verify(tamperedBytes); // false
```

### chain()

Validate chain integrity across an array of DOTs. Accepts mixed formats.

```typescript
const key = await createKeypair();
const d1 = await sign({ key });
const d2 = await sign({ key, prev: d1.bytes });
const d3 = await sign({ key, prev: d2.bytes });

const result = await chain([d1, d2, d3]);
// result.valid === true
// result.length === 3

// Mixed formats work
const result = await chain([d1, d2.bytes, d3.dot]);

// Detects breaks
const broken = await sign({ key }); // not chained to d1
const result = await chain([d1, broken]);
// result.valid === false
// result.brokenAt === 1
```

### describe()

Human-readable description of any DOT.

```typescript
const desc = describe(dot);
// desc.isPing      — boolean
// desc.isGenesis   — boolean (zero chain hash)
// desc.access      — 'public' | 'circle' | 'private' | 'ephemeral'
// desc.size        — 153
// desc.key         — hex string (64 chars)
// desc.time        — ISO 8601 string
// desc.ts          — Unix ms number
// desc.faces       — string[] (e.g., ['Camera', 'QR'])
// desc.teach       — string (e.g., 'self-describing')
```

### Content Handling

The `sign()` function automatically handles content sizing:

| Content size | What happens | `contentHash` |
|---|---|---|
| No content | PING — all-zero payload | `undefined` |
| 1–16 bytes | Stored directly in payload | `undefined` |
| >16 bytes | SHA-256 hash truncated to 16 bytes stored in payload | Full 32-byte SHA-256 |

```typescript
// Direct storage (<=16 bytes)
const dot = await sign({ key, content: 'hello' });
// dot.dot.payload[0..4] === UTF-8 bytes of 'hello'
// dot.contentHash === undefined

// Hash pointer (>16 bytes)
const dot = await sign({ key, content: largeBuffer });
// dot.dot.payload === truncatedSHA256(largeBuffer)[0..15]
// dot.contentHash === SHA-256(largeBuffer) (32 bytes)
```

#### Utility functions

```typescript
import { contentHash, truncatedHash } from '@dotprotocol/sign';

const full = await contentHash(data);           // Uint8Array(32) — full SHA-256
const trunc = await truncatedHash(data);        // Uint8Array(16) — first 16 bytes
```

### DOT Faces

Faces classify what a DOT observes. They compose as a bitfield.

```typescript
import { Face } from '@dotprotocol/sign';

// Available faces (12 alphabet + 1 operator)
Face.File           // 0x001 — data at rest
Face.Tunnel         // 0x002 — data in transit
Face.Container      // 0x004 — DOT carrying DOTs
Face.Reader         // 0x008 — data being consumed
Face.Camera         // 0x010 — visual observation
Face.QR             // 0x020 — scannable physical DOT
Face.Writer         // 0x040 — data being produced
Face.Steganography  // 0x080 — hidden data
Face.Microdot       // 0x100 — minimal physical encoding
Face.Compiler       // 0x200 — format conversion
Face.Connector      // 0x400 — bridge between systems
Face.SelfAware      // 0x800 — observing chain health
Face.Transformer    // 0x1000 — state transition operator

// Compose with bitwise OR
const dot = await sign({ key, face: Face.Camera | Face.QR | Face.Container });

// Check in description
const desc = describe(dot);
desc.faces; // ['Camera', 'QR', 'Container']
```

### TEACH Byte

The TEACH byte signals how to read a DOT and enables royalty propagation.

```typescript
import { TeachByte } from '@dotprotocol/sign';

TeachByte.None             // 0x00 — no instruction
TeachByte.SelfDescribing   // 0x01 — DOT explains itself
TeachByte.SchemaRef        // 0x02 — payload references a schema
TeachByte.HumanReadable    // 0x03 — payload is human-readable text
TeachByte.MachineReadable  // 0x04 — payload is structured data

const dot = await sign({ key, teach: TeachByte.HumanReadable });
```

### Access Levels

```typescript
import { AccessLevel } from '@dotprotocol/sign';

AccessLevel.PUBLIC    // 0x00 — visible to anyone
AccessLevel.CIRCLE    // 0x01 — visible to circle members
AccessLevel.PRIVATE   // 0x02 — encrypted, recipient-only
AccessLevel.EPHEMERAL // 0x03 — dissolves after receipt
```

### Transforms

Named, deterministic state transitions.

```typescript
const dot = await sign({
  key,
  transform: 'time-capsule',
  content: conditionBytes,
});
// dot.transform === 'time-capsule'
```

---

## Transport Package

`@dotprotocol/transport` implements the DOT Transport Protocol (DTP): no handshake, no session, no TLS. DOTs are the message unit. Any transport underneath.

### send()

Fire a DOT over any transport adapter.

```typescript
async function send(
  input: Uint8Array | DOT | SignedDOT,
  adapter: TransportAdapter,
  options?: SendOptions,
  queue?: OfflineQueue
): Promise<boolean>
```

```typescript
// Send a SignedDOT (auto-extracts 153 bytes)
await send(signedDot, adapter);

// Send raw bytes
await send(dotBytes, adapter);

// Send to specific channel
await send(dot, adapter, { channel: 'my-room' });

// Send to specific recipient (by public key)
await send(dot, adapter, { recipientKey: bobPublicKey });

// Send with offline queue fallback
const ok = await send(dot, adapter, undefined, queue);
// ok === false if queued (adapter disconnected)
// ok === true if sent successfully
```

### receive()

Listen for incoming DOTs with auto-verification.

```typescript
function receive(
  adapter: TransportAdapter,
  handler: (dot: ReceivedDOT) => void,
  options?: ReceiveOptions
): () => void  // returns unsubscribe function
```

```typescript
// Basic receive (auto-verifies, drops invalid)
const unsub = receive(adapter, (dot) => {
  console.log(dot.verified);     // true (invalid DOTs are dropped)
  console.log(dot.transport);    // 'memory' | 'websocket' | 'custom'
  console.log(dot.bytes.length); // 153
  console.log(dot.receivedAt);   // Unix ms
  console.log(dot.dot);          // parsed DOT object
});

// Filter by sender public key
receive(adapter, handler, { filterKey: alicePublicKey });

// Stop listening
unsub();
```

#### ReceivedDOT

```typescript
interface ReceivedDOT {
  bytes: Uint8Array;      // 153-byte wire format
  dot: DOT;               // Parsed DOT object
  verified: boolean;      // Ed25519 signature verified
  transport: string;      // Adapter type ('memory', 'websocket', etc.)
  receivedAt: number;     // Unix ms when received
}
```

### Relay

Stateless relay — dumb pipe. Passes 153 bytes without understanding them.

```typescript
const relay = new Relay({
  verify: true,    // verify Ed25519 signatures before relaying (default: true)
  maxRate: 100,    // max DOTs per second, 0 = unlimited (default: 0)
});

// Add transport adapters
relay.addAdapter(new MemoryAdapter('peer1', bus));
relay.addAdapter(new MemoryAdapter('peer2', bus));
relay.addAdapter(new WebSocketAdapter({ url: 'wss://relay.example' }));

await relay.start();

// Stats
const stats = relay.getStats();
// stats.relayed  — DOTs successfully forwarded
// stats.rejected — DOTs dropped (invalid signature, rate limit, wrong size)
// stats.peers    — connected adapter count
// stats.uptime   — ms since start

await relay.stop();
```

### OfflineQueue

Queue DOTs when transport is disconnected. Flush on reconnect.

```typescript
const queue = new OfflineQueue({
  maxSize: 10_000,   // drop oldest when full (default: unlimited)
  maxRetries: 5,     // drop entry after N flush failures (default: 3)
});

// DOTs auto-queue when adapter is disconnected
await send(dot, adapter, { channel: 'room' }, queue);
// Returns false (queued, not sent)

queue.size;     // 1
queue.peek();   // read-only view of queued entries

// Later: reconnect and flush
await adapter.connect();
const { sent, failed } = await queue.flush(adapter);

queue.clear();  // drop all queued DOTs
```

### MemoryAdapter

In-memory transport for testing and local IPC.

```typescript
// Shared bus (or use defaultBus singleton)
const bus = new MemoryBus();

const alice = new MemoryAdapter('alice', bus);
const bob = new MemoryAdapter('bob', bus);

await alice.connect();
await bob.connect();

// Direct send
await alice.send(dotBytes, 'bob');

// Receive
bob.onReceive((bytes, source) => {
  console.log(bytes.length); // 153
  console.log(source);        // 'alice'
});

// Bus operations
bus.broadcast(dotBytes, 'alice');  // send to all addresses
bus.addressCount;                  // 2
bus.clear();                       // remove all listeners
```

### WebSocketAdapter

Production WebSocket transport with auto-reconnect.

```typescript
const ws = new WebSocketAdapter({
  url: 'wss://dotdotdot.rocks',
  reconnect: true,            // auto-reconnect on disconnect (default: true)
  maxReconnectAttempts: 10,   // 0 = infinite (default: 10)
  reconnectDelay: 1000,       // base delay in ms, exponential backoff (default: 1000)
  peerId: 'my-node',         // optional, sent as WebSocket subprotocol
});

await ws.connect();

// Send 153-byte DOT
await ws.send(dotBytes, 'channel-name');

// Receive
ws.onReceive((bytes, source) => {
  // Only 153-byte binary frames are delivered
  console.log(bytes.length); // 153
});

// State
ws.state;  // 'disconnected' | 'connecting' | 'connected' | 'error'
ws.type;   // 'websocket'

await ws.disconnect(); // stops auto-reconnect
```

### Custom Adapters

Implement `TransportAdapter` to add any physical transport.

```typescript
import type { TransportAdapter, TransportState, TransportType } from '@dotprotocol/transport';

class BluetoothAdapter implements TransportAdapter {
  readonly type: TransportType = 'custom';
  private _state: TransportState = 'disconnected';
  private handlers: ((bytes: Uint8Array, source: string) => void)[] = [];

  get state() { return this._state; }

  async send(bytes: Uint8Array, destination: string): Promise<void> {
    if (this._state !== 'connected') throw new Error('Not connected');
    if (bytes.length !== 153) throw new Error('DOT must be 153 bytes');
    // Send via BLE characteristic write
    await this.bleDevice.writeCharacteristic(bytes);
  }

  onReceive(handler: (bytes: Uint8Array, source: string) => void): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  async connect(): Promise<void> {
    this._state = 'connecting';
    this.bleDevice = await navigator.bluetooth.requestDevice({ /* ... */ });
    // Subscribe to BLE notifications
    this.bleDevice.onNotification((data) => {
      if (data.length === 153) {
        for (const handler of this.handlers) handler(data, this.bleDevice.id);
      }
    });
    this._state = 'connected';
  }

  async disconnect(): Promise<void> {
    this.bleDevice?.disconnect();
    this._state = 'disconnected';
  }
}
```

---

## Cross-Package Patterns

### Sign → Send → Receive → Verify

The complete round-trip.

```typescript
import { sign, verify, createKeypair } from '@dotprotocol/sign';
import { send, receive, MemoryAdapter, MemoryBus } from '@dotprotocol/transport';

const key = await createKeypair();
const dot = await sign({ key, content: 'hello' });

const bus = new MemoryBus();
const sender = new MemoryAdapter('sender', bus);
const receiver = new MemoryAdapter('receiver', bus);

const received = [];
receive(receiver, (r) => received.push(r));

await sender.connect();
await receiver.connect();
await send(dot, sender, { channel: 'receiver' });

// Wait for async verification
await new Promise(r => setTimeout(r, 50));

console.log(received[0].verified);   // true
console.log(received[0].bytes.length); // 153

// Cross-verify with sign package
console.log(await verify(received[0].bytes)); // true
console.log(await verify(received[0].dot));   // true
```

### Chain of DOTs Over Transport

Sign a chain, send each DOT, verify the chain on the receiver.

```typescript
import { sign, chain, createKeypair } from '@dotprotocol/sign';
import { send, receive, MemoryAdapter, MemoryBus } from '@dotprotocol/transport';

const key = await createKeypair();
const bus = new MemoryBus();
const sender = new MemoryAdapter('sender', bus);
const receiver = new MemoryAdapter('receiver', bus);

const received = [];
receive(receiver, (r) => received.push(r));
await sender.connect();
await receiver.connect();

// Sign and send a chain of 5 DOTs
let prev;
for (let i = 0; i < 5; i++) {
  const dot = await sign({ key, content: `msg-${i}`, prev });
  prev = dot.bytes;
  await send(dot, sender, { channel: 'receiver' });
}

await new Promise(r => setTimeout(r, 100));

// Verify chain integrity on received DOTs
const result = await chain(received.map(r => r.dot));
console.log(result.valid);  // true
console.log(result.length); // 5
```

### Contact Exchange

Two-party handshake: each DOT's payload contains the other's public key.

```typescript
const alice = await createKeypair();
const bob = await createKeypair();

const bus = new MemoryBus();
const aliceAdapter = new MemoryAdapter('alice', bus);
const bobAdapter = new MemoryAdapter('bob', bus);

const aliceReceived = [];
const bobReceived = [];

receive(aliceAdapter, (r) => aliceReceived.push(r));
receive(bobAdapter, (r) => bobReceived.push(r));

await aliceAdapter.connect();
await bobAdapter.connect();

// Alice → Bob: payload = Bob's public key (first 16 bytes)
const aliceDot = await sign({ key: alice, content: bob.publicKey.slice(0, 16) });
await send(aliceDot, aliceAdapter, { channel: 'bob' });

// Bob → Alice: payload = Alice's public key (first 16 bytes)
const bobDot = await sign({ key: bob, content: alice.publicKey.slice(0, 16) });
await send(bobDot, bobAdapter, { channel: 'alice' });

// Both received and verified
await new Promise(r => setTimeout(r, 100));
console.log(bobReceived[0].verified);   // true — Alice's DOT verified
console.log(aliceReceived[0].verified); // true — Bob's DOT verified
```

### Offline Queue with Signed DOTs

Sign DOTs while offline, queue them, flush on reconnect.

```typescript
const key = await createKeypair();
const bus = new MemoryBus();
const adapter = new MemoryAdapter('sender', bus);
const queue = new OfflineQueue();

// Sign while offline
const d1 = await sign({ key, content: 'offline-1' });
const d2 = await sign({ key, content: 'offline-2', prev: d1.bytes });

// Queued (adapter not connected)
await send(d1, adapter, { channel: 'room' }, queue);
await send(d2, adapter, { channel: 'room' }, queue);
console.log(queue.size); // 2

// Reconnect and flush
await adapter.connect();
const { sent, failed } = await queue.flush(adapter);
console.log(sent);   // 2
console.log(failed); // 0
console.log(queue.size); // 0
```

### Relay Between Peers

Stateless relay forwarding signed DOTs.

```typescript
const key = await createKeypair();
const dot = await sign({ key, content: 'relayed' });

const bus = new MemoryBus();
const relay = new Relay({ verify: true });

const peer1 = new MemoryAdapter('peer1', bus);
const peer2 = new MemoryAdapter('peer2', bus);

relay.addAdapter(peer1);
relay.addAdapter(peer2);
await relay.start();

// Inject a DOT into the relay via peer1
bus.publish('peer1', dot.bytes, 'external');

await new Promise(r => setTimeout(r, 100));
const stats = relay.getStats();
console.log(stats.relayed);  // 1 (valid DOT forwarded)
console.log(stats.rejected); // 0

await relay.stop();
```

---

## API Reference Summary

### @dotprotocol/sign

| Export | Type | Description |
|---|---|---|
| `sign(input)` | `async → SignedDOT` | Sign a DOT. Default = PING. |
| `verify(input)` | `async → boolean` | Verify signature. Accepts any format. |
| `chain(dots)` | `async → ChainResult` | Validate chain integrity. |
| `describe(input)` | `→ DOTDescription` | Human-readable description. |
| `contentHash(data)` | `async → Uint8Array(32)` | Full SHA-256. |
| `truncatedHash(data)` | `async → Uint8Array(16)` | First 16 bytes of SHA-256. |
| `createKeypair(seed?)` | `async → Keypair` | Ed25519 keypair. |
| `Face` | `enum` | 12+1 DOT Face bitfield. |
| `AccessLevel` | `enum` | PUBLIC, CIRCLE, PRIVATE, EPHEMERAL. |
| `TeachByte` | `enum` | None, SelfDescribing, SchemaRef, HumanReadable, MachineReadable. |

### @dotprotocol/transport

| Export | Type | Description |
|---|---|---|
| `send(input, adapter, opts?, queue?)` | `async → boolean` | Send a DOT. |
| `receive(adapter, handler, opts?)` | `→ () => void` | Listen for DOTs. Returns unsub. |
| `Relay` | `class` | Stateless relay. |
| `OfflineQueue` | `class` | Queue for disconnected sends. |
| `MemoryAdapter` | `class` | In-memory transport (testing). |
| `MemoryBus` | `class` | Shared in-memory message bus. |
| `WebSocketAdapter` | `class` | Production WebSocket transport. |
| `defaultBus` | `MemoryBus` | Singleton default bus. |

---

*153 bytes. The minimum viable fact. The act of contact leaves its dot.*
