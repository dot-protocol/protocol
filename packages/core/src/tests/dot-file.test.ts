import { describe, it, expect } from 'vitest';
import { writeDotFile, readDotFile, inspectDotFile } from '../dot-file.js';
import { DOT_FILE_HEADER_SIZE } from '../dot-file-types.js';
import { createKeypair, createDOT, toBytes, verifyDOT, fromBytes, DotType } from '../index.js';

describe('.dot file format', () => {
  it('roundtrips a single DOT', async () => {
    const keypair = await createKeypair();
    const bytes = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const file = writeDotFile([bytes]);
    expect(file.length).toBe(DOT_FILE_HEADER_SIZE + 153);
    const parsed = readDotFile(file);
    expect(parsed.dots.length).toBe(1);
    expect(parsed.dots[0]).toEqual(bytes);
  });

  it('roundtrips 100 chained DOTs', async () => {
    const keypair = await createKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;
    for (let i = 0; i < 100; i++) {
      const payload = new Uint8Array(16);
      payload[0] = i;
      const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }
    const file = writeDotFile(dots);
    expect(file.length).toBe(DOT_FILE_HEADER_SIZE + 100 * 153);
    const parsed = readDotFile(file);
    expect(parsed.dots.length).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(parsed.dots[i]).toEqual(dots[i]);
    }
  });

  it('has correct magic bytes', async () => {
    const keypair = await createKeypair();
    const dot = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const file = writeDotFile([dot]);
    expect(file[0]).toBe(0x44); // D
    expect(file[1]).toBe(0x4F); // O
    expect(file[2]).toBe(0x54); // T
    expect(file[3]).toBe(0x00);
  });

  it('rejects non-.dot files', () => {
    const garbage = new Uint8Array(200);
    crypto.getRandomValues(garbage);
    expect(() => readDotFile(garbage)).toThrow('Not a .dot file');
  });

  it('rejects truncated files', async () => {
    const keypair = await createKeypair();
    const dot = toBytes(await createDOT({ keypair, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const file = writeDotFile([dot]);
    expect(() => readDotFile(file.slice(0, 100))).toThrow('truncated');
  });

  it('rejects mixed pubkeys', async () => {
    const kp1 = await createKeypair();
    const kp2 = await createKeypair();
    const d1 = toBytes(await createDOT({ keypair: kp1, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    const d2 = toBytes(await createDOT({ keypair: kp2, payload: new Uint8Array(16), type: DotType.PUBLIC }));
    expect(() => writeDotFile([d1, d2])).toThrow('same pubkey');
  });

  it('inspect produces readable output', async () => {
    const keypair = await createKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;
    for (let i = 0; i < 5; i++) {
      const dot = toBytes(await createDOT({ keypair, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }
    const info = inspectDotFile(writeDotFile(dots));
    expect(info).toContain('DOT Chain File v1');
    expect(info).toContain('DOT count:   5');
    expect(info).toContain('Compressed:  no');
  });

  it('every DOT in file verifies', async () => {
    const keypair = await createKeypair();
    const dots: Uint8Array[] = [];
    let prev: Uint8Array | undefined;
    for (let i = 0; i < 10; i++) {
      const payload = new Uint8Array(16);
      payload[0] = i;
      const dot = toBytes(await createDOT({ keypair, payload, type: DotType.PUBLIC, ...(prev ? { previous: prev } : {}) }));
      dots.push(dot);
      prev = dot;
    }
    const parsed = readDotFile(writeDotFile(dots));
    for (const dotBytes of parsed.dots) {
      expect(await verifyDOT(fromBytes(dotBytes))).toBe(true);
    }
  });
});
