import {
  DOT_FILE_MAGIC, DOT_FILE_VERSION, DOT_FILE_HEADER_SIZE,
  DOT_FILE_FLAGS,
} from './dot-file-types.js';
import type { DotFileHeader, DotFile } from './dot-file-types.js';

export function writeDotFile(dots: Uint8Array[], options?: { compressed?: boolean }): Uint8Array {
  if (dots.length === 0) throw new Error('Cannot create .dot file with zero DOTs');
  for (const d of dots) {
    if (d.length !== 153) throw new Error(`DOT must be 153 bytes, got ${d.length}`);
  }
  const pubkey = dots[0].slice(0, 32);
  for (let i = 1; i < dots.length; i++) {
    for (let j = 0; j < 32; j++) {
      if (dots[i][j] !== pubkey[j]) {
        throw new Error('All DOTs in a .dot file must have the same pubkey');
      }
    }
  }

  // Extract first DOT's timestamp (big-endian uint64 at bytes 128-135)
  const first = dots[0];
  const tsView = new DataView(first.buffer, first.byteOffset + 128, 8);
  const tsHigh = tsView.getUint32(0, false);
  const tsLow = tsView.getUint32(4, false);
  const created = BigInt(tsHigh) * 0x100000000n + BigInt(tsLow);

  const flags = options?.compressed ? DOT_FILE_FLAGS.COMPRESSED : 0;
  const file = new Uint8Array(DOT_FILE_HEADER_SIZE + dots.length * 153);
  const view = new DataView(file.buffer);

  // Write header
  file.set(DOT_FILE_MAGIC, 0);
  file[4] = DOT_FILE_VERSION;
  file[5] = flags;
  view.setUint32(6, dots.length, true);   // count LE
  file.set(pubkey, 10);                    // pubkey 32B
  view.setUint32(42, Number(created >> 32n), false);   // created high
  view.setUint32(46, Number(created & 0xFFFFFFFFn), false); // created low

  // Write body
  for (let i = 0; i < dots.length; i++) {
    file.set(dots[i], DOT_FILE_HEADER_SIZE + i * 153);
  }
  return file;
}

export function readDotFile(data: Uint8Array): DotFile {
  if (data.length < DOT_FILE_HEADER_SIZE) {
    throw new Error(`File too small: ${data.length} bytes, need at least ${DOT_FILE_HEADER_SIZE}`);
  }
  for (let i = 0; i < 4; i++) {
    if (data[i] !== DOT_FILE_MAGIC[i]) {
      throw new Error('Not a .dot file: invalid magic bytes');
    }
  }
  const version = data[4];
  if (version !== DOT_FILE_VERSION) {
    throw new Error(`Unsupported .dot file version: ${version}`);
  }
  const flags = data[5];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(6, true);
  const pubkey = data.slice(10, 42);
  const tsHigh = view.getUint32(42, false);
  const tsLow = view.getUint32(46, false);
  const created = BigInt(tsHigh) * 0x100000000n + BigInt(tsLow);

  const header: DotFileHeader = { magic: data.slice(0, 4), version, flags, count, pubkey, created };

  if ((flags & DOT_FILE_FLAGS.COMPRESSED) !== 0) {
    throw new Error('Compressed .dot files not yet supported (Phase 2)');
  }

  const expectedSize = DOT_FILE_HEADER_SIZE + count * 153;
  if (data.length < expectedSize) {
    throw new Error(`File truncated: expected ${expectedSize} bytes, got ${data.length}`);
  }

  const dots: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const offset = DOT_FILE_HEADER_SIZE + i * 153;
    dots.push(data.slice(offset, offset + 153));
  }
  return { header, dots };
}

export function inspectDotFile(data: Uint8Array): string {
  const file = readDotFile(data);
  const h = file.header;
  const pubHex = Array.from(h.pubkey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
  const created = new Date(Number(h.created)).toISOString();
  const compressed = (h.flags & DOT_FILE_FLAGS.COMPRESSED) !== 0;
  return [
    `DOT Chain File v${h.version}`,
    `Identity:    ${pubHex}...`,
    `Created:     ${created}`,
    `DOT count:   ${h.count}`,
    `Compressed:  ${compressed ? 'yes (BLS batch)' : 'no (raw)'}`,
    `Header:      ${DOT_FILE_HEADER_SIZE} bytes`,
    `Body:        ${data.length - DOT_FILE_HEADER_SIZE} bytes`,
    `Total:       ${data.length} bytes`,
    `Per DOT:     ${(data.length / h.count).toFixed(1)} bytes`,
  ].join('\n');
}
