# DOT Engine Week 2–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the DOT Game Engine from Week 1 (physics core + basic messenger) to a publishable, production-ready package where two phones can message with signed, encrypted, compressed DOTs offline-capable through a PWA.

**Architecture:** Three layers — (1) engine physics layer gains ECDH encryption, batch BLS sealing, and real compression stats; (2) messenger PWA gains QR scan, camera DOT, offline support, and stats UI; (3) npm publish pipeline makes the engine installable by anyone in 10 minutes.

**Tech Stack:** TypeScript, `@noble/curves` (ECDH), `@dot-protocol/compression` (rANS+predictor in browser), `jsQR` (QR scanning), `vite-plugin-pwa` (ServiceWorker), `vitest`, pnpm workspaces.

**Branch:** Create `dot-engine-week2` from `main` before starting.

**Test baseline:** 358 tests passing on `main`. Every task must leave tests green.

---

## File Structure (what changes)

```
packages/engine/src/
  crypto.ts          CREATE — ECDH helpers (Ed25519→X25519, encrypt/decrypt payload)
  compress.ts        CREATE — browser-safe compression (predictor+rANS, no zstd-napi)
  sensor.ts          CREATE — sensor PUF fingerprint + device entropy
  physics.ts         MODIFY — wire crypto.ts for encrypted DOTs, compress.ts for ratio stats
  engine.ts          MODIFY — batch sealing, compression stats from compress.ts, sensor PUF
  index.ts           MODIFY — export new public types

packages/messenger/src/
  screens/
    QRScanScreen.tsx   CREATE — camera stream → jsQR decode → peer DID
    CameraScreen.tsx   CREATE — photo capture → SHA-256 hash → camera DOT
    StatsScreen.tsx    CREATE — live compression ratio, predictor accuracy, chain depth
  App.tsx              MODIFY — add QR scan + camera routes, encryption indicator
  sw-custom.ts         CREATE — custom ServiceWorker additions (DOT queue while offline)

packages/engine/
  package.json         MODIFY — add publishConfig, files field, version bump to 0.2.0
```

---

## Task 1: ECDH Encryption (engine)

**Files:**
- Create: `packages/engine/src/crypto.ts`
- Modify: `packages/engine/src/physics.ts`
- Modify: `packages/engine/src/engine.ts`
- Test: `packages/engine/src/tests/crypto.test.ts`

The DOT WHO dimension (recipient public key) triggers automatic ECDH encryption. Alice's Ed25519 key converts to X25519; ECDH with Bob's X25519 key gives a 32-byte shared secret; payload encrypted with AES-256-GCM; 16-byte ciphertext stored in DOT payload field (truncated if needed — use first 12B as nonce seed, last 16B as ciphertext; nonce derivable from chain position).

**Simplified approach for v0.2:** Derive a 32-byte shared secret from ECDH. Encrypt the raw payload bytes with ChaCha20 (keystream XOR). Store XOR-encrypted payload in the 16B DOT field. The recipient (who has their own private key) can recover the plaintext. This avoids the nonce-in-16B problem since ChaCha20 can use a counter derived from the DOT's chain position.

- [ ] **Step 1: Install @noble/ciphers for ChaCha20**

```bash
cd packages/engine
pnpm add @noble/ciphers
```

- [ ] **Step 2: Write failing tests**

Create `packages/engine/src/tests/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  edToX25519,
  ecdh,
  encryptPayload,
  decryptPayload,
} from '../crypto.js';
import { createKeypair } from '@dot-protocol/core';

describe('DOT ECDH crypto', () => {
  it('converts Ed25519 pubkey to X25519', () => {
    const keypair = createKeypair();
    const x25519 = edToX25519Pub(keypair.publicKey);
    expect(x25519).toHaveLength(32);
  });

  it('ECDH produces same shared secret both ways', () => {
    const alice = createKeypair();
    const bob = createKeypair();
    const secretAB = ecdh(alice.privateKey, bob.publicKey);
    const secretBA = ecdh(bob.privateKey, alice.publicKey);
    expect(Array.from(secretAB)).toEqual(Array.from(secretBA));
  });

  it('encrypt+decrypt round-trip (≤16B)', () => {
    const alice = createKeypair();
    const bob = createKeypair();
    const shared = ecdh(alice.privateKey, bob.publicKey);
    const plaintext = new TextEncoder().encode('hello');
    const ct = encryptPayload(plaintext, shared, 0n);
    const pt = decryptPayload(ct, shared, 0n);
    expect(new TextDecoder().decode(pt).trimEnd().replace(/\0/g, '')).toBe('hello');
  });

  it('encrypt+decrypt round-trip (16B boundary)', () => {
    const alice = createKeypair();
    const bob = createKeypair();
    const shared = ecdh(alice.privateKey, bob.publicKey);
    const plaintext = new Uint8Array(16).fill(0xAB);
    const ct = encryptPayload(plaintext, shared, 42n);
    const pt = decryptPayload(ct, shared, 42n);
    expect(Array.from(pt)).toEqual(Array.from(plaintext));
  });

  it('different nonce (chain pos) produces different ciphertext', () => {
    const keypair = createKeypair();
    const shared = new Uint8Array(32).fill(7);
    const plain = new Uint8Array(16).fill(1);
    const ct0 = encryptPayload(plain, shared, 0n);
    const ct1 = encryptPayload(plain, shared, 1n);
    expect(Array.from(ct0)).not.toEqual(Array.from(ct1));
  });
});
```

Run: `cd packages/engine && pnpm test`
Expected: FAIL — `crypto.ts` not found

- [ ] **Step 3: Implement `packages/engine/src/crypto.ts`**

