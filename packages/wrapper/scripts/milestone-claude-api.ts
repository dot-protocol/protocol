/**
 * DOT Protocol Phase 1 Milestone — Claude API Conversation
 *
 * Measures: raw HTTPS bytes vs DOT chain bytes for a multi-turn
 * Claude conversation. Verifies round-trip lossless invariant.
 *
 * Run:
 *   cd packages/wrapper
 *   npx tsx --tsconfig tsconfig.json scripts/milestone-claude-api.ts
 */

import { wrap, unwrap, createSession } from '../src/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationTurn {
  request: {
    model: string;
    max_tokens: number;
    messages: Message[];
  };
  response: {
    id: string;
    type: string;
    role: string;
    content: Array<{ type: string; text: string }>;
    model: string;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };
}

interface TurnStats {
  turn: number;
  label: string;
  rawBytes: number;
  dotBytes: number;
  ratio: number;
  verified: boolean;
  lossless: boolean;
}

// ─── Mock conversation (fallback when no API key) ─────────────────────────────

const MOCK_CONVERSATION: ConversationTurn[] = [
  {
    request: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'What is the DOT Protocol?' }],
    },
    response: {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The DOT Protocol is a 153-byte cryptographic observation format. Each DOT contains a public key (32B), Ed25519 signature (64B), SHA-256 chain hash (32B), timestamp (8B), type byte, and 16-byte payload. It is designed for zero-dependency, transport-agnostic attestation.',
        },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 58 },
    },
  },
  {
    request: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [
        { role: 'user', content: 'What is the DOT Protocol?' },
        {
          role: 'assistant',
          content:
            'The DOT Protocol is a 153-byte cryptographic observation format. Each DOT contains a public key (32B), Ed25519 signature (64B), SHA-256 chain hash (32B), timestamp (8B), type byte, and 16-byte payload. It is designed for zero-dependency, transport-agnostic attestation.',
        },
        { role: 'user', content: 'How does compression work in the DOT Protocol SDK?' },
      ],
    },
    response: {
      id: 'msg_02',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Compression in the DOT Protocol SDK uses batch serialization (batch-v2 format). Multiple DOTs are packed into column-oriented frames: timestamps stored as deltas, types run-length encoded, payloads concatenated. This achieves significant compression on repetitive sensor-like data streams. The BLS aggregate signature covers all DOTs in a batch, reducing per-DOT overhead from 64 bytes to a single 48-byte aggregate.',
        },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 87, output_tokens: 79 },
    },
  },
  {
    request: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [
        { role: 'user', content: 'What is the DOT Protocol?' },
        {
          role: 'assistant',
          content:
            'The DOT Protocol is a 153-byte cryptographic observation format. Each DOT contains a public key (32B), Ed25519 signature (64B), SHA-256 chain hash (32B), timestamp (8B), type byte, and 16-byte payload. It is designed for zero-dependency, transport-agnostic attestation.',
        },
        { role: 'user', content: 'How does compression work in the DOT Protocol SDK?' },
        {
          role: 'assistant',
          content:
            'Compression in the DOT Protocol SDK uses batch serialization (batch-v2 format). Multiple DOTs are packed into column-oriented frames: timestamps stored as deltas, types run-length encoded, payloads concatenated. This achieves significant compression on repetitive sensor-like data streams. The BLS aggregate signature covers all DOTs in a batch, reducing per-DOT overhead from 64 bytes to a single 48-byte aggregate.',
        },
        {
          role: 'user',
          content:
            'What is the Weissman Score for DOT compression and what techniques achieve it?',
        },
      ],
    },
    response: {
      id: 'msg_03',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The Weissman Score for DOT compression is W=29.2 over gzip on sensor streams, achieved through three techniques: (1) column layout separating timestamp, type, and payload columns for better entropy characteristics per column; (2) timestamp delta encoding — only the difference between consecutive timestamps is stored, compressing 8-byte values to 1-2 bytes for high-frequency streams; (3) type run-length encoding — consecutive DOTs of the same type (e.g., PUBLIC) encode as a count prefix rather than repeating the byte per DOT. Together these three transforms align the data to the pattern of real-world observation streams before any dictionary or entropy coding is applied.',
        },
      ],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 175, output_tokens: 128 },
    },
  },
];

