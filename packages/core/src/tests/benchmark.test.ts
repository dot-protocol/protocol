import { describe, it } from 'vitest';
import { createKeypair, createDOT, toBytes, DotType } from '../index.js';
import { batchPack, batchPackBLS } from '../batch.js';
import { createBLSKeypair } from '../bls.js';

describe('compression benchmarks', () => {
  for (const N of [1, 5, 10, 50, 100]) {
    it(`N=${N}: measures Ed25519 batch and BLS batch compression`, async () => {
      const keypair = await createKeypair();
      const blsKeypair = createBLSKeypair();
      const dots: Uint8Array[] = [];
      let prev: Uint8Array | undefined;

      for (let i = 0; i < N; i++) {
        const payload = new Uint8Array(16);
        payload[0] = i & 0xFF;
        const dot = toBytes(await createDOT({
          keypair,
          payload,
          type: DotType.PUBLIC,
          ...(prev ? { previous: prev } : {}),
        }));
        dots.push(dot);
        prev = dot;
      }

      const individualSize = 153 * N;
      const ed25519BatchSize = batchPack(dots).length;
      const blsBatchSize = (await batchPackBLS(dots, blsKeypair)).length;

      const ed25519Savings = ((1 - ed25519BatchSize / individualSize) * 100).toFixed(1);
      const blsSavings = ((1 - blsBatchSize / individualSize) * 100).toFixed(1);

      console.log(`\nN=${N}:`);
      console.log(`  Individual:    ${individualSize}B (${(individualSize / N).toFixed(1)} B/DOT)`);
      console.log(`  Ed25519 batch: ${ed25519BatchSize}B (${(ed25519BatchSize / N).toFixed(1)} B/DOT) — ${ed25519Savings}% savings`);
      console.log(`  BLS batch:     ${blsBatchSize}B (${(blsBatchSize / N).toFixed(1)} B/DOT) — ${blsSavings}% savings`);

      // Ed25519 batch must be smaller than individual
      if (N > 1) {
        if (ed25519BatchSize >= individualSize) throw new Error(`Ed25519 batch not smaller than individual at N=${N}`);
      }

      // BLS batch must be smaller than Ed25519 batch for N >= 3
      if (N >= 3) {
        if (blsBatchSize >= ed25519BatchSize) throw new Error(`BLS batch not smaller than Ed25519 batch at N=${N}`);
      }
    });
  }
});
