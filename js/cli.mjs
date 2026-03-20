#!/usr/bin/env node
/**
 * DOT Protocol — CLI
 * Version 1.0.0 · doi.org/10.5281/zenodo.18946074
 * MIT
 *
 * Commands:
 *   init              Generate a new keypair, write to .dot-identity
 *   ping              Create an empty DOT (PING) using identity from .dot-identity
 *   sign <payload>    Create a DOT with payload text
 *   verify <file>     Verify a DOT file's signature
 *   chain <files...>  Verify a chain of DOT files
 *   inspect <file>    Human-readable DOT breakdown
 *   export <file>     Hex dump of a DOT file
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createKeypair, createDot, verifyDot, checkChain, toBytes, fromBytes, inspect, TYPE, ping } from './dot.mjs';

const IDENTITY_FILE = '.dot-identity';
const [, , cmd, ...args] = process.argv;

// ── Helpers ────────────────────────────────────────────────────────────────

function loadIdentity() {
  if (!existsSync(IDENTITY_FILE)) {
    console.error(`No identity found. Run: dot init`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(IDENTITY_FILE, 'utf8'));
  return {
    publicKey:  hex2bytes(raw.publicKey),
    privateKey: hex2bytes(raw.privateKey),
  };
}

function saveIdentity(key) {
  writeFileSync(IDENTITY_FILE, JSON.stringify({
    publicKey:  bytes2hex(key.publicKey),
    privateKey: bytes2hex(key.privateKey),
    created:    new Date().toISOString(),
    note:       'Keep privateKey secret — it IS your identity.',
  }, null, 2));
}

function bytes2hex(b) {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function hex2bytes(h) {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

function writeDot(buf, label) {
  const ts = Date.now();
  const filename = `${ts}.dot`;
  writeFileSync(filename, buf);
  console.log(`◉ ${label}`);
  console.log(`  file:    ${filename}`);
  console.log(`  size:    ${buf.length} bytes`);
  console.log(`  pubkey:  ${bytes2hex(buf.slice(0, 32)).slice(0, 16)}…`);
  return filename;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdInit() {
  if (existsSync(IDENTITY_FILE)) {
    console.error(`Identity already exists at ${IDENTITY_FILE}. Delete it first to generate a new one.`);
    process.exit(1);
  }
  const key = await createKeypair();
  saveIdentity(key);
  console.log(`◉ Identity generated`);
  console.log(`  pubkey:   ${bytes2hex(key.publicKey)}`);
  console.log(`  saved to: ${IDENTITY_FILE}`);
  console.log(`\n  Keep your privateKey secret. It IS your worldline.`);
}

async function cmdPing(previous) {
  const key = loadIdentity();
  let prev;
  if (previous) {
    const prevBuf = readFileSync(resolve(previous));
    prev = fromBytes(prevBuf);
  }
  const dot = await ping(key, prev);
  const buf = toBytes(dot);
  writeDot(buf, 'PING created');
}

async function cmdSign(payload, opts = {}) {
  if (!payload) {
    console.error('Usage: dot sign <payload> [--type public|circle|private|ephemeral] [--chain <prev.dot>]');
    process.exit(1);
  }
  const key = loadIdentity();
  const type = { public: TYPE.PUBLIC, circle: TYPE.CIRCLE, private: TYPE.PRIVATE, ephemeral: TYPE.EPHEMERAL }[opts.type] ?? TYPE.PUBLIC;
  let prev;
  if (opts.chain) {
    const prevBuf = readFileSync(resolve(opts.chain));
    prev = fromBytes(prevBuf);
  }
  const dot = await createDot({ key, payload, type, previous: prev });
  const buf = toBytes(dot);
  writeDot(buf, `DOT created (${opts.type ?? 'public'})`);
}

async function cmdVerify(file) {
  if (!file) { console.error('Usage: dot verify <file.dot>'); process.exit(1); }
  const buf = readFileSync(resolve(file));
  const dot = fromBytes(buf);
  const valid = await verifyDot(dot);
  if (valid) {
    console.log(`✓ Verified — signature valid`);
    console.log(`  pubkey:  ${bytes2hex(dot.pubkey).slice(0, 16)}…`);
    console.log(`  time:    ${new Date(dot.ts).toISOString()}`);
  } else {
    console.error(`✗ Invalid — signature verification failed`);
    process.exit(1);
  }
}

async function cmdChain(files) {
  if (!files.length) { console.error('Usage: dot chain <file1.dot> <file2.dot> ...'); process.exit(1); }
  const dots = files.map(f => fromBytes(readFileSync(resolve(f))));
  const result = await checkChain(dots);
  if (result.valid) {
    console.log(`✓ Chain valid — ${dots.length} DOTs`);
  } else {
    console.error(`✗ Chain broken at index ${result.brokenAt}: ${result.reason}`);
    process.exit(1);
  }
}

function cmdInspect(file) {
  if (!file) { console.error('Usage: dot inspect <file.dot>'); process.exit(1); }
  const buf = readFileSync(resolve(file));
  const dot = fromBytes(buf);
  const info = inspect(dot);
  console.log(`◉ DOT inspection`);
  for (const [k, v] of Object.entries(info)) {
    console.log(`  ${k.padEnd(8)} ${v ?? '(empty)'}`);
  }
}

function cmdExport(file) {
  if (!file) { console.error('Usage: dot export <file.dot>'); process.exit(1); }
  const buf = readFileSync(resolve(file));
  const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  console.log(`◉ DOT hex export (${buf.length} bytes)`);
  // Print in rows of 32 bytes (64 hex chars) with offsets
  for (let i = 0; i < hex.length; i += 64) {
    const offset = (i / 2).toString(10).padStart(3, ' ');
    const section = i < 64 ? 'pubkey' : i < 192 ? 'sig   ' : i < 256 ? 'chain ' : i < 272 ? 'ts    ' : i < 274 ? 'type  ' : 'payload';
    console.log(`  [${offset}] ${section}  ${hex.slice(i, i + 64)}`);
  }
}

function usage() {
  console.log(`
DOT Protocol CLI · doi.org/10.5281/zenodo.18946074

  dot init                        Generate identity keypair → .dot-identity
  dot ping [prev.dot]             Create empty DOT (PING)
  dot sign <text> [options]       Create DOT with payload
    --type public|circle|private|ephemeral
    --chain <prev.dot>
  dot verify <file.dot>           Verify signature
  dot chain <f1.dot> <f2.dot>…    Verify chain integrity
  dot inspect <file.dot>          Human-readable breakdown
  dot export <file.dot>           Hex dump with field labels

The act of contact leaves its dot.
`);
}

// ── Dispatch ────────────────────────────────────────────────────────────────

// Parse --key value flags
function parseFlags(args) {
  const flags = {}, pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[args[i].slice(2)] = args[++i];
    } else if (!args[i].startsWith('--')) {
      pos.push(args[i]);
    }
  }
  return { flags, pos };
}

const { flags, pos } = parseFlags(args);

switch (cmd) {
  case 'init':    await cmdInit(); break;
  case 'ping':    await cmdPing(pos[0]); break;
  case 'sign':    await cmdSign(pos[0], flags); break;
  case 'verify':  await cmdVerify(pos[0]); break;
  case 'chain':   await cmdChain(pos); break;
  case 'inspect': await cmdInspect(pos[0]); break;
  case 'export':  cmdExport(pos[0]); break;
  default:        usage();
}
