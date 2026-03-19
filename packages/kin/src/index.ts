#!/usr/bin/env node
/**
 * @dot-protocol/kin — MCP server
 *
 * Exposes the DOT protocol engine as MCP tools that any AI agent can call.
 * The engine IS the physics. The tools are the interface.
 *
 * Tools:
 *   dot_boot       — boot engine, create/load identity
 *   dot_create     — create a signed DOT (physics auto-apply)
 *   dot_verify     — verify a DOT's signature and chain position
 *   dot_chain      — current chain state
 *   dot_peers      — connected peers
 *   dot_send       — send a DOT to a specific peer
 *   dot_stats      — engine telemetry
 *   dot_seal       — BLS12-381 batch seal
 *   dot_health     — self-healing engine status
 *   kin_publish    — publish a voluntary DOT disclosure to the relay
 *   kin_subscribe  — subscribe to DOT feed from peers
 *
 * Usage:
 *   node dist/index.js                   # stdio (Claude Desktop, etc.)
 *   DOT_RELAY_URL=wss://... node dist/index.js
 *   DOT_OFFLINE=true node dist/index.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DOT } from '@dot-protocol/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Hex string must have even length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Derive public key bytes from a "dot:..." DID. */
function didToPublicKey(did: string): Uint8Array {
  const b64url = did.replace(/^dot:/, '');
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function assertBooted(): void {
  if (!DOT.me) throw new Error('Engine not booted. Call dot_boot first.');
}

// Subscription state for kin_subscribe
const _subscriptions: Array<{ did?: string; onDot?: (hex: string, from: string) => void }> = [];

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'dot-kin',
  version: '0.1.0',
  description: 'DOT Protocol engine as MCP tools. The physics layer for a new universe.',
});

// ---------------------------------------------------------------------------
// dot_boot
// ---------------------------------------------------------------------------