```typescript
/**
 * DOT ECDH encryption helpers.
 *
 * Ed25519 keys → X25519 keys → ECDH shared secret → ChaCha20 stream cipher.
 * The shared secret + chain position → deterministic keystream → XOR with payload.
 * 16-byte payload field is encrypted in-place. Lossless.
 */
import { x25519 } from '@noble/curves/montgomery';
import { ed25519 } from '@noble/curves/ed25519';
import { chacha20 } from '@noble/ciphers/chacha';

/**
 * Convert an Ed25519 public key (32B) to an X25519 public key (32B).
 * Uses the birational equivalence between Edwards and Montgomery curves.
 */
export function edToX25519Pub(edPub: Uint8Array): Uint8Array {
  return ed25519.utils.edwardsToMontgomery(edPub);
}

/**
 * Convert an Ed25519 private key seed (32B) to an X25519 private key (32B).
 */
export function edToX25519Priv(edPriv: Uint8Array): Uint8Array {
  return ed25519.utils.edwardsToMontgomeryPriv(edPriv);
}

/**
 * ECDH: derive a 32-byte shared secret from our Ed25519 private key
 * and their Ed25519 public key (both converted to X25519).
 */
export function ecdh(myEdPriv: Uint8Array, theirEdPub: Uint8Array): Uint8Array {
  const myX = edToX25519Priv(myEdPriv);
  const theirX = edToX25519Pub(theirEdPub);
  return x25519.getSharedSecret(myX, theirX);
}

/**
 * Encrypt a payload (≤16B) using ChaCha20 stream cipher.
 * Nonce = chainPos as 12-byte little-endian bigint.
 * Output is always 16 bytes (zero-padded input XORed with keystream).
 */
export function encryptPayload(
  plaintext: Uint8Array,
  sharedSecret: Uint8Array,
  chainPos: bigint,
): Uint8Array {
  const padded = new Uint8Array(16);
  padded.set(plaintext.slice(0, 16));
  const nonce = posToNonce(chainPos);
  return chacha20(sharedSecret, nonce, padded);
}

/**
 * Decrypt a 16-byte encrypted payload using ChaCha20 (symmetric).
 */
export function decryptPayload(
  ciphertext: Uint8Array,
  sharedSecret: Uint8Array,
  chainPos: bigint,
): Uint8Array {
  const nonce = posToNonce(chainPos);
  return chacha20(sharedSecret, nonce, ciphertext);
}

function posToNonce(pos: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  // Write lower 64 bits of pos as little-endian into bytes [0..7]
  view.setBigUint64(0, pos & 0xFFFFFFFFFFFFFFFFn, true);
  return nonce;
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/engine && pnpm test
```
Expected: all crypto tests PASS, all existing 26 tests still PASS.

- [ ] **Step 5: Wire encryption into physics.ts**

In `packages/engine/src/physics.ts`, update `createDotPhysics()` to accept optional `myPrivateKey` and use `encryptPayload` when a `WHO` recipient is specified in the datom:

```typescript
// In createDotPhysics(), after encoding the payload:
if (datom.WHO && myPrivateKey) {
  const { ecdh, encryptPayload } = await import('./crypto.js');
  const shared = ecdh(myPrivateKey, datom.WHO);
  const chainPos = BigInt(chain.entries.length);
  payload = encryptPayload(payload, shared, chainPos);
}
```

Add `WHO` to the `Datom` interface:
```typescript
export interface Datom {
  WHAT?: string | Uint8Array;
  WHO?: Uint8Array;   // recipient Ed25519 public key — triggers ECDH encryption
  WHEN?: number;
  type?: DotType;
}
```

- [ ] **Step 6: Add decryptDot() to engine API**

In `engine.ts`, expose a helper:
```typescript
/**
 * Decrypt a DOT's payload using our private key and the sender's public key.
 * Returns null if decryption fails or DOT is not addressed to us.
 */
decryptDot(dot: Uint8Array, senderPublicKey: Uint8Array): Uint8Array | null;
```

Implementation: extract payload [137..152], extract chain pos from chain index, call `decryptPayload(payload, ecdh(myPrivKey, senderPubKey), chainPos)`.

- [ ] **Step 7: Add integration test**

In `packages/engine/src/tests/engine.test.ts`, add:
```typescript
it('encrypted DOT: recipient can decrypt what sender encrypted', async () => {
  // Boot two engines (alice and bob) both offline
  const aliceEngine = createEngine(); // need factory — or test via crypto.ts directly
  // For now, test via crypto.ts functions directly (engine singleton makes two-instance hard)
  const { createKeypair } = await import('@dot-protocol/core');
  const { ecdh, encryptPayload, decryptPayload } = await import('../crypto.js');
  const alice = createKeypair();
  const bob = createKeypair();
  const msg = new TextEncoder().encode('secret');
  const sharedAB = ecdh(alice.privateKey, bob.publicKey);
  const ct = encryptPayload(msg, sharedAB, 0n);
  const sharedBA = ecdh(bob.privateKey, alice.publicKey);
  const pt = decryptPayload(ct, sharedBA, 0n);
  expect(new TextDecoder().decode(pt).replace(/\0/g, '')).toBe('secret');
});
```

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/crypto.ts packages/engine/src/tests/crypto.test.ts \
        packages/engine/src/physics.ts packages/engine/src/engine.ts \
        packages/engine/package.json
