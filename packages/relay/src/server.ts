// server.ts — Node.js CHORUS relay server (SDK entry point)
// Browser-incompatible (uses ws package + Buffer). Import via '@dot-protocol/relay/server'.

export { packFrame, unpackFrame, FRAME_SIZE, DOT_SIZE, CIRCLE_ID_SIZE } from './types.js';

const SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Start a CHORUS relay server.
 * Protocol: challenge-auth → subscribe → binary frame routing.
 * @param port Default 8765
 */
export async function startRelayServer(port = 8765): Promise<{ close: () => void }> {
  const { WebSocketServer } = await import('ws') as typeof import('ws');
  const wss = new WebSocketServer({ port });
  console.log(`[dot/relay] listening on ws://0.0.0.0:${port}`);

  type WS = import('ws').WebSocket;
  const connections = new Map<WS, { nonce: string; pubHex: string | null; circles: Set<string> }>();
  const circles = new Map<string, Set<WS>>();

  wss.on('connection', (ws: WS) => {
    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    connections.set(ws, { nonce, pubHex: null, circles: new Set() });
    ws.send(JSON.stringify({ type: 'challenge', nonce }));

    ws.on('message', async (data: Buffer | ArrayBuffer, isBinary: boolean) => {
      const conn = connections.get(ws);
      if (!conn) return;

      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (msg['type'] === 'auth' && !conn.pubHex) {
            if (typeof msg['pubHex'] !== 'string' || typeof msg['sig'] !== 'string') {
              ws.send(JSON.stringify({ type: 'error', code: 'auth_failed' }));
              return;
            }
            const nonceBytes = Buffer.from(conn.nonce, 'hex');
            const pubKeyBytes = Buffer.from(msg['pubHex'], 'hex');
            const spki = new Uint8Array(SPKI_PREFIX.length + 32);
            spki.set(SPKI_PREFIX);
            spki.set(pubKeyBytes, SPKI_PREFIX.length);
            const pubKey = await crypto.subtle.importKey('spki', spki.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
            const sig = Buffer.from(msg['sig'], 'hex');
            const valid = await crypto.subtle.verify('Ed25519', pubKey, sig, nonceBytes);
            if (!valid) { ws.send(JSON.stringify({ type: 'error', code: 'auth_failed' })); return; }
            conn.pubHex = msg['pubHex'];
            ws.send(JSON.stringify({ type: 'authenticated', pubHex: conn.pubHex }));
          } else if (msg['type'] === 'subscribe' && conn.pubHex) {
            const circleId = msg['circleId'] as string;
            if (!circles.has(circleId)) circles.set(circleId, new Set());
            circles.get(circleId)!.add(ws);
            conn.circles.add(circleId);
            ws.send(JSON.stringify({ type: 'subscribed', circleId }));
          } else if (msg['type'] === 'unsubscribe' && conn.pubHex) {
            const circleId = msg['circleId'] as string;
            circles.get(circleId)?.delete(ws);
            conn.circles.delete(circleId);
            // Clean up empty circle sets
            if (circles.get(circleId)?.size === 0) circles.delete(circleId);
          } else if (msg['type'] === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        } catch { /* ignore malformed */ }
        return;
      }

      // Binary frame
      if (!conn.pubHex) { ws.send(JSON.stringify({ type: 'error', code: 'not_authenticated' })); ws.close(); return; }
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (frame.length !== 185) { ws.send(JSON.stringify({ type: 'error', code: 'invalid_frame_size' })); return; }
      const circleId = frame.slice(0, 32).toString('utf8').replace(/\0/g, '');
      if (!circleId) return;
      const subs = circles.get(circleId);
      if (subs) {
        for (const sub of subs) {
          if (sub !== ws && sub.readyState === 1) sub.send(frame);
        }
      }
    });

    ws.on('close', () => {
      const conn = connections.get(ws);
      if (conn) {
        for (const cid of conn.circles) {
          circles.get(cid)?.delete(ws);
          if (circles.get(cid)?.size === 0) circles.delete(cid);
        }
      }
      connections.delete(ws);
    });
  });

  return { close: () => wss.close() };
}