server.tool(
  'dot_boot',
  'Boot the DOT engine. Creates or loads Ed25519 identity from device entropy. Returns DOT ID (DID), public key, and boot status. Safe to call multiple times — re-boots cleanly.',
  {
    relay_url: z.string().optional().describe(
      'CHORUS relay WebSocket URL. Default: wss://dotdotdot.rocks. Use ws://localhost:8765 for local relay.'
    ),
    offline: z.boolean().optional().describe(
      'If true, skip relay connection. Useful for local-only use or testing. Default: false.'
    ),
    seal_every: z.number().int().min(0).optional().describe(
      'Auto-seal every N DOTs with BLS12-381. 0 = manual sealing only. Default: 0.'
    ),
  },
  async ({ relay_url, offline, seal_every }) => {
    const relayUrl = relay_url ?? process.env['DOT_RELAY_URL'] ?? 'wss://dotdotdot.rocks';
    const isOffline = offline ?? (process.env['DOT_OFFLINE'] === 'true') ?? false;

    await DOT.boot({
      relayUrl,
      offline: isOffline,
      sealEvery: seal_every ?? 0,
    });

    const me = DOT.me!;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'booted',
          did: me.did,
          public_key_hex: bytesToHex(me.publicKey),
          relay: isOffline ? 'offline' : relayUrl,
          peers_online: DOT.nearby.size,
          chain_length: DOT.getChain()?.length ?? 0,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_create
// ---------------------------------------------------------------------------

server.tool(
  'dot_create',
  'Create a signed DOT. Physics auto-apply: Ed25519 signing, SHA-256 chain linking, compression stats update, optional ECDH encryption if WHO is set. Returns the 153-byte DOT as hex.',
  {
    what: z.string().optional().describe(
      'Content string (max 16 UTF-8 bytes, truncated). Leave empty for a PING (presence signal).'
    ),
    who: z.string().optional().describe(
      'Recipient DID ("dot:...") or public key hex (64 chars). If set, payload is ECDH-encrypted for that recipient only.'
    ),
    type: z.enum(['public', 'circle', 'private', 'ephemeral']).optional().describe(
      'Visibility: public=0x00, circle=0x01, private=0x02, ephemeral=0x03. Default: public.'
    ),
  },
  async ({ what, who, type: visibility }) => {
    assertBooted();

    const TYPE_BYTE: Record<string, number> = {
      public: 0x00, circle: 0x01, private: 0x02, ephemeral: 0x03,
    };

    let recipientPublicKey: Uint8Array | undefined;
    if (who) {
      try {
        recipientPublicKey = who.startsWith('dot:')
          ? didToPublicKey(who)
          : hexToBytes(who);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Invalid WHO: ${(e as Error).message}` }) }],
          isError: true,
        };
      }
    }

    const typeValue = visibility ? TYPE_BYTE[visibility] : 0x00;

    const dotBytes = await DOT.create({
      WHAT: what ?? '',
      WHO: recipientPublicKey,
      TYPE: typeValue,
    } as Parameters<typeof DOT.create>[0]);

    const stats = DOT.stats();
    const chain = DOT.getChain();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          dot_hex: bytesToHex(dotBytes),
          dot_base64: bytesToBase64(dotBytes),
          size_bytes: dotBytes.length,
          chain_length: chain?.length ?? 1,
          compression_ratio: stats.compressionRatio,
          predictor_accuracy: stats.predictorAccuracy,
          encrypted: !!recipientPublicKey,
          did: DOT.me!.did,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_verify
// ---------------------------------------------------------------------------

server.tool(
  'dot_verify',
  'Verify a DOT\'s Ed25519 signature and optional chain position. Returns signer DID, validity, timestamp, type, and payload.',
  {
    dot_hex: z.string().optional().describe('153-byte DOT as hex string (306 chars).'),
    dot_base64: z.string().optional().describe('153-byte DOT as base64 string (alternative to hex).'),
    chain_position: z.number().int().min(0).optional().describe(
      'Expected position in chain (0-indexed). Used for chain integrity check.'
    ),
  },
  async ({ dot_hex, dot_base64, chain_position }) => {
    if (!dot_hex && !dot_base64) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Provide dot_hex or dot_base64' }) }],
        isError: true,
      };
    }

    let dotBytes: Uint8Array;
    try {
      dotBytes = dot_hex ? hexToBytes(dot_hex) : base64ToBytes(dot_base64!);
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Invalid DOT encoding: ${(e as Error).message}` }) }],
        isError: true,
      };
    }

    if (dotBytes.length !== 153) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `DOT must be exactly 153 bytes, got ${dotBytes.length}` }) }],
        isError: true,
      };
    }

    // Extract fields from wire format
    const publicKeyBytes = dotBytes.slice(0, 32);
    const signature = dotBytes.slice(32, 96);
    const chainHash = dotBytes.slice(96, 128);
    const tsBytes = dotBytes.slice(128, 136);
    const typeByte = dotBytes[136]!;
    const payload = dotBytes.slice(137, 153);

    // Timestamp (big-endian uint64)
    const tsMs = Number(
      new DataView(tsBytes.buffer, tsBytes.byteOffset, 8).getBigUint64(0, false)
    );

    // Signer DID
    let binary = '';
    for (const b of publicKeyBytes) binary += String.fromCharCode(b);
    const pubB64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const signerDid = `dot:${pubB64url}`;

    // Verify signature (sign over bytes 0..31 + 96..152, i.e. all except signature itself)
    const signedData = new Uint8Array(153 - 64);
    signedData.set(dotBytes.slice(0, 32));
    signedData.set(dotBytes.slice(96), 32);

    let valid = false;
    try {
      const spkiPrefix = new Uint8Array([
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
        0x70, 0x03, 0x21, 0x00,
      ]);
      const spki = new Uint8Array(spkiPrefix.length + 32);
      spki.set(spkiPrefix);
      spki.set(publicKeyBytes, spkiPrefix.length);

      const key = await crypto.subtle.importKey(
        'spki', spki.buffer as ArrayBuffer,
        { name: 'Ed25519' }, false, ['verify']
      );
      valid = await crypto.subtle.verify(
        'Ed25519', key,
        signature.buffer as ArrayBuffer,
        signedData.buffer as ArrayBuffer
      );
    } catch {
      valid = false;
    }

    const typeNames: Record<number, string> = {
      0x00: 'public', 0x01: 'circle', 0x02: 'private', 0x03: 'ephemeral',
    };

    const genesisHash = chainHash.every(b => b === 0);
    const chainHashHex = bytesToHex(chainHash);

    // Chain position check
    let chainCheck: Record<string, unknown> = {};
    if (chain_position !== undefined) {
      const ownChain = DOT.getChain(signerDid);
      const storedEntry = ownChain?.entries?.[chain_position];
      if (ownChain && storedEntry) {
        const stored = storedEntry.dot;
        const storedHex = bytesToHex(stored);
        const incoming = dot_hex ?? bytesToBase64(dotBytes);
        chainCheck = {
          position_matches: storedHex === incoming,
          stored_at_position: storedHex.slice(0, 20) + '...',
        };
      } else {
        chainCheck = { chain_position_checked: false, reason: 'Signer chain not in engine' };
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid,
          signer_did: signerDid,
          signer_pubkey_hex: bytesToHex(publicKeyBytes),
          signature_hex: bytesToHex(signature),
          timestamp_ms: tsMs,
          timestamp_iso: new Date(tsMs).toISOString(),
          type: typeNames[typeByte] ?? `0x${typeByte.toString(16)}`,
          payload_hex: bytesToHex(payload),
          payload_text: (() => {
            try { return new TextDecoder().decode(payload).replace(/\0/g, ''); } catch { return ''; }
          })(),
          chain_hash_hex: chainHashHex,
          is_genesis: genesisHash,
          ...chainCheck,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_chain
// ---------------------------------------------------------------------------

server.tool(
  'dot_chain',
  'Return current chain state for own identity or a specific peer DID.',
  {
    did: z.string().optional().describe('Peer DID to inspect ("dot:..."). Defaults to own chain.'),
    include_dots: z.boolean().optional().describe('Include hex of each DOT in chain. Default: false (just metadata).'),
  },
  async ({ did, include_dots }) => {
    assertBooted();
    const targetDid = did ?? DOT.me!.did;
    const chain = DOT.getChain(targetDid);

    if (!chain) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `No chain found for ${targetDid}` }) }],
        isError: true,
      };
    }

    const entries = chain.entries ?? [];
    const lastDot = chain.lastDot ?? null;

    const result: Record<string, unknown> = {
      chain_id: chain.id,
      length: chain.length,
      head_hex: lastDot ? bytesToHex(lastDot) : null,
      head_hash: lastDot ? bytesToHex(lastDot.slice(0, 8)) + '...' : null,
    };

    if (include_dots) {
      result['dots'] = entries.map((e, i) => ({
        position: i,
        hex: bytesToHex(e.dot),
        timestamp_ms: e.timestamp,
      }));
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_peers
// ---------------------------------------------------------------------------

server.tool(
  'dot_peers',
  'List discovered peers. Peers are found via relay presence, BLE scan, or QR code.',
  {},
  async () => {
    assertBooted();
    const peers = Array.from(DOT.nearby.values()).map(p => ({
      did: p.did,
      public_key_hex: bytesToHex(p.publicKey),
      last_seen_ms: p.lastSeen,
      last_seen_iso: new Date(p.lastSeen).toISOString(),
      connected_via: p.connectedVia,
      chain_length: DOT.getChain(p.did)?.length ?? 0,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ count: peers.length, peers }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_send
// ---------------------------------------------------------------------------

server.tool(
  'dot_send',
  'Create and send a DOT to a specific peer. ECDH encryption is automatic when a recipient is specified. Physics auto-apply: sign, chain, compress.',
  {
    to: z.string().describe('Recipient DID ("dot:...") or public key hex (64 chars).'),
    what: z.string().optional().describe('Message content (max 16 UTF-8 bytes). Leave empty for a PING.'),
    type: z.enum(['public', 'circle', 'private', 'ephemeral']).optional().describe('Visibility type. Default: private.'),
  },
  async ({ to, what, type: visibility }) => {
    assertBooted();

    let recipientPublicKey: Uint8Array;
    try {
      recipientPublicKey = to.startsWith('dot:')
        ? didToPublicKey(to)
        : hexToBytes(to);
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Invalid recipient: ${(e as Error).message}` }) }],
        isError: true,
      };
    }

    const TYPE_BYTE: Record<string, number> = {
      public: 0x00, circle: 0x01, private: 0x02, ephemeral: 0x03,
    };
    const typeValue = visibility ? TYPE_BYTE[visibility] : 0x02; // default: private

    const dotBytes = await DOT.create({
      WHAT: what ?? '',
      WHO: recipientPublicKey,
      TYPE: typeValue,
    } as Parameters<typeof DOT.create>[0]);

    const stats = DOT.stats();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sent: true,
          to_did: to.startsWith('dot:') ? to : `(pubkey:${to.slice(0, 16)}...)`,
          dot_hex: bytesToHex(dotBytes),
          size_bytes: dotBytes.length,
          compressed_size_estimate: Math.round(dotBytes.length / stats.compressionRatio),
          chain_length: DOT.getChain()?.length ?? 1,
          encryption: 'ECDH+ChaCha20',
          relay_connected: stats.relayConnected,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_stats
// ---------------------------------------------------------------------------

server.tool(
  'dot_stats',
  'Return live engine telemetry: compression ratio, predictor accuracy, chain depth, relay status, seal count, boot time.',
  {},
  async () => {
    assertBooted();
    const stats = DOT.stats();
    const health = DOT.health();
    const chain = DOT.getChain();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: health.status,
          did: DOT.me!.did,
          total_dots: stats.totalDots,
          chain_length: chain?.length ?? 0,
          compression_ratio: stats.compressionRatio,
          predictor_accuracy: stats.predictorAccuracy,
          bits_per_dot: stats.bitsPerDot,
          seal_count: stats.sealCount,
          relay_connected: stats.relayConnected,
          peers_online: stats.peersOnline,
          uptime_ms: health.uptimeMs,
          issues: health.issues,
          healing_actions: health.healingActions,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_seal
// ---------------------------------------------------------------------------

server.tool(
  'dot_seal',
  'BLS12-381 aggregate seal over the last N DOTs. Returns 48-byte G1 signature proving chain integrity. Verifiable by anyone with the public key.',
  {
    n: z.number().int().min(1).optional().describe('Number of most recent DOTs to seal. Defaults to all.'),
    verify: z.boolean().optional().describe('Verify the seal immediately after creating. Default: true.'),
  },
  async ({ n, verify = true }) => {
    assertBooted();

    const sealBytes = await DOT.seal(n);
    if (!sealBytes || sealBytes.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'No DOTs to seal' }) }],
        isError: true,
      };
    }

    let verified: boolean | null = null;
    if (verify) {
      verified = await DOT.verifySeal(sealBytes, n);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          seal_hex: bytesToHex(sealBytes),
          seal_base64: bytesToBase64(sealBytes),
          size_bytes: sealBytes.length,
          covers_dots: n ?? DOT.getChain()?.length ?? 0,
          algorithm: 'BLS12-381 G1 aggregate',
          verified,
          signer_did: DOT.me!.did,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// dot_health
// ---------------------------------------------------------------------------

server.tool(
  'dot_health',
  'Return self-awareness report: relay health, chain validity, predictor trend, compression stats, healing actions taken.',
  {},
  async () => {
    assertBooted();
    const report = DOT.health();
    return {
      content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// kin_publish
// ---------------------------------------------------------------------------

server.tool(
  'kin_publish',
  'Publish a voluntary DOT disclosure to the relay. This is how Kin proves things without revealing secrets — the proof is in the signed DOT, not in what you disclose.',
  {
    claim: z.string().describe('What you are claiming (e.g., "age_verified", "location", "credential").'),
    value: z.string().describe('The claim value or description (truncated to 16 bytes in payload).'),
    evidence_hash: z.string().optional().describe('Optional hex hash of supporting evidence stored externally (IPFS, etc.).'),
  },
  async ({ claim, value, evidence_hash }) => {
    assertBooted();

    // Build a compact 16-byte payload: first 8 chars of claim + 8 chars of value
    const claimBytes = new TextEncoder().encode(claim.slice(0, 8).padEnd(8, '\0'));
    const valueBytes = new TextEncoder().encode(value.slice(0, 8).padEnd(8, '\0'));
    const payload = new Uint8Array(16);
    payload.set(claimBytes.slice(0, 8));
    payload.set(valueBytes.slice(0, 8), 8);

    const dotBytes = await DOT.create({
      WHAT: new TextDecoder().decode(payload),
      TYPE: 0x00, // public disclosure
    } as Parameters<typeof DOT.create>[0]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          published: true,
          claim,
          value,
          evidence_hash: evidence_hash ?? null,
          dot_hex: bytesToHex(dotBytes),
          signer_did: DOT.me!.did,
          timestamp_iso: new Date().toISOString(),
          relay_connected: DOT.stats().relayConnected,
          note: 'The signed DOT is the proof. The claim is verifiable by anyone with your public key.',
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// kin_subscribe
// ---------------------------------------------------------------------------

server.tool(
  'kin_subscribe',
  'Register to receive DOTs from specific peers or all peers. Returns confirmation; incoming DOTs are emitted via engine events and visible in dot_stats.',
  {
    peers: z.array(z.string()).optional().describe('Array of peer DIDs ("dot:...") to subscribe to. Empty = subscribe to all.'),
    callback_note: z.string().optional().describe('Note for yourself about why you are subscribing.'),
  },
  async ({ peers: targetPeers, callback_note }) => {
    assertBooted();

    const subscribed: string[] = [];

    const handleDot = (dotBytes: Uint8Array, from: string) => {
      const dotHex = bytesToHex(dotBytes);
      // Filter to subscribed peers if specified
      if (targetPeers && targetPeers.length > 0) {
        const fromDid = from.startsWith('dot:') ? from : `dot:${from}`;
        if (!targetPeers.includes(fromDid)) return;
      }
      // Log to stderr so the MCP client can see incoming DOTs without polluting tool output
      process.stderr.write(
        JSON.stringify({
          event: 'dot_received',
          from,
          dot_hex: dotHex,
          timestamp_iso: new Date().toISOString(),
        }) + '\n'
      );
    };

    DOT.on('dot', handleDot);
    _subscriptions.push({ onDot: handleDot });

    if (targetPeers) {
      subscribed.push(...targetPeers);
    } else {
      subscribed.push('*'); // all peers
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          subscribed: true,
          listening_to: subscribed,
          note: callback_note ?? null,
          hint: 'Incoming DOTs are logged to stderr. Use dot_stats to see activity counts.',
          current_peers: DOT.nearby.size,
        }, null, 2),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr to avoid polluting stdio MCP protocol
  process.stderr.write('[dot-kin] MCP server running on stdio\n');
  process.stderr.write(`[dot-kin] Engine: not booted yet (call dot_boot)\n`);
}

main().catch((err) => {
  process.stderr.write(`[dot-kin] Fatal: ${err}\n`);
  process.exit(1);
});
