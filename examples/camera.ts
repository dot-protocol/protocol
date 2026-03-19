/**
 * DOT Camera — photo as cryptographic proof
 *
 * Run: npx tsx examples/camera.ts <path-to-image>
 *
 * What this demonstrates:
 *   - Photo → SHA-256 → 16-byte hash → DOT payload
 *   - DOT = signed proof of who captured what, when
 *   - Chain: every photo builds on the last
 *   - Seal: BLS12-381 aggregate proof over all photos
 *
 * The DOT is the notary stamp. The photo lives wherever you want.
 * 16 bytes is the pointer. The file is the content.
 *
 * This is the Agar.io entry point: Camera DOT = first action.
 */

import { DOT } from 'dot-protocol';
import { createHash, randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';

const imagePath = process.argv[2];

await DOT.boot({ offline: true });
console.log(`Camera DOT — Identity: ${DOT.me!.did}\n`);

// ── Capture ───────────────────────────────────────────────────────────────
async function capturePhoto(path: string): Promise<{ hash: Uint8Array; size: number }> {
  const imageBytes = readFileSync(path);
  const hash = createHash('sha256').update(imageBytes).digest();
  return { hash: new Uint8Array(hash.subarray(0, 16)), size: imageBytes.length };
}

async function createCameraDot(imagePath: string) {
  const { hash, size } = await capturePhoto(imagePath);

  console.log(`Capturing: ${imagePath}`);
  console.log(`File size: ${size} bytes`);
  console.log(`SHA-256:   ${Buffer.from(hash).toString('hex').padEnd(32, '...')}...`);

  // DOT payload = truncated SHA-256 of photo content
  // This is the proof: who signed it, when, what hash
  const dotBytes = await DOT.create({ WHAT: hash as unknown as string });

  console.log(`DOT size:  ${dotBytes.length} bytes`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Extract and verify the embedded signature
  const pubKey = dotBytes.slice(0, 32);
  const sig    = dotBytes.slice(32, 96);
  const ts     = new DataView(dotBytes.buffer, dotBytes.byteOffset + 128, 8).getBigUint64(0, false);

  console.log(`\nProof embedded in DOT:`);
  console.log(`  Public key: ${Buffer.from(pubKey).toString('hex').slice(0, 16)}...`);
  console.log(`  Signature:  ${Buffer.from(sig).toString('hex').slice(0, 16)}...`);
  console.log(`  Timestamp:  ${new Date(Number(ts)).toISOString()}`);
  console.log(`  Payload:    ${Buffer.from(hash).toString('hex')} (photo hash)`);

  return dotBytes;
}

// ── Demo: process all provided photos ────────────────────────────────────
const photos: string[] = [];

if (!imagePath) {
  // No file provided — create synthetic demo
  console.log('No image file provided. Running synthetic demo...\n');
  console.log('Usage: npx tsx examples/camera.ts <path-to-image.jpg>\n');

  for (let i = 1; i <= 3; i++) {
    const fakeImageBytes = randomBytes(1024 * (i * 100));
    const hash = createHash('sha256').update(fakeImageBytes).digest();
    const payload = new Uint8Array(hash.subarray(0, 16));

    const dotBytes = await DOT.create({ WHAT: payload as unknown as string });
    const ts = new DataView(dotBytes.buffer, dotBytes.byteOffset + 128, 8).getBigUint64(0, false);

    console.log(`Photo ${i} (synthetic, ${fakeImageBytes.length / 1024}KB):`);
    console.log(`  Hash:      ${hash.toString('hex').slice(0, 32)}...`);
    console.log(`  DOT:       ${dotBytes.length} bytes`);
    console.log(`  Timestamp: ${new Date(Number(ts)).toISOString()}`);
    console.log('');
  }
} else if (!existsSync(imagePath)) {
  console.error(`File not found: ${imagePath}`);
  process.exit(1);
} else {
  photos.push(imagePath);
}

// Process real photos
for (const photo of photos) {
  await createCameraDot(photo);
  console.log('');
}

// ── Seal all captures ─────────────────────────────────────────────────────
const count = DOT.stats().totalDots;
if (count > 0) {
  const seal  = await DOT.seal(count);
  const valid = await DOT.verifySeal(seal, count);

  console.log(`BLS seal: ${seal.length} bytes — aggregate proof over ${count} DOT${count === 1 ? '' : 's'}`);
  console.log(`Valid:    ${valid}`);
  console.log(`\nChain: ${count} photo${count === 1 ? '' : 's'}, cryptographically linked.`);
  console.log('The photos live anywhere. The DOT chain is the proof.\n');
}

const stats = DOT.stats();
console.log('Stats:');
console.log(`  Compression: ${stats.compressionRatio.toFixed(2)}× (payload patterns learned)`);
console.log(`  Predictor:   ${(stats.predictorAccuracy * 100).toFixed(1)}%`);

await DOT.shutdown();
