/**
 * DOT Hello World
 *
 * Run: npx tsx examples/hello.ts
 *
 * One import. The universe boots.
 * Physics auto-applies: sign, chain, compress, self-aware.
 */

import { DOT } from 'dot-protocol';

console.log('Booting DOT engine...');
await DOT.boot({ offline: true });

console.log(`Identity: ${DOT.me!.did}\n`);

console.log('Creating 5 DOTs...');
for (let i = 0; i < 5; i++) {
  const bytes = await DOT.create({ WHAT: `Hello, universe ${i}` });
  console.log(`  DOT ${i + 1}: ${bytes.length} bytes ✓`);
}

// Seal the last 5 DOTs with BLS12-381 aggregate proof
const seal = await DOT.seal(5);
console.log(`\nBLS seal: ${seal.length} bytes (G1 aggregate)`);

const valid = await DOT.verifySeal(seal, 5);
console.log(`Seal valid: ${valid}`);

// The universe's vital signs
const stats = DOT.stats();
console.log('\nEngine stats:');
console.log(`  Total DOTs:        ${stats.totalDots}`);
console.log(`  Compression ratio: ${stats.compressionRatio.toFixed(2)}×`);
console.log(`  Predictor:         ${(stats.predictorAccuracy * 100).toFixed(1)}%`);
console.log(`  Seals:             ${stats.sealCount}`);

await DOT.shutdown();
console.log('\nDOT engine shut down. The chain persists.');