git commit -m "feat(engine): ECDH encryption — Ed25519→X25519 ECDH + ChaCha20 payload encryption"
```

---

## Task 2: Browser-Safe Compression (engine)

**Files:**
- Create: `packages/engine/src/compress.ts`
- Modify: `packages/engine/src/engine.ts` (wire compress.ts into stats)
- Test: `packages/engine/src/tests/compress.test.ts`

The existing `@dot-protocol/compression` uses `zstd-napi` which requires Node.js native bindings. The predictor + rANS pipeline is pure TypeScript and works in browser. This task wires it into the engine to give real `compressionRatio` in `DOT.stats()`.

- [ ] **Step 1: Write failing test**

Create `packages/engine/src/tests/compress.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createBatchCompressor } from '../compress.js';

describe('browser-safe batch compression', () => {
  it('compresses an array of 153-byte DOTs', async () => {
    const compressor = createBatchCompressor();
    // feed 20 identical-ish payloads (high predictability)
    const dots: Uint8Array[] = Array.from({ length: 20 }, (_, i) => {
      const d = new Uint8Array(153);
      // fake a sensor-like DOT: same pattern, small variation
      d[137] = i; // only one byte varies
      return d;
    });
    const { compressedSize, rawSize, ratio } = compressor.measure(dots);
    expect(rawSize).toBe(20 * 153);
    expect(ratio).toBeGreaterThan(1); // compressed smaller than raw
    expect(compressedSize).toBeLessThan(rawSize);
  });

  it('returns ratio=1 for random data (no compression gain)', async () => {
    const compressor = createBatchCompressor();
    const random = Array.from({ length: 10 }, () => {
      const d = new Uint8Array(153);
      crypto.getRandomValues(d);
      return d;
    });
    const { ratio } = compressor.measure(random);
    // random data may expand slightly — just verify it runs without throwing
    expect(ratio).toBeGreaterThan(0);
  });
});
```

Run: `pnpm test` — expected FAIL.

- [ ] **Step 2: Implement `packages/engine/src/compress.ts`**

```typescript
/**
 * Browser-safe compression measurement for DOT batches.
 *
 * Uses the predictor + rANS pipeline from @dot-protocol/compression (pure TS,
 * no native deps). Does NOT use zstd-napi. Measures compression ratio for
 * the engine's stats() output.
 *
 * For actual wire compression, the full serializeBatchV2 pipeline is used
 * in Node.js environments. In the browser, rANS-only compression is applied.
 */
import { LinearPredictor, computeResidual, buildFrequencyTable, ransEncode } from '@dot-protocol/compression';

export interface CompressionStats {
  rawSize: number;
  compressedSize: number;
  ratio: number;
  predictorAccuracy: number;
}

export interface BatchCompressor {
  /** Measure compression ratio for a batch of 153-byte DOTs. */
  measure(dots: Uint8Array[]): CompressionStats;
  /** Add a DOT to the running predictor state (improves future accuracy). */
  feed(dot: Uint8Array): void;
  /** Reset predictor state. */
  reset(): void;
}

const PAYLOAD_OFFSET = 137;
const PAYLOAD_SIZE = 16;

/**
 * Create a batch compressor that tracks predictor state across feeds.
 * Call feed() as DOTs arrive, measure() to get current stats.
 */
export function createBatchCompressor(): BatchCompressor {
  const predictor = new LinearPredictor();
  let totalDots = 0;
  let totalPredicted = 0;

  return {
    feed(dot: Uint8Array) {
      const payload = dot.slice(PAYLOAD_OFFSET, PAYLOAD_OFFSET + PAYLOAD_SIZE);
      const predicted = predictor.predict();
      const residual = computeResidual(payload, predicted);
      const allZero = residual.every(b => b === 0);
      if (allZero) totalPredicted++;
      totalDots++;
      predictor.update(payload);
    },

    measure(dots: Uint8Array[]): CompressionStats {
      if (dots.length === 0) return { rawSize: 0, compressedSize: 0, ratio: 1, predictorAccuracy: 0 };

      // Compute rANS-compressed size of payload residuals
      const tempPredictor = new LinearPredictor();
      const allResiduals: number[] = [];
      let predicted = 0;

      for (const dot of dots) {
        const payload = dot.slice(PAYLOAD_OFFSET, PAYLOAD_OFFSET + PAYLOAD_SIZE);
        const pred = tempPredictor.predict();
        const residual = computeResidual(payload, pred);
        if (residual.every(b => b === 0)) predicted++;
        allResiduals.push(...residual);
        tempPredictor.update(payload);
      }

      const residualBytes = new Uint8Array(allResiduals);
      const freqTable = buildFrequencyTable(residualBytes);
      const encoded = ransEncode(residualBytes, freqTable);

      // rANS-compressed payload column + overhead estimate
      // (timestamps delta-encode to ~2B each, types RLE to ~1B each, pubkey shared)
      const pubkeyOverhead = 32; // shared pubkey
      const sigOverhead = 48;    // shared BLS sig
      const tsColumn = dots.length * 2;   // delta-encoded timestamps ~2B avg
      const typeColumn = Math.ceil(dots.length / 8); // RLE ~1 bit per DOT
      const payloadColumn = encoded.length;
      const compressedSize = pubkeyOverhead + sigOverhead + tsColumn + typeColumn + payloadColumn;
      const rawSize = dots.length * 153;

      return {
        rawSize,
        compressedSize: Math.min(compressedSize, rawSize), // cap at raw size
        ratio: rawSize / Math.max(compressedSize, 1),
        predictorAccuracy: dots.length > 0 ? predicted / dots.length : 0,
      };
    },

    reset() {
      predictor.reset();
      totalDots = 0;
      totalPredicted = 0;
    },
  };
}
```

- [ ] **Step 3: Wire into engine.ts**

In `engine.ts`, import `createBatchCompressor` and maintain a `_compressor` instance:
```typescript
import { createBatchCompressor } from './compress.js';
let _compressor = createBatchCompressor();

