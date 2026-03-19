/**
 * DOT Engine — Hello World
 *
 * Run: npx tsx hello.ts
 * The universe boots. Physics starts. Identity exists.
 */
import { DOT } from '../src/index.js';

async function main() {
  console.log('Booting DOT engine...');
  await DOT.boot({ offline: true });

  const me = DOT.me;
  console.log(`Identity: ${me!.did}`);

  // Create 5 DOTs — signed, chained, compressed automatically
  console.log('\nCreating 5 DOTs...');
  for (let i = 0; i < 5; i++) {
    const bytes = await DOT.create({ WHAT: `Hello, universe ${i}` });
    console.log(`  DOT ${i + 1}: ${bytes.length} bytes ✓`);
  }

  // Seal the chain
  const seal = await DOT.seal(5);
  console.log(`\nBLS seal: ${seal.length} bytes (48 = G1 aggregate signature)`);

  const valid = await DOT.verifySeal(seal, 5);
  console.log(`Seal valid: ${valid}`);

  // Stats
  const stats = DOT.stats();
  console.log('\nEngine stats:');
  console.log(`  Total DOTs:        ${stats.totalDots}`);
  console.log(`  Compression ratio: ${stats.compressionRatio.toFixed(2)}×`);
  console.log(`  Predictor:         ${(stats.predictorAccuracy * 100).toFixed(1)}%`);
  console.log(`  Seals:             ${stats.sealCount}`);

  await DOT.shutdown();
  console.log('\nDOT engine shut down. The chain persists.');
}

main().catch(console.error);
