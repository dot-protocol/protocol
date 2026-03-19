/**
 * DOT Compression — Dictionary Training Pipeline Script
 *
 * Generates DOTs using a sensor profile, serializes batches in plain v2 and
 * dict-compressed v2, trains a zstd dictionary, and reports compression ratios
 * plus a Weissman score vs gzip.
 *
 * Usage:
 *   npx tsx scripts/train-dictionary.ts [--profile <profile>] [--count <n>] [--batch-size <n>]
 *
 * Example:
 *   npx tsx scripts/train-dictionary.ts --profile kulhadVoltage --count 1000 --batch-size 100
 */

import { createHash, gzipSync } from 'node:zlib';
import { createHash as cryptoHash } from 'node:crypto';
import { createKeypair, createBLSKeypair } from '@dot-protocol/core';
import { generateSensorStream, type SensorProfile } from '../src/sample-generator.js';
import { serializeBatchV2 } from '../src/batch-v2.js';
import { trainDictionary } from '../src/zstd.js';

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(): { profile: SensorProfile; count: number; batchSize: number } {
  const args = process.argv.slice(2);
  let profile: SensorProfile = 'kulhadVoltage';
  let count = 10_000;
  let batchSize = 100;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === '--profile' && next) {
      profile = next as SensorProfile;
      i++;
    } else if (arg === '--count' && next) {
      count = parseInt(next, 10);
      i++;
    } else if (arg === '--batch-size' && next) {
      batchSize = parseInt(next, 10);
      i++;
    }
  }

  return { profile, count, batchSize };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function pct(ratio: number): string {
  return ((1 - 1 / ratio) * 100).toFixed(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { profile, count, batchSize } = parseArgs();
  const batchCount = Math.ceil(count / batchSize);

  console.log('DOT Compression — Dictionary Training Pipeline');
  console.log(`Profile:        ${profile}`);
  console.log(`Total DOTs:     ${fmt(count)}`);
  console.log(`Batch size:     ${batchSize}`);
  console.log(`Batches:        ${batchCount}`);
  console.log('');

  // ── Generate all DOTs (one chain, same keypair) ───────────────────────────
  const keypair = await createKeypair();
  const blsKeypair = createBLSKeypair();

  const allDots = await generateSensorStream({ count, profile, keypair });

  // ── Group into batches ───────────────────────────────────────────────────
  const batches: Uint8Array[][] = [];
  for (let i = 0; i < count; i += batchSize) {
    batches.push(allDots.slice(i, i + batchSize));
  }

  // ── Serialize each batch in plain v2 (delta + RLE, no dict) ─────────────
  const plainBodies: Uint8Array[] = [];
  let totalPlainSize = 0;

  for (const batch of batches) {
    const frame = await serializeBatchV2(batch, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
    });
    plainBodies.push(frame);
    totalPlainSize += frame.length;
  }

  // ── Train dictionary on plain batch bodies ───────────────────────────────
  console.log(`Training dictionary on ${batchCount} batch samples (column layout)...`);
  const dictionary = await trainDictionary(plainBodies);
  console.log(`Dictionary size: ${fmt(dictionary.length)} bytes`);
  console.log('');

  // ── Compute dictionary ID: SHA-256(dictionary) ───────────────────────────
  const dictionaryId = new Uint8Array(
    cryptoHash('sha256').update(dictionary).digest().buffer,
  );

  // ── Serialize each batch WITH dictionary ─────────────────────────────────
  let totalDictSize = 0;
  for (const batch of batches) {
    const frame = await serializeBatchV2(batch, blsKeypair, {
      timestampDelta: true,
      payloadTypeRLE: true,
      dictionary,
      dictionaryId,
    });
    totalDictSize += frame.length;
  }

  // ── Gzip baseline: concatenate all raw DOT bytes, gzip once ──────────────
  const totalRawBytes = count * 153;
  const rawConcat = new Uint8Array(totalRawBytes);
  let offset = 0;
  for (const dot of allDots) {
    rawConcat.set(dot, offset);
    offset += dot.length;
  }
  const gzipped = gzipSync(rawConcat);
  const totalGzipSize = gzipped.length;

  // ── Compute ratios ────────────────────────────────────────────────────────
  const ratioDotPlain = totalRawBytes / totalPlainSize;
  const ratioDotDict = totalRawBytes / totalDictSize;
  const ratioGzip = totalRawBytes / totalGzipSize;

  const weissmanAlpha = 1.0;
  const weissmanScore = (weissmanAlpha * ratioDotDict) / ratioGzip;

  const bytesPerDotPlain = totalPlainSize / count;
  const bytesPerDotDict = totalDictSize / count;
  const bytesPerDotGzip = totalGzipSize / count;
  const bytesPerDotRaw = 153;

  const dictBonusRatio = totalPlainSize / totalDictSize;
  const dictBonusSavings = ((1 - 1 / dictBonusRatio) * 100).toFixed(1);

  // ── Print report ─────────────────────────────────────────────────────────
  console.log('Results:');
  console.log(`  Raw DOTs:           ${fmt(totalRawBytes).padStart(12)} bytes  (${bytesPerDotRaw.toFixed(2)} bytes/DOT)`);
  console.log(`  Batch v2 plain:     ${fmt(totalPlainSize).padStart(12)} bytes  (${bytesPerDotPlain.toFixed(2)} bytes/DOT)`);
  console.log(`  Batch v2 + dict:    ${fmt(totalDictSize).padStart(12)} bytes  (${bytesPerDotDict.toFixed(2)} bytes/DOT)`);
  console.log(`  Gzip baseline:      ${fmt(totalGzipSize).padStart(12)} bytes  (${bytesPerDotGzip.toFixed(2)} bytes/DOT)`);
  console.log('');

  console.log('Compression ratios:');
  console.log(`  Batch v2 plain:    ${ratioDotPlain.toFixed(1)}× vs raw  (${pct(ratioDotPlain)}% reduction)`);
  console.log(`  Batch v2 + dict:   ${ratioDotDict.toFixed(1)}× vs raw  (${pct(ratioDotDict)}% reduction)`);
  console.log(`  Dictionary bonus:   ${dictBonusRatio.toFixed(1)}× over plain  (${dictBonusSavings}% savings)`);
  console.log('');

  console.log(`Weissman Score vs gzip: W = ${weissmanScore.toFixed(3)}`);
  console.log('');

  if (bytesPerDotDict <= 8) {
    console.log(`✓ Dictionary achieves ≤ 8 bytes/DOT`);
  } else {
    console.log(`✗ Target not met: ${bytesPerDotDict.toFixed(2)} bytes/DOT`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
