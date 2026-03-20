import { describe, it, expect } from 'vitest';
import { createIdentity, exportIdentity, importIdentity } from '../index.js';

describe('createIdentity', () => {
  it('returns a keypair with 32-byte public and private keys', async () => {
    const id = await createIdentity();
    expect(id.keypair.publicKey.length).toBe(32);
    expect(id.keypair.privateKey.length).toBe(32);
  });

  it('returns a genesis DOT (exactly 153 bytes)', async () => {
    const { toBytes } = await import('@dotprotocol/core');
    const id = await createIdentity();
    expect(toBytes(id.genesisDOT).length).toBe(153);
  });

  it('genesis DOT is signed by identity keypair', async () => {
    const { verifyDOT } = await import('@dotprotocol/core');
    const id = await createIdentity();
    expect(await verifyDOT(id.genesisDOT)).toBe(true);
  });

  it('two identities have different public keys', async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    expect(a.keypair.publicKey).not.toEqual(b.keypair.publicKey);
  });

  it('deterministic with seed', async () => {
    const seed = new Uint8Array(32).fill(0x42);
    const a = await createIdentity(seed);
    const b = await createIdentity(seed);
    expect(a.keypair.publicKey).toEqual(b.keypair.publicKey);
  });
});

describe('export/import roundtrip', () => {
  it('exported identity reimports to same keypair', async () => {
    const id = await createIdentity();
    const exported = exportIdentity(id);
    const imported = await importIdentity(exported);
    expect(imported.keypair.publicKey).toEqual(id.keypair.publicKey);
    expect(imported.keypair.privateKey).toEqual(id.keypair.privateKey);
  });

  it('exported identity is plain JSON-serializable object', async () => {
    const id = await createIdentity();
    const exported = exportIdentity(id);
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);
    expect(parsed.publicKey).toBe(exported.publicKey);
    expect(parsed.privateKey).toBe(exported.privateKey);
    expect(parsed.genesisDOT).toBe(exported.genesisDOT);
  });

  it('reimported genesis DOT still verifies', async () => {
    const { verifyDOT } = await import('@dotprotocol/core');
    const id = await createIdentity();
    const imported = await importIdentity(exportIdentity(id));
    expect(await verifyDOT(imported.genesisDOT)).toBe(true);
  });
});
