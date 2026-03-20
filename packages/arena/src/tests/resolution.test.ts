import { describe, it, expect } from 'vitest';
import { createKeypair, createDOT } from '@dotprotocol/core';
import {
  verifyPrediction,
  verifyResolution,
  resolveSession,
  hashPredictionDOT,
} from '../resolution.js';
import type { BlindEvalSession, PredictionDOT, ResolutionDOT } from '../types.js';

async function makePrediction(domain = 'prediction'): Promise<{
  prediction: PredictionDOT;
  keypair: Awaited<ReturnType<typeof createKeypair>>;
}> {
  const keypair = await createKeypair();
  const dot = await createDOT({ keypair });
  const prediction: PredictionDOT = {
    dot,
    domain,
    claim: 'Test claim',
    expiresAt: Date.now() + 60_000,
  };
  return { prediction, keypair };
}

async function makeResolution(
  oracleKeypair: Awaited<ReturnType<typeof createKeypair>>,
  outcome: boolean
): Promise<ResolutionDOT> {
  const dot = await createDOT({ keypair: oracleKeypair });
  return {
    dot,
    predictionRef: new Uint8Array(32),
    outcome,
    evidence: 'test evidence',
  };
}

describe('verifyPrediction', () => {
  it('returns true for a valid prediction DOT', async () => {
    const { prediction } = await makePrediction();
    expect(await verifyPrediction(prediction)).toBe(true);
  });
});

describe('verifyResolution', () => {
  it('returns true for a valid resolution DOT', async () => {
    const kp = await createKeypair();
    const resolution = await makeResolution(kp, true);
    expect(await verifyResolution(resolution)).toBe(true);
  });
});

describe('resolveSession', () => {
  it('resolves a session and returns matches for all valid predictions', async () => {
    const oracleKp = await createKeypair();
    const { prediction } = await makePrediction();
    const resolution = await makeResolution(oracleKp, true);

    const session: BlindEvalSession = {
      id: 'test-session',
      domain: 'prediction',
      oracleKey: oracleKp.publicKey,
      closesAt: Date.now() - 1,
      predictions: [prediction],
    };

    const result = await resolveSession(session, resolution);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].correct).toBe(true);
    expect(result.session.resolvedAt).toBeDefined();
    expect(result.session.resolution).toBeDefined();
  });

  it('throws when resolution DOT pubkey does not match oracle key', async () => {
    const oracleKp = await createKeypair();
    const wrongKp = await createKeypair();
    const { prediction } = await makePrediction();
    const resolution = await makeResolution(wrongKp, true); // wrong signer

    const session: BlindEvalSession = {
      id: 'test-session',
      domain: 'prediction',
      oracleKey: oracleKp.publicKey, // expects oracleKp
      closesAt: Date.now() - 1,
      predictions: [prediction],
    };

    await expect(resolveSession(session, resolution)).rejects.toThrow(
      /oracle key/
    );
  });

  it('resolves multiple predictions in one session', async () => {
    const oracleKp = await createKeypair();
    const predictions = await Promise.all([
      makePrediction().then((p) => p.prediction),
      makePrediction().then((p) => p.prediction),
      makePrediction().then((p) => p.prediction),
    ]);
    const resolution = await makeResolution(oracleKp, false);

    const session: BlindEvalSession = {
      id: 'multi-session',
      domain: 'prediction',
      oracleKey: oracleKp.publicKey,
      closesAt: Date.now() - 1,
      predictions,
    };

    const result = await resolveSession(session, resolution);
    expect(result.matches).toHaveLength(3);
    expect(result.matches.every((m) => m.correct === false)).toBe(true);
  });
});

describe('hashPredictionDOT', () => {
  it('returns 32 bytes', async () => {
    const { prediction } = await makePrediction();
    const hash = await hashPredictionDOT(prediction);
    expect(hash).toHaveLength(32);
  });

  it('same prediction produces same hash', async () => {
    const { prediction } = await makePrediction();
    const h1 = await hashPredictionDOT(prediction);
    const h2 = await hashPredictionDOT(prediction);
    expect(h1).toEqual(h2);
  });

  it('different predictions produce different hashes', async () => {
    const { prediction: p1 } = await makePrediction();
    const { prediction: p2 } = await makePrediction();
    const h1 = await hashPredictionDOT(p1);
    const h2 = await hashPredictionDOT(p2);
    expect(h1).not.toEqual(h2);
  });
});
