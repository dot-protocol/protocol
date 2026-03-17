/**
 * test_dot_core.mjs — Comprehensive test suite for dot_core.js
 * Run with: node test_dot_core.mjs
 *
 * Covers: keypair, genesis, verify, tampering, chains, sensor payload,
 *         hex/base64 helpers, fromBytes/toBytes, TYPE constants, inspect, checkChain
 */

import {
  createKeypair,
  createDot,
  verifyDot,
  checkChain,
  toBytes,
  fromBytes,
  ping,
  inspect,
  TYPE,
  packSensorPayload,
  unpackSensorPayload,
  dotToBase64,
  dotFromBase64,
  dotToHex,
  dotFromHex,
} from './dot_core.js';

// ── Test runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write('.');
  } else {
    failed++;
    failures.push(message);
    process.stdout.write('F');
  }
}

function assertEqual(a, b, message) {
  assert(a === b, `${message} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertArrayEqual(a, b, message) {
  const ok = a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
  assert(ok, `${message} — arrays differ`);
}

async function run(name, fn) {
  try {
    await fn();
  } catch (e) {
    failed++;
    failures.push(`${name}: threw ${e.message}`);
    process.stdout.write('E');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function tamper(bytes, offset, value) {
  const copy = new Uint8Array(bytes);
  copy[offset] = value;
  return copy;
}

// ── TEST 1: Key generation ─────────────────────────────────────────────────

await run('1. Key generation', async () => {
  const kp = await createKeypair();

  assertEqual(kp.publicKey.length,  32, '1a publicKey is 32 bytes');
  assertEqual(kp.privateKey.length, 32, '1b privateKey is 32 bytes');

  assert(!kp.publicKey.every(b => b === 0),  '1c publicKey is not all zeros');
  assert(!kp.privateKey.every(b => b === 0), '1d privateKey is not all zeros');

  const kp2 = await createKeypair();
  assert(!Array.from(kp.publicKey).every((v, i) => v === kp2.publicKey[i]),
    '1e two keypairs have different public keys');
  assert(!Array.from(kp.privateKey).every((v, i) => v === kp2.privateKey[i]),
    '1f two keypairs have different private keys');
});

// ── TEST 2: Genesis DOT ────────────────────────────────────────────────────

await run('2. Genesis DOT', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp });
  const buf = toBytes(dot);

  assertEqual(buf.length, 153, '2a genesis DOT is 153 bytes');

  const chainField = buf.slice(96, 128);
  assert(chainField.every(b => b === 0), '2b chain field is all zero bytes for genesis');

  assertEqual(buf[136], 0x00, '2c type byte is 0x00 (PUBLIC) by default');
});

// ── TEST 3: Signature verification ────────────────────────────────────────

await run('3. Signature verification', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp, payload: 'hello world!' });

  assert(await verifyDot(dot), '3a valid DOT verifies');

  // tamper payload (byte 137)
  const tamperedPayload = fromBytes(tamper(toBytes(dot), 137, (toBytes(dot)[137] ^ 0xff)));
  assert(!await verifyDot(tamperedPayload), '3b tampered payload fails verify');

  // tamper signature (byte 32)
  const tamperedSig = fromBytes(tamper(toBytes(dot), 32, (toBytes(dot)[32] ^ 0xff)));
  assert(!await verifyDot(tamperedSig), '3c tampered signature fails verify');

  // tamper pubkey (byte 0) — this makes sig unverifiable against the mangled key
  const tamperedPub = fromBytes(tamper(toBytes(dot), 0, (toBytes(dot)[0] ^ 0xff)));
  assert(!await verifyDot(tamperedPub), '3d tampered pubkey fails verify');

  // tamper chain field (byte 96)
  const tamperedChain = fromBytes(tamper(toBytes(dot), 96, (toBytes(dot)[96] ^ 0xff)));
  assert(!await verifyDot(tamperedChain), '3e tampered chain field fails verify');

  // tamper timestamp (byte 128)
  const tamperedTs = fromBytes(tamper(toBytes(dot), 128, (toBytes(dot)[128] ^ 0xff)));
  assert(!await verifyDot(tamperedTs), '3f tampered timestamp fails verify');

  // tamper type byte (byte 136) — bit-flip guarantees change regardless of original type
  const tamperedType = fromBytes(tamper(toBytes(dot), 136, dot.type ^ 0x01));
  assert(!await verifyDot(tamperedType), '3g tampered type byte fails verify');
});

// ── TEST 4: Cross-keypair rejection ───────────────────────────────────────

await run('4. Cross-keypair rejection', async () => {
  const kpA = await createKeypair();
  const kpB = await createKeypair();

  const dotA = await createDot({ key: kpA, payload: 'signed by A' });
  const bytesA = toBytes(dotA);

  // Splice keypair B's pubkey into keypair A's DOT wire bytes
  const crossed = new Uint8Array(bytesA);
  crossed.set(kpB.publicKey, 0);
  const crossedDot = fromBytes(crossed);

  assert(!await verifyDot(crossedDot),
    '4a DOT signed by A fails verify when B pubkey is in wire bytes');
});

// ── TEST 5: Chain of 10 DOTs — all verify, hashes link ───────────────────

await run('5. Chain of 10 DOTs', async () => {
  const kp = await createKeypair();
  const chain = [];

  let prev = undefined;
  for (let i = 0; i < 10; i++) {
    const dot = await createDot({ key: kp, payload: `dot-${i}`, previous: prev });
    chain.push(dot);
    prev = dot;
  }

  // All verify individually
  for (let i = 0; i < 10; i++) {
    assert(await verifyDot(chain[i]), `5a chain[${i}] verifies`);
  }

  // Chain hashes link: chain[i].chain === SHA-256(toBytes(chain[i-1]))
  for (let i = 1; i < 10; i++) {
    const prevHash = new Uint8Array(
      await globalThis.crypto.subtle.digest('SHA-256', toBytes(chain[i - 1]))
    );
    assertArrayEqual(chain[i].chain, prevHash, `5b chain[${i}].chain links to chain[${i-1}]`);
  }

  // checkChain confirms valid
  const result = await checkChain(chain);
  assert(result.valid, '5c checkChain returns valid for a correct 10-DOT chain');
});

// ── TEST 6: Chain tamper detection ────────────────────────────────────────

await run('6. Chain tamper detection', async () => {
  const kp = await createKeypair();
  const chain = [];

  let prev = undefined;
  for (let i = 0; i < 7; i++) {
    const dot = await createDot({ key: kp, payload: `dot-${i}`, previous: prev });
    chain.push(dot);
    prev = dot;
  }

  // Tamper payload of DOT[4] (byte 137 of that DOT)
  const tamperedBytes = tamper(toBytes(chain[4]), 137, toBytes(chain[4])[137] ^ 0xff);
  chain[4] = fromBytes(tamperedBytes);

  const result = await checkChain(chain);
  assert(!result.valid,        '6a checkChain detects tampered chain');
  assertEqual(result.brokenAt, 4, '6b brokenAt is index 4');

  // DOTs 0-3 are individually still valid
  for (let i = 0; i < 4; i++) {
    assert(await verifyDot(chain[i]), `6c chain[${i}] still valid individually`);
  }
});

// ── TEST 7: Sensor payload packing — round-trip ───────────────────────────

await run('7. Sensor payload round-trip', async () => {
  const input = { lat: 37.7749, lng: -122.4194, accelMag: 981, pressure: 1013, heading: 180.5 };
  const packed = packSensorPayload(input);

  assertEqual(packed.length, 16, '7a packed payload is 16 bytes');

  const out = unpackSensorPayload(packed);

  // float32 has ~7 decimal digits of precision — use tolerance
  assert(Math.abs(out.lat - input.lat) < 0.001,      '7b lat round-trips within tolerance');
  assert(Math.abs(out.lng - input.lng) < 0.001,      '7c lng round-trips within tolerance');
  assertEqual(out.accelMag, input.accelMag,           '7d accelMag round-trips exactly');
  assertEqual(out.pressure, input.pressure,           '7e pressure round-trips exactly');
  assert(Math.abs(out.heading - input.heading) < 0.15, '7f heading round-trips within tolerance');
});

// ── TEST 8: Sensor payload — missing fields default to zero ───────────────

await run('8. Sensor payload defaults', async () => {
  const packed = packSensorPayload();
  assertEqual(packed.length, 16, '8a empty call produces 16 bytes');
  assert(packed.every(b => b === 0), '8b empty call produces all zeros');

  // Partial — only lat
  const partial = packSensorPayload({ lat: 51.5074 });
  const out = unpackSensorPayload(partial);
  assert(Math.abs(out.lat - 51.5074) < 0.001, '8c lat set correctly with partial input');
  assertEqual(out.lng,      0, '8d missing lng defaults to 0');
  assertEqual(out.accelMag, 0, '8e missing accelMag defaults to 0');
  assertEqual(out.pressure, 0, '8f missing pressure defaults to 0');
  assertEqual(out.heading,  0, '8g missing heading defaults to 0');
});

// ── TEST 8b: Sensor payload edge cases ────────────────────────────────────

await run('8b. Sensor payload edge cases', async () => {
  // Negative lat/lng
  const neg = packSensorPayload({ lat: -33.8688, lng: -70.6693 });
  const negOut = unpackSensorPayload(neg);
  assert(Math.abs(negOut.lat - (-33.8688)) < 0.001, '8h negative lat round-trips');
  assert(Math.abs(negOut.lng - (-70.6693)) < 0.001, '8i negative lng round-trips');

  // heading=359.9
  const highHead = packSensorPayload({ heading: 359.9 });
  const highHeadOut = unpackSensorPayload(highHead);
  assert(Math.abs(highHeadOut.heading - 359.9) < 0.15, '8j heading=359.9 round-trips');

  // accelMag=65535 (max uint16)
  const maxAccel = packSensorPayload({ accelMag: 65535 });
  const maxAccelOut = unpackSensorPayload(maxAccel);
  assertEqual(maxAccelOut.accelMag, 65535, '8k accelMag=65535 (max uint16) round-trips');

  // All-zero payload unpack
  const zeroPay = new Uint8Array(16);
  const zeroOut = unpackSensorPayload(zeroPay);
  assertEqual(zeroOut.lat,      0, '8l all-zero lat=0');
  assertEqual(zeroOut.accelMag, 0, '8m all-zero accelMag=0');
  assertEqual(zeroOut.heading,  0, '8n all-zero heading=0');
});

// ── TEST 9: Hex helpers ────────────────────────────────────────────────────

await run('9. Hex helpers', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp });
  const buf = toBytes(dot);

  // Round-trip 153-byte DOT
  const hex   = dotToHex(buf);
  assertEqual(hex.length, 306, '9a hex string is 306 chars for 153 bytes');
  assert(/^[0-9a-f]+$/.test(hex), '9b hex string is lowercase hex');
  const roundTripped = dotFromHex(hex);
  assertArrayEqual(roundTripped, buf, '9c hex round-trip matches original bytes');

  // Empty array
  const emptyHex = dotToHex(new Uint8Array(0));
  assertEqual(emptyHex, '', '9d empty array produces empty hex');
  assertArrayEqual(dotFromHex(''), new Uint8Array(0), '9e empty hex decodes to empty array');

  // Single byte
  const single = new Uint8Array([0xab]);
  assertEqual(dotToHex(single), 'ab', '9f single byte 0xab encodes to "ab"');
  assertArrayEqual(dotFromHex('ab'), single, '9g "ab" decodes to [0xab]');
});

// ── TEST 10: Base64 helpers ────────────────────────────────────────────────

await run('10. Base64 helpers', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp });
  const buf = toBytes(dot);

  // Round-trip 153-byte DOT
  const b64 = dotToBase64(buf);
  assert(typeof b64 === 'string', '10a base64 produces a string');
  const roundTripped = dotFromBase64(b64);
  assertArrayEqual(roundTripped, buf, '10b base64 round-trip matches original bytes');

  // Round-trip with non-ASCII bytes (all byte values 0-255)
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const allB64 = dotToBase64(allBytes);
  const allRound = dotFromBase64(allB64);
  assertArrayEqual(allRound, allBytes, '10c non-ASCII bytes round-trip through base64');
});

// ── TEST 11: fromBytes / toBytes round-trip ────────────────────────────────

await run('11. fromBytes / toBytes', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp, payload: 'round-trip!', type: TYPE.PRIVATE });
  const buf = toBytes(dot);

  // Round-trip
  const dot2 = fromBytes(buf);
  const buf2  = toBytes(dot2);
  assertArrayEqual(buf, buf2, '11a toBytes(fromBytes(toBytes(dot))) is stable');

  // Fields are accessible after round-trip
  assert(dot2.pubkey  instanceof Uint8Array, '11b pubkey is Uint8Array after round-trip');
  assert(dot2.sig     instanceof Uint8Array, '11c sig is Uint8Array after round-trip');
  assert(dot2.chain   instanceof Uint8Array, '11d chain is Uint8Array after round-trip');
  assert(typeof dot2.ts === 'number',        '11e ts is number after round-trip');
  assert(typeof dot2.type === 'number',      '11f type is number after round-trip');
  assert(dot2.payload instanceof Uint8Array, '11g payload is Uint8Array after round-trip');
  assertEqual(dot2.size, 153,                '11h size is 153');

  // Wrong size throws
  let threw = false;
  try {
    fromBytes(new Uint8Array(100));
  } catch (e) {
    threw = true;
  }
  assert(threw, '11i fromBytes(100-byte array) throws');
});

// ── TEST 12: TYPE constants ────────────────────────────────────────────────

await run('12. TYPE constants', async () => {
  assertEqual(TYPE.PUBLIC,    0x00, '12a PUBLIC = 0x00');
  assertEqual(TYPE.CIRCLE,    0x01, '12b CIRCLE = 0x01');
  assertEqual(TYPE.PRIVATE,   0x02, '12c PRIVATE = 0x02');
  assertEqual(TYPE.EPHEMERAL, 0x03, '12d EPHEMERAL = 0x03');
});

// ── TEST 13: Different types in wire format ────────────────────────────────

await run('13. Different types in wire format', async () => {
  const kp = await createKeypair();
  const types = [TYPE.PUBLIC, TYPE.CIRCLE, TYPE.PRIVATE, TYPE.EPHEMERAL];
  const names = ['PUBLIC', 'CIRCLE', 'PRIVATE', 'EPHEMERAL'];

  for (let i = 0; i < types.length; i++) {
    const dot = await createDot({ key: kp, type: types[i] });
    const buf = toBytes(dot);
    assertEqual(buf[136], types[i], `13${String.fromCharCode(97 + i)} TYPE.${names[i]} appears at byte 136`);
    assert(await verifyDot(dot), `13${String.fromCharCode(101 + i)} TYPE.${names[i]} DOT verifies`);
  }
});

// ── TEST 14: Payload truncation ────────────────────────────────────────────

await run('14. Payload truncation', async () => {
  const kp = await createKeypair();
  const longPayload = new Uint8Array(32).fill(0xaa); // 32 bytes, all 0xaa

  const dot = await createDot({ key: kp, payload: longPayload });
  const buf = toBytes(dot);

  // Payload field is bytes 137-152 (16 bytes)
  assertEqual(buf.length, 153, '14a DOT is still 153 bytes with oversized payload');
  // First 16 bytes of payload should be 0xaa
  for (let i = 0; i < 16; i++) {
    assertEqual(buf[137 + i], 0xaa, `14b payload byte ${i} is 0xaa (truncated)`);
  }
  // Only 16 bytes available — no overflow
  assert(await verifyDot(dot), '14c truncated-payload DOT still verifies');
});

// ── TEST 15: Private key not in wire bytes ─────────────────────────────────

await run('15. Private key isolation', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp });
  const buf = toBytes(dot);

  // Search for private key seed bytes in wire output — should not appear
  // (A simple substring search since the key is random 32 bytes)
  const privHex = Array.from(kp.privateKey, x => x.toString(16).padStart(2, '0')).join('');
  const wireHex = Array.from(buf,           x => x.toString(16).padStart(2, '0')).join('');

  assert(!wireHex.includes(privHex), '15a private key seed bytes do NOT appear in wire DOT');
});

// ── TEST 16: Determinism ───────────────────────────────────────────────────

await run('16. Determinism', async () => {
  const kp = await createKeypair();
  const fixedTs = 1700000000000n;
  const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                                  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10]);

  // Mock Date.now to return fixed timestamp
  const origDateNow = Date.now;
  Date.now = () => Number(fixedTs);

  let dot1, dot2;
  try {
    dot1 = await createDot({ key: kp, payload });
    dot2 = await createDot({ key: kp, payload });
  } finally {
    Date.now = origDateNow;
  }

  const buf1 = toBytes(dot1);
  const buf2 = toBytes(dot2);
  assertArrayEqual(buf1, buf2, '16a same keypair + payload + mocked ts = identical wire bytes');
});

// ── TEST 17: inspect() ────────────────────────────────────────────────────

await run('17. inspect()', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp, payload: 'hello' });
  const i   = inspect(dot);

  assert(typeof i.key === 'string',  '17a inspect.key is a string');
  assert(i.key.endsWith('…'),        '17b inspect.key ends with ellipsis');
  assert(i.key.length > 8,          '17c inspect.key has enough hex chars');

  assertEqual(i.chain, 'genesis',    '17d genesis DOT inspect.chain is "genesis"');

  // ISO 8601 format check — should be like 2025-03-17T...Z
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(i.time),
    '17e inspect.time is ISO 8601 with milliseconds');

  assertEqual(i.type, 'public',     '17f inspect.type is "public" for TYPE.PUBLIC');
  assertEqual(i.size, 153,          '17g inspect.size is 153');

  // Non-genesis chain link
  const dot2 = await createDot({ key: kp, previous: dot });
  const i2 = inspect(dot2);
  assert(i2.chain !== 'genesis', '17h chained DOT inspect.chain is not "genesis"');
  assert(i2.chain.endsWith('…'), '17i chained DOT inspect.chain ends with ellipsis');
});

// ── TEST 18: checkChain — empty array ─────────────────────────────────────

await run('18. checkChain empty', async () => {
  const result = await checkChain([]);
  assert(result.valid === true, '18a checkChain([]) returns { valid: true }');
});

// ── TEST 19: checkChain — single DOT ──────────────────────────────────────

await run('19. checkChain single', async () => {
  const kp  = await createKeypair();
  const dot = await createDot({ key: kp });
  const result = await checkChain([dot]);
  assert(result.valid === true, '19a checkChain([singleDot]) returns { valid: true }');
});

// ── TEST 20: Two keypairs in same chain ────────────────────────────────────

await run('20. Mixed-author chain', async () => {
  const kpA = await createKeypair();
  const kpB = await createKeypair();

  const dot0 = await createDot({ key: kpA, payload: 'by A' });
  // dot1 is signed by B but chains from dot0 (different author, valid chain link)
  const dot1 = await createDot({ key: kpB, payload: 'by B', previous: dot0 });

  // Each individual DOT must verify with its own pubkey
  assert(await verifyDot(dot0), '20a dot0 (by A) verifies individually');
  assert(await verifyDot(dot1), '20b dot1 (by B) verifies individually');

  // checkChain verifies signatures + chain hashes — DOT protocol does NOT enforce single-author
  // A chain can have multiple authors; the chain is valid as long as sigs and hashes are correct
  const result = await checkChain([dot0, dot1]);
  assert(result.valid === true,
    '20c mixed-author chain passes checkChain — DOT protocol allows multi-author chains');

  // Confirm they ARE different authors
  assert(!Array.from(dot0.pubkey).every((v, i) => v === dot1.pubkey[i]),
    '20d dot0 and dot1 have different pubkeys (different authors)');
});

// ── TEST 21: fromBytes bad input ───────────────────────────────────────────

await run('21. fromBytes bad input', async () => {
  let threw100 = false;
  let msg100 = '';
  try {
    fromBytes(new Uint8Array(100));
  } catch (e) {
    threw100 = true;
    msg100 = e.message;
  }
  assert(threw100, '21a fromBytes(100-byte array) throws');
  assert(msg100.includes('153'), '21b error message mentions 153 bytes');

  let threw200 = false;
  let msg200 = '';
  try {
    fromBytes(new Uint8Array(200));
  } catch (e) {
    threw200 = true;
    msg200 = e.message;
  }
  assert(threw200, '21c fromBytes(200-byte array) throws');
  assert(msg200.includes('153'), '21d error message mentions 153 bytes');
});

// ── TEST 22: ping() ────────────────────────────────────────────────────────

await run('22. ping()', async () => {
  const kp = await createKeypair();
  const dot = await ping(kp);

  // chain field must be 32 zero bytes (genesis)
  assert(dot.chain.every(b => b === 0), '22a ping() chain field is all zero bytes');

  // payload must be all zeros
  assert(dot.payload.every(b => b === 0), '22b ping() payload is all zeros');

  // signature must verify
  assert(await verifyDot(dot), '22c ping() signature verifies');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