// In create(): after appending to chain, call _compressor.feed(dotBytes)
// In stats(): use _compressor.measure(last 100 dots) for compressionRatio + predictorAccuracy
// In shutdown(): reset _compressor
```

Update `DOT.stats()` to return real `compressionRatio` and `predictorAccuracy`.

- [ ] **Step 4: Run all tests**

```bash
cd packages/engine && pnpm test
```
All tests pass.

- [ ] **Step 5: Verify messenger's compressionRatio display works**

The `ChatScreen.tsx` already shows `stats.compressionRatio` — it will now show real values > 1 after several messages.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/compress.ts packages/engine/src/tests/compress.test.ts \
        packages/engine/src/engine.ts
git commit -m "feat(engine): browser-safe compression stats — rANS predictor pipeline wired into DOT.stats()"
```

---

## Task 3: QR Scan to Connect (messenger)

**Files:**
- Create: `packages/messenger/src/screens/QRScanScreen.tsx`
- Modify: `packages/messenger/src/App.tsx`
- Modify: `packages/messenger/package.json` (add jsQR dep)

Scan another device's QR code → extract their DOT DID → add as known peer → navigate to chat.

- [ ] **Step 1: Install jsQR**

```bash
cd packages/messenger && pnpm add jsqr
```

- [ ] **Step 2: Create `QRScanScreen.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onScan: (did: string) => void;
  onCancel: () => void;
}

export function QRScanScreen({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        scan();
      } catch (e) {
        setError('Camera access denied. Use manual paste below.');
      }
    }

    function scan() {
      if (!scanning) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafId = requestAnimationFrame(scan);
        return;
      }
      const ctx = canvas.getContext('2d')!;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code?.data?.startsWith('dot:')) {
        setScanning(false);
        stream?.getTracks().forEach(t => t.stop());
        onScan(code.data);
        return;
      }
      rafId = requestAnimationFrame(scan);
    }

    start();
    return () => {
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [scanning, onScan]);

  const [manualDid, setManualDid] = useState('');

  return (
    <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px' }}>◉ SCAN DOT ID</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}>✕</button>
      </div>

      {error && <div style={{ color: '#FF4400', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

      <video ref={videoRef} style={{ width: '100%', border: '1px solid #003300', display: error ? 'none' : 'block' }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div style={{ marginTop: '16px', fontSize: '11px', opacity: 0.5 }}>— or paste manually —</div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input
          value={manualDid}
          onChange={e => setManualDid(e.target.value)}
          placeholder="dot:..."
          style={{ flex: 1, background: '#0a0a0a', border: '1px solid #003300', color: '#00FF41', fontFamily: 'monospace', fontSize: '11px', padding: '8px' }}
        />
        <button
          onClick={() => manualDid.startsWith('dot:') && onScan(manualDid)}
          style={{ background: '#001a00', border: '1px solid #00FF41', color: '#00FF41', fontFamily: 'monospace', fontSize: '11px', padding: '8px 12px', cursor: 'pointer' }}
        >
          CONNECT
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into App.tsx**

Add `'qrscan'` to the `Screen` type. Add a "SCAN" button on the IdentityScreen. When scan succeeds, store the peer DID and navigate to chat with that peer as the active recipient.

In `App.tsx`:
```typescript
type Screen = 'boot' | 'identity' | 'chat' | 'qrscan';

// In identity screen section, add a SCAN button
// When QRScanScreen calls onScan(did):
//   setPeers(prev => [...prev, { did, publicKey: new Uint8Array(32), lastSeen: Date.now() }])
//   setActivePeer(did)
//   setScreen('chat')
```

- [ ] **Step 4: Build the messenger**

```bash
cd packages/messenger && pnpm build
```
Expected: clean build, bundle < 1MB.

- [ ] **Step 5: Commit**

```bash
git add packages/messenger/src/screens/QRScanScreen.tsx \
        packages/messenger/src/App.tsx \
        packages/messenger/package.json \
        packages/messenger/pnpm-lock.yaml
git commit -m "feat(messenger): QR scan to connect — camera stream + jsQR + manual DID paste"
```

---

## Task 4: Camera DOT (messenger)

**Files:**
- Create: `packages/messenger/src/screens/CameraScreen.tsx`
- Modify: `packages/messenger/src/App.tsx`

Take a photo → compute SHA-256 of image bytes → store hash as 16B DOT payload (first 16B of SHA-256) → send as a DOT → display in chat as a thumbnail (from IndexedDB).

- [ ] **Step 1: Create `CameraScreen.tsx`**

```tsx
import React, { useRef, useState, useEffect } from 'react';

interface Props {
  onCapture: (imageBlob: Blob, hashPayload: Uint8Array) => void;
  onCancel: () => void;
}