// ─── Live API fetch ───────────────────────────────────────────────────────────

async function fetchClaudeConversation(apiKey: string): Promise<ConversationTurn[]> {
  const turns: ConversationTurn[] = [];
  const history: Message[] = [];
  const questions = [
    'What is the DOT Protocol?',
    'How does compression work in the DOT Protocol SDK?',
    'What is the Weissman Score for DOT compression and what techniques achieve it?',
  ];

  for (const question of questions) {
    history.push({ role: 'user', content: question });

    const requestPayload = {
      model: 'claude-opus-4-5',
      max_tokens: 200,
      messages: history,
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`);
    }

    const responsePayload = await res.json() as ConversationTurn['response'];
    const assistantText = responsePayload.content[0]?.text ?? '';
    history.push({ role: 'assistant', content: assistantText });

    turns.push({ request: requestPayload, response: responsePayload });
  }

  return turns;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function ratio(raw: number, dot: number): string {
  return (raw / dot).toFixed(2) + '×';
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

function lpad(s: string, len: number): string {
  return s.padStart(len);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const usingLive = Boolean(apiKey);

  console.log('DOT Protocol Phase 1 Milestone — Claude API Conversation');
  console.log('='.repeat(58));
  console.log(`Mode: ${usingLive ? 'LIVE (Anthropic API)' : 'MOCK (no ANTHROPIC_API_KEY found)'}`);
  console.log();

  // ── Fetch or use mock ────────────────────────────────────────────────────
  let conversation: ConversationTurn[];
  if (usingLive && apiKey) {
    console.log('Fetching live conversation from Anthropic API...');
    conversation = await fetchClaudeConversation(apiKey);
    console.log('Done.\n');
  } else {
    conversation = MOCK_CONVERSATION;
  }

  // ── Create stateful session ───────────────────────────────────────────────
  const session = await createSession();

  // ── Process each turn ─────────────────────────────────────────────────────
  const stats: TurnStats[] = [];
  let allVerified = true;
  let allLossless = true;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  for (let i = 0; i < conversation.length; i++) {
    const turn = conversation[i]!;
    const turnNum = i + 1;

    // — Request —
    const reqJson = JSON.stringify(turn.request);
    const reqBytes = enc.encode(reqJson);
    const rawReqBytes = reqBytes.length;

    const wrappedReq = await wrap(reqBytes, { protocol: 'json', session });
    const dotReqBytes = wrappedReq.frame.length;

    const unwrappedReq = await unwrap(wrappedReq.frame, { blsPublicKey: wrappedReq.blsPublicKey });
    const reqVerified = unwrappedReq.verified;
    const reqLossless = bytesEqual(unwrappedReq.data, reqBytes);

    const reqLabel = `Turn ${turnNum} — Request`;
    const userMsg = turn.request.messages.filter(m => m.role === 'user').pop();
    const userPreview = userMsg ? `"${userMsg.content.slice(0, 45)}${userMsg.content.length > 45 ? '...' : ''}"` : '';

    console.log(`${reqLabel}`);
    if (userPreview) console.log(`  User: ${userPreview}`);
    console.log(`  Raw JSON:  ${lpad(fmt(rawReqBytes) + ' B', 12)}  (baseline)`);
    console.log(`  DOT frame: ${lpad(fmt(dotReqBytes) + ' B', 12)}  (${ratio(rawReqBytes, dotReqBytes)} compression)`);
    console.log(`  Verified:  ${reqVerified ? '✓' : '✗'}  Lossless: ${reqLossless ? '✓' : '✗'}`);
    console.log();

    stats.push({
      turn: turnNum,
      label: `T${turnNum}-req`,
      rawBytes: rawReqBytes,
      dotBytes: dotReqBytes,
      ratio: rawReqBytes / dotReqBytes,
      verified: reqVerified,
      lossless: reqLossless,
    });

    if (!reqVerified) allVerified = false;
    if (!reqLossless) allLossless = false;

    // — Response —
    const resJson = JSON.stringify(turn.response);
    const resBytes = enc.encode(resJson);
    const rawResBytes = resBytes.length;

    const wrappedRes = await wrap(resBytes, { protocol: 'json', session });
    const dotResBytes = wrappedRes.frame.length;

    const unwrappedRes = await unwrap(wrappedRes.frame, { blsPublicKey: wrappedRes.blsPublicKey });
    const resVerified = unwrappedRes.verified;
    const resLossless = bytesEqual(unwrappedRes.data, resBytes);

    // Sanity-check: reconstruct and compare JSON round-trip
    const resRoundTrip = dec.decode(unwrappedRes.data);
    const resJsonMatch = resRoundTrip === resJson;

    const resLabel = `Turn ${turnNum} — Response`;
    const assistantText = turn.response.content[0]?.text ?? '';
    const assistantPreview = `"${assistantText.slice(0, 45)}${assistantText.length > 45 ? '...' : ''}"`;

    console.log(`${resLabel}`);
    console.log(`  Assistant: ${assistantPreview}`);
    console.log(`  Raw JSON:  ${lpad(fmt(rawResBytes) + ' B', 12)}  (baseline)`);
    console.log(`  DOT frame: ${lpad(fmt(dotResBytes) + ' B', 12)}  (${ratio(rawResBytes, dotResBytes)} compression)`);
    console.log(`  Verified:  ${resVerified ? '✓' : '✗'}  Lossless: ${resLossless ? '✓' : '✗'}  JSON match: ${resJsonMatch ? '✓' : '✗'}`);
    console.log();

    stats.push({
      turn: turnNum,
      label: `T${turnNum}-res`,
      rawBytes: rawResBytes,
      dotBytes: dotResBytes,
      ratio: rawResBytes / dotResBytes,
      verified: resVerified,
      lossless: resLossless,
    });

    if (!resVerified) allVerified = false;
    if (!resLossless) allLossless = false;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalRaw = stats.reduce((acc, s) => acc + s.rawBytes, 0);
  const totalDot = stats.reduce((acc, s) => acc + s.dotBytes, 0);
  const overallRatio = totalRaw / totalDot;

  console.log('='.repeat(58));
  console.log('SUMMARY');
  console.log(`  Total raw bytes:     ${lpad(fmt(totalRaw) + ' B', 12)}`);
  console.log(`  Total DOT bytes:     ${lpad(fmt(totalDot) + ' B', 12)}`);
  console.log(`  Overall compression: ${overallRatio.toFixed(2)}×`);
  console.log(`  All signatures:      ${allVerified ? '✓ verified' : '✗ FAILED'}`);
  console.log(`  Lossless invariant:  ${allLossless ? '✓ all payloads byte-identical after round-trip' : '✗ FAILED'}`);
  console.log();

  // Per-turn breakdown table
  console.log('  Per-turn breakdown:');
  console.log(`  ${'Label'.padEnd(10)} ${'Raw'.padStart(9)} ${'DOT'.padStart(9)} ${'Ratio'.padStart(8)}`);
  console.log(`  ${'-'.repeat(10)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(8)}`);
  for (const s of stats) {
    console.log(
      `  ${s.label.padEnd(10)} ${lpad(fmt(s.rawBytes) + ' B', 9)} ${lpad(fmt(s.dotBytes) + ' B', 9)} ${lpad((s.rawBytes / s.dotBytes).toFixed(2) + '×', 8)}`,
    );
  }
  console.log();

  const passed = allVerified && allLossless;
  console.log(`VERDICT: Phase 1 milestone ${passed ? 'PASSED' : 'FAILED'}`);

  if (!passed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
