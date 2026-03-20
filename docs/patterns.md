# DOT Protocol — Building Patterns

Copy-paste patterns for common use cases. Every example is self-contained.

---

## Table of Contents

- [Chat Room](#chat-room)
- [Encrypted DMs](#encrypted-dms)
- [Circle (Group Chat)](#circle-group-chat)
- [Bot / Agent Identity](#bot--agent-identity)
- [Audio / Video Stream](#audio--video-stream)
- [Media Attestation](#media-attestation)
- [Reputation from Worldline](#reputation-from-worldline)
- [Time-Capsule Message](#time-capsule-message)
- [Physical DOT (QR Code)](#physical-dot-qr-code)
- [Prediction Market (Arena)](#prediction-market-arena)
- [Feed / Timeline](#feed--timeline)
- [Presence (PING heartbeat)](#presence-ping-heartbeat)

---

## Chat Room

A public channel where everyone can read.

```js
import { DOT } from 'dot-protocol';

// --- Sender ---
await DOT.boot(); // connects to wss://dotdotdot.rocks

const msg = await DOT.create({ WHAT: 'hello world' });
// 153 bytes, type PUBLIC (0x00), broadcast to all connected

// --- Receiver ---
await DOT.boot();

DOT.on('dot', (bytes, from) => {
  const dot = DOT.parse(bytes);
  if (dot.type === 0x00) { // PUBLIC
    const text = new TextDecoder().decode(dot.payload);
    console.log(`${from}: ${text}`);
  }
});
```

**What happens:** The relay forwards every DOT to all connected clients. Receivers filter by type.

---

## Encrypted DMs

Point-to-point encrypted message. Only the recipient can read it.

```js
import { DOT } from 'dot-protocol';
import { fromBytes } from '@dotprotocol/core';

// Alice boots and knows Bob's public key
await DOT.boot();

const bobPublicKey = new Uint8Array(32); // Bob's Ed25519 public key

// Send private message to Bob
// WHO = recipient public key → relay routes only to Bob
const dm = await DOT.create({
  WHAT: 'secret message',       // encrypted with shared secret
  WHO:  bobPublicKey,           // recipient
});
// type automatically set to PRIVATE (0x02)

// --- Bob's side ---
await DOT.boot();

DOT.on('dot', (bytes, from) => {
  const dot = fromBytes(bytes);
  if (dot.type === 0x02) { // PRIVATE
    const plaintext = DOT.decryptDot(dot); // ECDH decrypt
    console.log('DM:', new TextDecoder().decode(plaintext));
  }
});
```

**Key point:** The relay cannot read the payload. It only sees the recipient public key to route.

---

## Circle (Group Chat)

Visible only to circle members (0x01). The relay filters by shared circle key.

```js
import { DOT, DotType } from 'dot-protocol';
import { createDOT } from '@dotprotocol/core';

// Circle membership is managed out-of-band (exchanged keys)
// All members share a circle identifier in the type byte

await DOT.boot();

// Post to circle
const post = await DOT.create({
  WHAT: 'circle-only message',
  type: DotType.CIRCLE,          // 0x01
});

// Receive circle messages
DOT.on('dot', (bytes, from) => {
  const dot = DOT.parse(bytes);
  if (dot.type === 0x01) {
    // Only members who subscribed to this circle see it
    console.log('Circle:', new TextDecoder().decode(dot.payload));
  }
});
```

---

## Bot / Agent Identity

A bot has a persistent keypair. Every DOT it emits is signed and chained.

```js
import { createKeypair, createDOT, toBytes } from '@dotprotocol/core';
import { loadKeypair, saveKeypair } from '@dotprotocol/identity';

// --- Bootstrap bot identity (once) ---
const keypair = await createKeypair();
await saveKeypair(keypair, './bot-identity.json');

// --- Bot main loop ---
const kp = await loadKeypair('./bot-identity.json');

let prev = null; // track last DOT for chaining

async function botEmit(message) {
  const dot = await createDOT({
    keypair: kp,
    payload:  message,
    previous: prev,             // chain link
  });
  prev = dot;

  const bytes = toBytes(dot);
  await relay.send(bytes);      // send 153 bytes
  return dot;
}

// Bot's entire history is its worldline — verifiable by anyone
await botEmit('bot online');
await botEmit('processed 42 requests');
await botEmit('bot offline');
```

**Identity proof:** `dot.pubkey` is always the same 32-byte key. The chain hash proves order.

---

## Audio / Video Stream

153 bytes can point at a media chunk stored anywhere. The DOT is the proof of who created it.

```js
import { createDOT, toBytes } from '@dotprotocol/core';
import { createHash } from 'crypto'; // or Web Crypto

// --- Streaming sender ---
async function* streamAudio(keypair, audioChunks) {
  let prev = null;

  for (const chunk of audioChunks) {
    // Store chunk externally (IPFS, S3, CDN)
    const chunkHash = await upload(chunk);

    // Payload = first 16 bytes of chunk hash (content pointer)
    const pointer = chunkHash.slice(0, 16);

    const dot = await createDOT({
      keypair,
      payload:  pointer,          // points to the actual chunk
      previous: prev,
    });
    prev = dot;

    yield toBytes(dot);           // emit 153-byte DOT per chunk
  }
}

// --- Receiver ---
async function receiveStream(dotBytes) {
  const dot = fromBytes(dotBytes);

  // Verify signature + chain
  const valid = await verifyDOT(dot);
  if (!valid) throw new Error('tampered stream');

  // Fetch actual chunk using pointer
  const chunk = await fetch(contentAddressedStore, dot.payload);
  return chunk;
}
```

**Why DOT?** The 153-byte stream is tamper-evident. Remove any chunk → chain breaks. Receiver detects instantly.

---

## Media Attestation

Prove that a specific person created a specific piece of content at a specific time.

```js
import { createDOT, toBytes, fromBytes, verifyDOT } from '@dotprotocol/core';
import { sha256 } from '@dotprotocol/core';

// --- Creator attests their photo ---
async function attestMedia(keypair, mediaBuffer) {
  // Hash the full media file
  const fullHash = await sha256(mediaBuffer);

  // Payload = first 16 bytes of content hash
  const pointer = fullHash.slice(0, 16);

  const dot = await createDOT({
    keypair,
    payload:  pointer,
    previous: prevDot,            // chains to creator's worldline
  });

  return {
    dot:    toBytes(dot),         // 153-byte proof
    hash:   fullHash,             // 32-byte full hash
    media:  mediaBuffer,          // original
  };
}

// --- Verifier checks provenance ---
async function verifyProvenance(dotBytes, mediaBuffer, claimedCreator) {
  const dot = fromBytes(dotBytes);

  // 1. Signature valid?
  if (!await verifyDOT(dot)) return { valid: false, reason: 'bad signature' };

  // 2. Creator matches?
  if (!dot.pubkey.every((b, i) => b === claimedCreator[i])) {
    return { valid: false, reason: 'wrong creator' };
  }

  // 3. Content hash matches?
  const hash = await sha256(mediaBuffer);
  if (!hash.slice(0, 16).every((b, i) => b === dot.payload[i])) {
    return { valid: false, reason: 'content mismatch' };
  }

  return {
    valid:     true,
    creator:   dot.pubkey,        // Ed25519 public key
    timestamp: dot.timestamp,     // Unix ms
  };
}
```

---

## Reputation from Worldline

DOT reputation is chain-native — no platform assigns it.

```js
import { buildScores, computeTier, applyEloUpdates } from '@dotprotocol/chain';

// Collect all DOTs from a pubkey's worldline
const worldline = await relay.fetchChain(pubkey);

// Build Four-Score from chain stats
const scores = buildScores({
  chainLength:       worldline.length,           // depth score
  branchedChainCount: worldline.branchedChains,  // width score
  eloHistory:        worldline.eloHistory,       // domain Elo
  compressedSizeBytes: worldline.compressedSize, // W score
  rawSizeBytes:      worldline.rawSize,
});

// Tier: observer < contributor < architect < luminary
const tier = computeTier(scores);

console.log({
  tier,
  depth:   scores.depth,          // chain length (0-1 normalized)
  width:   scores.width,          // how many others carry your DOTs
  elo:     scores.elo,            // per-domain Elo rating
  W:       scores.W,              // compression = signal density
});

// Update Elo after a prediction resolves
const { newRating, delta } = updateElo({
  rating:    scores.elo,
  opponentRating: opponentElo,
  outcome:   'win',               // 'win' | 'draw' | 'loss'
  K:         32,
});
```

**Tier thresholds (defaults):**

| Tier | Depth | Width | Elo |
|------|-------|-------|-----|
| `observer` | any | any | any |
| `contributor` | ≥ 0.1 | ≥ 0.1 | ≥ 1500 |
| `architect` | ≥ 0.3 | ≥ 0.3 | ≥ 1700 |
| `luminary` | ≥ 0.7 | ≥ 0.5 | ≥ 2000 |

---

## Time-Capsule Message

A DOT that reveals its payload only after a timestamp.

```js
import {
  TransformRegistry,
  serializeTransformCondition,
  deserializeTransformCondition,
  createDOT,
} from '@dotprotocol/core';

// --- Create a time-capsule ---
const unlockAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

const condition = {
  type:      'time-capsule',
  timestamp: unlockAt,
};

const conditionBytes = serializeTransformCondition(condition);

// Store condition in payload pointer (first 16 bytes)
const dot = await createDOT({
  keypair,
  payload: conditionBytes.slice(0, 16),
});

// --- Later: verify the transform ---
import { TransformRegistry } from '@dotprotocol/core';

const spec = TransformRegistry.get('time-capsule');

// inputDOT = sealed capsule, outputDOT = revealed message
const valid = spec.verify(inputDOT, outputDOT);
// Returns true only if outputDOT timestamp >= inputDOT condition timestamp
```

**Built-in transforms:**

| Transform | Condition | When it opens |
|-----------|-----------|--------------|
| `time-capsule` | `{ timestamp: ms }` | Now ≥ timestamp |
| `signer-approval` | `{ requiredKey: Uint8Array }` | Named key signs approval DOT |
| `chain-depth-gate` | `{ minDepth: number }` | Chain reaches depth N |

---

## Physical DOT (QR Code)

Pack up to 19 DOTs into a single QR code. Scannable offline.

```js
import {
  encodeBinary,
  decodeBinary,
  selectQRSpec,
  verifyPhysicalDOTs,
} from '@dotprotocol/qr';

// --- Encode DOTs into QR binary ---
const dots = [dot1, dot2, dot3];   // array of 153-byte Uint8Arrays

const spec    = selectQRSpec(dots.length, 'binary');
const qrBytes = encodeBinary(dots, spec);

// Feed qrBytes to any QR library (qrcode, qr-image, etc.)
import QRCode from 'qrcode';
await QRCode.toFile('dots.png', Buffer.from(qrBytes), { errorCorrectionLevel: 'M' });

// --- Decode scanned QR ---
const scannedBytes = await scanQR(); // raw bytes from scanner
const decoded = decodeBinary(scannedBytes);

if (decoded.valid) {
  const dots = decoded.dots;          // Uint8Array[]
  const ok   = await verifyPhysicalDOTs(dots);
  console.log(`${ok.valid} of ${dots.length} DOTs verified`);
}

// --- Capacity reference ---
// QR_CAPACITY.maxBytesPerCode  = 2953 bytes
// QR_CAPACITY.dotsPerCode      = 19 DOTs
// QR_CAPACITY.bytesPerDOT      = 153
```

**Steganographic mode:** Hide DOTs inside PNG pixel data.

```js
import { encodeSteganographic, decodeSteganographic } from '@dotprotocol/qr';

const hostImage  = await loadPNG('photo.png');
const withDOTs   = encodeSteganographic(dots, hostImage);  // imperceptible

const recovered  = decodeSteganographic(withDOTs);
```

---

## Prediction Market (Arena)

Blind evaluation: oracle seals predictions before seeing them, then resolves.

```js
import {
  resolveSession,
  verifyPrediction,
  hashPredictionDOT,
  rankLeaderboard,
} from '@dotprotocol/arena';

// --- Predictor submits ---
const predictionDOT = await createDOT({
  keypair:  predictorKeypair,
  payload:  encodeAnswer('yes'),  // sealed answer
});

// Hash is public before resolution (commitment scheme)
const commitment = hashPredictionDOT(predictionDOT);

// --- Oracle resolves ---
const resolutionDOT = await createDOT({
  keypair:  oracleKeypair,
  payload:  encodeAnswer('yes'),  // true outcome
});

// --- Resolve session ---
const session = {
  predictions:  [predictionDOT, ...],
  commitments:  [commitment, ...],
  domain:       'crypto',
};

const { matches, ratings } = await resolveSession(session, resolutionDOT);

// matches: [{ predictor, correct, eloDelta }]
// ratings: updated Elo ratings per predictor

// --- Leaderboard ---
const board = rankLeaderboard('prediction', entries);
// entries sorted by Elo descending
```

**Blind evaluation guarantee:** Oracle cannot change outcomes after commitments are sealed.

---

## Feed / Timeline

Ordered stream of events from multiple worldlines.

```js
import { DOT } from 'dot-protocol';
import { fromBytes, checkChain } from '@dotprotocol/core';

// --- Subscribe to multiple worldlines ---
const following = [aliceKey, bobKey, charlieKey]; // pubkeys

await DOT.boot();

const buffer = new Map(); // pubkey → DOT[]

DOT.on('dot', (bytes, from) => {
  if (!following.some(k => k.every((b, i) => b === from[i]))) return;

  const dot = fromBytes(bytes);
  const key = Buffer.from(from).toString('hex');

  if (!buffer.has(key)) buffer.set(key, []);
  buffer.get(key).push(dot);
});

// --- Render timeline ---
async function buildTimeline() {
  const allDots = [];

  for (const [key, dots] of buffer) {
    // Verify each worldline's integrity
    const { valid } = await checkChain(dots);
    if (!valid) console.warn(`Worldline ${key} has gaps`);

    allDots.push(...dots);
  }

  // Sort by timestamp descending
  return allDots.sort((a, b) => Number(b.timestamp - a.timestamp));
}
```

---

## Presence (PING heartbeat)

The empty DOT. Just being there is the message.

```js
import { DOT } from 'dot-protocol';

await DOT.boot();

// PING every 30 seconds
setInterval(async () => {
  await DOT.create({}); // empty payload = PING
  // 153 bytes, all-zero payload, signed + chained
}, 30_000);

// Receivers see your presence without any content
DOT.on('dot', (bytes, from) => {
  const dot = DOT.parse(bytes);
  if (dot.payload.every(b => b === 0)) {
    // This is a PING — presence signal
    updatePresence(from, dot.timestamp);
  }
});
```

**Use cases:** Online indicator, heartbeat, liveness proof, "I was here" chain entry.

---

## Working with Bytes

All patterns ultimately work with raw bytes. Quick reference:

```js
import {
  createKeypair,
  createDOT,
  verifyDOT,
  checkChain,
  toBytes,
  fromBytes,
  DotType,
  DOTFace,
  composeFaces,
  hasFace,
} from '@dotprotocol/core';

// Keypair
const keypair = await createKeypair();
// { pubkey: Uint8Array(32), privkey: Uint8Array(64) }

// Create
const dot = await createDOT({ keypair, payload: 'hello', previous: null });

// Serialize / Deserialize
const bytes  = toBytes(dot);      // Uint8Array(153)
const parsed = fromBytes(bytes);  // reconstructed DOT object

// Verify
const valid  = await verifyDOT(dot);       // boolean
const chain  = await checkChain([d1, d2]); // { valid, brokenAt? }

// Faces
const mask = composeFaces(DOTFace.QR, DOTFace.Container);
hasFace(mask, DOTFace.QR); // true

// Type byte
const priv = await createDOT({ keypair, type: DotType.PRIVATE });
```

---

## Wire Format Quick Reference

```
Bytes    Field          Type         Notes
0–31     pubkey         Ed25519      WHO — identity
32–95    signature      Ed25519      PROOF — over bytes 96–152
96–127   chain          SHA-256      SEQUENCE — hash of previous DOT bytes
128–135  timestamp      uint64 BE    WHEN — Unix milliseconds
136      type           uint8        VISIBILITY — 0x00–0x03
137–152  payload        16 bytes     WHAT — pointer or content
```

153 bytes. Always.
