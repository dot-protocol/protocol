/**
 * DOT Messenger — two devices, one relay, end-to-end encrypted
 *
 * Run two terminals:
 *   Terminal A: DOT_ROLE=alice npx tsx examples/messenger.ts
 *   Terminal B: DOT_ROLE=bob   npx tsx examples/messenger.ts
 *
 * What happens automatically:
 *   - Identity from entropy (Ed25519 keypair, no registration)
 *   - ECDH encryption (WHO triggers it — never call encrypt())
 *   - SHA-256 chained worldline (never call chain())
 *   - rANS compression (never call compress())
 *   - BLS12-381 aggregate proof every 10 DOTs (never call seal())
 *
 * The relay: wss://dotdotdot.rocks (CHORUS)
 */

import { DOT } from 'dot-protocol';
import * as readline from 'readline';

const RELAY = process.env.DOT_RELAY_URL ?? 'wss://dotdotdot.rocks';
const ROLE  = process.env.DOT_ROLE ?? 'alice';

console.log(`Booting DOT engine as ${ROLE}...`);
await DOT.boot({ relayUrl: RELAY });

const me = DOT.me!;
console.log(`Identity: ${me.did}`);
console.log(`Share this DID with the other party.\n`);

// ── Peer discovery ────────────────────────────────────────────────────────
let peer: { did: string; publicKey: Uint8Array } | null = null;

DOT.on('peer', (p: unknown) => {
  const peerInfo = p as { did: string; publicKey: Uint8Array };
  if (peerInfo.did === me.did) return; // ignore self
  if (!peer) {
    peer = peerInfo;
    console.log(`\nPeer connected: ${peer.did.slice(0, 24)}...`);
    console.log('You can now send messages. Type and press Enter.\n');
  }
});

// ── Receive DOTs ──────────────────────────────────────────────────────────
DOT.on('dot', (dotBytes: unknown, from: unknown) => {
  const bytes  = dotBytes as Uint8Array;
  const sender = from as string;
  if (sender === me.did) return; // ignore own echo

  // Decrypt if we have the sender's public key
  const senderPubKey = peer?.publicKey;
  if (senderPubKey) {
    const plaintext = DOT.decryptDot(bytes, senderPubKey);
    if (plaintext) {
      const text = new TextDecoder().decode(plaintext).replace(/\0/g, '').trim();
      if (text) {
        process.stdout.write(`\r${sender.slice(4, 12)}: ${text}\n> `);
        return;
      }
    }
  }

  // Fallback: show raw payload bytes [137..152]
  const raw = bytes.slice(137, 153);
  const text = new TextDecoder().decode(raw).replace(/\0/g, '').trim();
  if (text) process.stdout.write(`\r${sender.slice(4, 12)}: ${text}\n> `);
});

// ── Send DOTs ─────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin });

process.stdout.write('> ');
rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) { process.stdout.write('> '); return; }
  if (text === '/quit') { await DOT.shutdown(); process.exit(0); }

  await DOT.create({
    WHAT: text,
    WHO:  peer?.publicKey,  // WHO → ECDH encryption. Automatic.
  });

  // Auto-seal every 10 DOTs
  const stats = DOT.stats();
  if (stats.totalDots % 10 === 0) {
    const seal  = await DOT.seal(10);
    const valid = await DOT.verifySeal(seal, 10);
    console.log(`[seal] ${seal.length}B BLS proof over 10 DOTs — valid: ${valid}`);
    console.log(`[stats] ${stats.compressionRatio.toFixed(2)}× compression | ${(stats.predictorAccuracy * 100).toFixed(1)}% accuracy`);
  }

  process.stdout.write('> ');
});

console.log('Waiting for a peer... (or type to send to relay)\n');