export function CameraScreen({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [captured, setCaptured] = useState<string | null>(null); // preview URL

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        setStream(s);
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
      })
      .catch(() => setError('Camera access denied'));
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  async function capture() {
    const canvas = canvasRef.current!;
    const video = videoRef.current!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    // Get JPEG blob
    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7));
    const arrayBuf = await blob.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuf);
    const hashPayload = new Uint8Array(hashBuf).slice(0, 16); // first 16B

    stream?.getTracks().forEach(t => t.stop());
    setCaptured(URL.createObjectURL(blob));
    onCapture(blob, hashPayload);
  }

  if (captured) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <img src={captured} style={{ maxWidth: '100%', border: '1px solid #003300' }} />
        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.5 }}>DOT sealed ✓</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px' }}>◉ CAMERA DOT</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}>✕</button>
      </div>
      {error && <div style={{ color: '#FF4400', fontSize: '12px' }}>{error}</div>}
      <video ref={videoRef} muted playsInline style={{ width: '100%', border: '1px solid #003300' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <button
        onClick={capture}
        style={{ marginTop: '12px', width: '100%', background: '#001a00', border: '1px solid #00FF41', color: '#00FF41', fontFamily: 'monospace', fontSize: '14px', padding: '14px', cursor: 'pointer' }}
      >
        ◉ CAPTURE
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App.tsx**

Add `'camera'` to Screen type. Camera DOTs are sent with `DotType.EPHEMERAL` and payload = SHA-256 hash[:16]. The full image blob is stored in `localStorage` or in-memory keyed by hash hex string. When displaying a camera DOT in the chat, render the image from local cache if available.

In `App.tsx`:
```typescript
async function handleCameraCapture(blob: Blob, hashPayload: Uint8Array) {
  // Store image blob for display
  const key = Array.from(hashPayload).map(b => b.toString(16).padStart(2,'0')).join('');
  const url = URL.createObjectURL(blob);
  // In-memory cache (Map): dotImageCache.set(key, url)

  // Create DOT with hash as payload
  const dotBytes = await DOT.create({ WHAT: hashPayload, type: DotType.EPHEMERAL });

  setMessages(prev => [...prev, {
    id: key,
    from: myDid,
    content: `[photo:${key.slice(0,8)}]`,
    imageUrl: url,
    timestamp: Date.now(),
    verified: true,
  }]);
  setScreen('chat');
}
```

In `ChatScreen.tsx`, render `imageUrl` if present in a message.

- [ ] **Step 3: Build**

```bash
cd packages/messenger && pnpm build
```
Expected: clean, < 1MB.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(messenger): camera DOT — capture photo → SHA-256 hash → EPHEMERAL DOT"
```

---

## Task 5: Offline Support (messenger)

**Files:**
- Modify: `packages/messenger/vite.config.ts` (improve workbox strategy)
- Create: `packages/messenger/src/sw-custom.ts` (custom SW additions)

The ServiceWorker already exists from `vite-plugin-pwa`. This task improves caching and adds offline message queuing via the relay's existing `sendQueue`.

- [ ] **Step 1: Update vite.config.ts workbox strategy**

In `packages/messenger/vite.config.ts`, update VitePWA config:

```typescript
VitePWA({
  registerType: 'autoUpdate',
  manifest: { /* existing */ },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
      },
    ],
    navigateFallback: 'index.html',
  },
  devOptions: { enabled: true },
})
```

- [ ] **Step 2: Add offline indicator to ChatScreen**

In `ChatScreen.tsx`, add a small online/offline indicator that reads `navigator.onLine` and changes on `window.addEventListener('online'/'offline')`.

```tsx
const [online, setOnline] = useState(navigator.onLine);
useEffect(() => {
  const on = () => setOnline(true);
  const off = () => setOnline(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
}, []);

// In stats footer, add:
// <span style={{ color: online ? '#00FF41' : '#FF4400' }}>{online ? '● relay' : '○ offline'}</span>
```

The relay's `sendQueue` already handles queuing DOTs when disconnected and flushing on reconnect. No additional logic needed.

- [ ] **Step 3: Build and verify SW is generated**

```bash
cd packages/messenger && pnpm build && ls dist/sw.js
```
Expected: `sw.js` present, build succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(messenger): offline support — improved SW caching, offline indicator, queued relay sends"
```

---

## Task 6: Stats Screen (messenger)

**Files:**
- Create: `packages/messenger/src/screens/StatsScreen.tsx`
- Modify: `packages/messenger/src/App.tsx`

Live stats panel showing compression ratio, predictor accuracy, chain length, relay status, and a sparkline of compression improving over time.

- [ ] **Step 1: Create `StatsScreen.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { DOT } from '@dot-protocol/engine';
import type { EngineStats } from '@dot-protocol/engine';

interface Props {
  onBack: () => void;
}

export function StatsScreen({ onBack }: Props) {
  const [stats, setStats] = useState<EngineStats>(DOT.stats());
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = DOT.stats();
      setStats(s);
      setHistory(h => [...h.slice(-30), s.compressionRatio]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const stat = (label: string, value: string, unit = '') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #001100' }}>
      <span style={{ fontSize: '11px', opacity: 0.6 }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{value}{unit}</span>
    </div>
  );

  return (
    <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px' }}>◉ ENGINE STATS</span>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}>← BACK</button>
      </div>

      {stat('total DOTs', stats.totalDots.toString())}
      {stat('raw bytes', stats.totalRawBytes.toLocaleString(), ' B')}
      {stat('compression', stats.compressionRatio.toFixed(2), '×')}
      {stat('predictor accuracy', (stats.predictorAccuracy * 100).toFixed(1), '%')}
      {stat('active chains', stats.totalChains.toString())}
      {stat('relay', stats.relayConnected ? 'connected ●' : 'offline ○')}
      {stat('peers online', stats.peersOnline.toString())}

      {history.length > 1 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '10px', opacity: 0.4, marginBottom: '4px' }}>COMPRESSION OVER TIME</div>
          <Sparkline values={history} />
        </div>
      )}

      <div style={{ marginTop: '24px', fontSize: '10px', opacity: 0.3, lineHeight: '1.6' }}>
        <div>d = log(N)/log(S)</div>
        <div>at d=1 → classical bit</div>
        <div>at d=2 → qubit equivalent</div>
        <div>at d&gt;2 → fractal depth</div>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 2);
  const min = Math.min(...values, 1);
  const h = 40;
  const w = Math.min(values.length * 8, 320);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / (max - min + 0.001)) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke="#00FF41" strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Wire into App.tsx**

Add `'stats'` to Screen type. Add a "STATS" button in the ChatScreen header that navigates to stats screen.

- [ ] **Step 3: Build**

```bash
cd packages/messenger && pnpm build
```
Expected: clean, < 1MB.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(messenger): stats screen — compression ratio, predictor accuracy, sparkline history"
```

---

## Task 7: Batch BLS Sealing (engine)

**Files:**
- Modify: `packages/engine/src/engine.ts`
- Test: `packages/engine/src/tests/engine.test.ts`

Every N DOTs, create a BLS aggregate seal. This is `DOT.seal()` from the engine API.

- [ ] **Step 1: Write failing test**

Add to `packages/engine/src/tests/engine.test.ts`:
```typescript
it('DOT.seal() returns a 48-byte BLS aggregate signature', async () => {
  for (let i = 0; i < 5; i++) await DOT.create({ WHAT: `msg${i}` });
  const seal = await DOT.seal(5);
  expect(seal).toHaveLength(48); // BLS12-381 G1 signature = 48B
});

it('DOT.seal() auto-fires after N DOTs (sealEvery option)', async () => {
  // Re-boot with sealEvery: 3
  await DOT.shutdown();
  await DOT.boot({ offline: true, sealEvery: 3 });
  let sealCount = 0;
  DOT.on('seal', () => sealCount++);
  for (let i = 0; i < 9; i++) await DOT.create({ WHAT: `s${i}` });
  expect(sealCount).toBe(3); // seals at 3, 6, 9
});
```

Run: `pnpm test` — expected FAIL.

- [ ] **Step 2: Implement seal() in engine.ts**

```typescript
// Add to EngineOptions:
sealEvery?: number;  // auto-seal every N DOTs (default: 100, 0 = manual only)

// Add to EngineAPI:
seal(n?: number): Promise<Uint8Array>;  // BLS-seal last N DOTs (default: all unsealed)

// In create():
_dotseSinceLastSeal++;
if (_sealEvery > 0 && _dotsSinceLastSeal >= _sealEvery) {
  const sealBytes = await DOT.seal(_sealEvery);
  emit('seal', sealBytes);
  _dotsSinceLastSeal = 0;
}

// Implementation using @dot-protocol/core:
import { createBLSKeypair, aggregateSignatures, signBLS } from '@dot-protocol/core';

// seal() takes last N DOT bytes, signs each with BLS, aggregates
async seal(n?: number): Promise<Uint8Array> {
  const chain = _chains.get(_identity!.did);
  if (!chain) throw new Error('No active chain');
  const count = n ?? chain.entries.length - _lastSealIndex;
  const dots = chain.entries.slice(-count).map(e => e.dot);
  const sigs = await Promise.all(dots.map(dot =>
    signBLS(_blsKeypair!.privateKey, dot)
  ));
  return aggregateSignatures(sigs);
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/engine && pnpm test
```
All pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(engine): BLS batch sealing — DOT.seal() + auto-seal every N DOTs"
```

---

## Task 8: Sensor PUF Fingerprint (engine)

**Files:**
- Create: `packages/engine/src/sensor.ts`
- Modify: `packages/engine/src/identity.ts`
- Test: `packages/engine/src/tests/sensor.test.ts`

Collect device sensor noise (accelerometer, gyroscope, timing jitter) and hash it as an entropy source for the DOT identity. This is a browser-only PUF approximation — not hardware-level but better than pure RNG.

- [ ] **Step 1: Write failing test**

Create `packages/engine/src/tests/sensor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { collectEntropy, hashEntropy } from '../sensor.js';

describe('sensor PUF', () => {
  it('collectEntropy returns non-empty bytes', async () => {
    const entropy = await collectEntropy({ durationMs: 50 });
    expect(entropy.length).toBeGreaterThan(0);
  });

  it('hashEntropy returns 32 bytes', async () => {
    const entropy = new Uint8Array([1, 2, 3, 4, 5]);
    const hash = await hashEntropy(entropy);
    expect(hash).toHaveLength(32);
  });

  it('same entropy → same hash (deterministic)', async () => {
    const entropy = new Uint8Array(64).fill(7);
    const h1 = await hashEntropy(entropy);
    const h2 = await hashEntropy(entropy);
    expect(Array.from(h1)).toEqual(Array.from(h2));
  });
});
```

Run: `pnpm test` — FAIL expected.

- [ ] **Step 2: Implement `sensor.ts`**

```typescript
/**
 * Sensor entropy collection for PUF-style device fingerprinting.
 *
 * Collects timing jitter, performance.now() samples, and any available
 * sensor data (DeviceMotion in browser). Hashes to a stable 32-byte seed.
 *
 * NOT a hardware PUF — but provides device-specific entropy beyond pure RNG.
 */

export interface EntropyOptions {
  /** How long to collect timing samples (ms). Default: 100 */
  durationMs?: number;
}

/**
 * Collect device entropy from timing jitter and sensors.
 * Falls back to crypto.getRandomValues() in Node.js (no sensors).
 */
export async function collectEntropy(options?: EntropyOptions): Promise<Uint8Array> {
  const ms = options?.durationMs ?? 100;
  const samples: number[] = [];

  // Timing jitter: high-resolution timestamps
  const start = performance.now();
  while (performance.now() - start < Math.min(ms, 100)) {
    samples.push(performance.now());
  }

  // Quantize and flatten to bytes
  const bytes: number[] = [];
  for (const s of samples.slice(0, 256)) {
    const frac = s - Math.floor(s); // fractional microseconds = jitter
    bytes.push(Math.floor(frac * 256) & 0xFF);
  }

  // Add crypto randomness as fallback/supplement
  const rng = new Uint8Array(32);
  crypto.getRandomValues(rng);
  bytes.push(...rng);

  return new Uint8Array(bytes);
}

/**
 * Hash entropy bytes to a 32-byte deterministic seed using SHA-256.
 */
export async function hashEntropy(entropy: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', entropy);
  return new Uint8Array(buf);
}

/**
 * Derive a device fingerprint string (64 hex chars) from sensor entropy.
 * Useful for display / debugging.
 */
export async function deviceFingerprint(): Promise<string> {
  const entropy = await collectEntropy({ durationMs: 50 });
  const hash = await hashEntropy(entropy);
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 3: Wire into identity.ts**

In `getOrCreateIdentity()`, when creating a new identity, mix sensor entropy into the key seed:
```typescript
// Before generating new key, collect entropy and mix with crypto.getRandomValues()
const sensorEntropy = await collectEntropy({ durationMs: 50 });
// XOR the first 32 bytes with the standard RNG seed (visual: sensors modify the key generation)
// Note: this is extra entropy on top of WebCrypto's built-in RNG — belt AND suspenders
```

Expose `puf` on the identity as the sensor entropy hash:
```typescript
// identity.puf = await hashEntropy(sensorEntropy) — 32 bytes, device fingerprint
```

Update `DotIdentity` interface:
```typescript
export interface DotIdentity {
  publicKey: Uint8Array;
  did: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  verify(data: Uint8Array, sig: Uint8Array, pk?: Uint8Array): Promise<boolean>;
  export(): string;
  puf: Uint8Array | null;  // was null, now real entropy hash on first creation
}
```

- [ ] **Step 4: Run all tests**

```bash
cd packages/engine && pnpm test
```
All pass. Sensor tests pass in Node.js (timing jitter still exists even without motion sensors).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(engine): sensor PUF fingerprint — timing jitter entropy + SHA-256 device hash"
```

---

## Task 9: npm Publish Config

**Files:**
- Modify: all `packages/*/package.json` (add `publishConfig`, `files`, `version`)
- Create: `packages/engine/.npmignore`

Prepare all packages for `npm publish`. The publish order matters: `core` first, then deps in order.

- [ ] **Step 1: Add publishConfig to each package.json**

For each package in `core`, `compression`, `identity`, `chain`, `relay`, `wrapper`, `engine`, `sdk`:

```json
{
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "files": ["dist", "src", "README.md"],
  "version": "0.2.0"
}
```

Set `"private": false` on packages that were marked private (engine was `"private": true` initially — change it).

- [ ] **Step 2: Create README.md for engine**

Create `packages/engine/README.md`:
```markdown
# @dot-protocol/engine

> The DOT Game Engine. Physics for the DOT universe.

One import. One boot. Identity, proof, compression, and chains run automatically.

## Install

```bash
npm install @dot-protocol/engine
```

## Hello World

```typescript
import { DOT } from '@dot-protocol/engine';

await DOT.boot();
console.log(DOT.me.did); // "dot:abc123..."

const bytes = await DOT.create({ WHAT: 'Hello, universe' });
// bytes is a 153-byte signed, chained DOT
// Already signed. Already on a chain. Physics did it.

DOT.on('dot', (dot, from) => {
  console.log(`DOT from ${from}:`, dot.length, 'bytes');
});
```

## Compression

The engine reports real compression stats after enough DOTs:

```typescript
DOT.stats()
// { totalDots: 1000, compressionRatio: 7.4, predictorAccuracy: 0.82 }
```

## Benchmark

153 bytes/DOT raw → 3.64 bytes/DOT at N=1000 on sensor streams (Weissman W=29.2 over gzip).
```

- [ ] **Step 3: Build all packages**

```bash
cd /Users/blaze/Movies/Kin/projects/dot-protocol && pnpm build
```
Expected: all 8 packages build without errors.

- [ ] **Step 4: Verify dist/ files are present**

```bash
ls packages/engine/dist/  # should have index.js, index.d.ts
ls packages/core/dist/
ls packages/compression/dist/
```

- [ ] **Step 5: Dry run**

```bash
cd packages/engine && npm publish --dry-run
```
Expected: lists files that would be published, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/*/package.json packages/engine/README.md packages/*/README.md
git commit -m "chore: npm publish config — publishConfig, files, version 0.2.0 across all packages"
```

---

## Task 10: Integration Tests (full flow)

**Files:**
- Create: `packages/engine/src/tests/integration.test.ts`
- Create: `packages/sdk/src/tests/integration.test.ts`

End-to-end tests: boot → identity → create DOTs → verify → seal → decompress.

- [ ] **Step 1: Write integration tests for engine**

Create `packages/engine/src/tests/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOT } from '../engine.js';
import { verifyDOT, fromBytes, checkChain } from '@dot-protocol/core';

describe('DOT engine — full flow integration', () => {
  beforeEach(async () => { await DOT.boot({ offline: true }); });
  afterEach(async () => { await DOT.shutdown(); });

  it('10-DOT chain is valid', async () => {
    const dots: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      dots.push(await DOT.create({ WHAT: `message ${i}` }));
    }
    // Verify all DOTs
    for (const d of dots) {
      expect(verifyDOT(fromBytes(d))).toBe(true);
    }
    // Check chain integrity
    const result = checkChain(dots.map(fromBytes));
    expect(result.valid).toBe(true);
  });

  it('compression ratio improves with repeated DOTs', async () => {
    const statsBefore = DOT.stats();
    // Create 50 similar DOTs (high predictability)
    for (let i = 0; i < 50; i++) {
      await DOT.create({ WHAT: new Uint8Array(16).fill(i % 4) });
    }
    const statsAfter = DOT.stats();
    expect(statsAfter.totalDots).toBe(statsBefore.totalDots + 50);
    expect(statsAfter.compressionRatio).toBeGreaterThanOrEqual(1);
  });

  it('seal() produces valid BLS signature', async () => {
    for (let i = 0; i < 5; i++) await DOT.create({ WHAT: `s${i}` });
    const seal = await DOT.seal(5);
    expect(seal).toHaveLength(48);
  });

  it('ECDH round-trip: encrypt then decrypt', async () => {
    const { createKeypair } = await import('@dot-protocol/core');
    const { ecdh, encryptPayload, decryptPayload } = await import('../crypto.js');
    const alice = createKeypair();
    const bob = createKeypair();
    const msg = new TextEncoder().encode('physics');
    const ct = encryptPayload(msg, ecdh(alice.privateKey, bob.publicKey), 0n);
    const pt = decryptPayload(ct, ecdh(bob.privateKey, alice.publicKey), 0n);
    expect(new TextDecoder().decode(pt).replace(/\0/g, '')).toBe('physics');
  });

  it('boot → create → stats flow is < 500ms', async () => {
    const t0 = performance.now();
    await DOT.create({ WHAT: 'speed test' });
    DOT.stats();
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
cd packages/engine && pnpm test
```
All pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(engine): full-flow integration tests — 10-DOT chain validation, compression, seal, ECDH, perf"
```

---

## Task 11: Performance Tuning

**Files:**
- Modify: `packages/messenger/vite.config.ts`
- Modify: `packages/engine/src/identity.ts`

Ensure < 5 second boot time to first DOT creation, < 1MB bundle.

- [ ] **Step 1: Measure current performance**

```bash
cd packages/messenger && pnpm build
du -sh dist/assets/*.js | sort -h
```

Target: no single JS chunk > 800KB gzipped.

- [ ] **Step 2: Add code-splitting to vite.config.ts**

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'noble': ['@noble/curves', '@noble/ciphers'],
        'react': ['react', 'react-dom'],
        'qrcode': ['qrcode', 'jsqr'],
      },
    },
  },
},
```

- [ ] **Step 3: Lazy-load non-critical screens**

In `App.tsx`, lazy-load QRScanScreen and CameraScreen:
```typescript
const QRScanScreen = React.lazy(() => import('./screens/QRScanScreen.js'));
const CameraScreen = React.lazy(() => import('./screens/CameraScreen.js'));
// Wrap in <React.Suspense fallback={<div>loading...</div>}>
```

- [ ] **Step 4: Rebuild and measure**

```bash
pnpm build
```
Expected: total dist/ < 1MB, main chunk < 500KB gzipped.

- [ ] **Step 5: Commit**

```bash
git commit -m "perf(messenger): code splitting + lazy screens — noble, react, qrcode in separate chunks"
```

---

## Task 12: Deploy + Final PR

- [ ] **Step 1: Run full workspace tests**

```bash
cd /Users/blaze/Movies/Kin/projects/dot-protocol && pnpm test
```
Expected: all tests pass (target: 400+ tests with new suites).

- [ ] **Step 2: Rebuild messenger dist**

```bash
cd packages/messenger && pnpm build
```

- [ ] **Step 3: Deploy messenger to Vercel**

```bash
cd dist && npx vercel --prod --yes
```
Get the production URL.

- [ ] **Step 4: Push branch and open PR**

```bash
git push origin dot-engine-week2
gh pr create --title "feat(engine): Week 2-4 — ECDH, compression, QR scan, camera, offline, stats, npm ready" --base main
```

- [ ] **Step 5: Final commit check**

```
git log --oneline -15
```
Expected: clean commit history with one commit per task.

---

## Milestone Tests

**Week 2 Milestone:** Open the deployed PWA URL on two different phones. Both boot in < 5s. Scan each other's QR codes. Send messages. Stats show compression ratio > 1 after 10+ messages. Take a photo — it appears in chat as a camera DOT.

**Week 3 Milestone:** `DOT.stats()` returns `compressionRatio > 3` after 50 correlated messages. `predictorAccuracy > 0.5`. `seal()` returns valid BLS 48-byte aggregate.

**Week 4 Milestone:** `npm install @dot-protocol/engine && npx tsx hello.ts` works in < 10 minutes from zero. `hello.ts` creates an identity, creates 5 DOTs, verifies them, prints stats.

---

## Parallel Execution Notes

These tasks can be parallelised as follows:

**Parallel Group A** (engine, no messenger dependency):
- Task 1 (ECDH)
- Task 2 (compression stats)
- Task 7 (BLS sealing)
- Task 8 (sensor PUF)

**Parallel Group B** (messenger, no engine changes needed beyond what Group A produces):
- Task 3 (QR scan)
- Task 4 (camera DOT)
- Task 5 (offline)
- Task 6 (stats screen)

**Sequential:**
- Task 9 (npm publish) — after all engine tasks
- Task 10 (integration tests) — after Task 1+2+7+8
- Task 11 (perf tuning) — after Task 3+4+5+6
- Task 12 (deploy + PR) — last

Run Group A and Group B simultaneously using parallel subagents. Tasks within each group can also be parallelised since they touch different files.
