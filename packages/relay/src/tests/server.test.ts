import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startRelayServer } from '../server.js';
import { ed25519 } from '@noble/curves/ed25519.js';

// Helper: connect and authenticate a client via Ed25519 signature
async function connectAndAuth(port: number, privateKey: Uint8Array): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      // Skip binary frames — they are relayed DOT frames, not protocol messages
      if (isBinary) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return; // ignore malformed
      }
      if (msg['type'] === 'challenge') {
        const nonce = Buffer.from(msg['nonce'] as string, 'hex');
        const pubKey = ed25519.getPublicKey(privateKey);
        const sig = ed25519.sign(nonce, privateKey);
        ws.send(JSON.stringify({
          type: 'auth',
          pubHex: Buffer.from(pubKey).toString('hex'),
          sig: Buffer.from(sig).toString('hex'),
        }));
      } else if (msg['type'] === 'authenticated') {
        resolve(ws);
      } else if (msg['type'] === 'error') {
        reject(new Error(`auth error: ${JSON.stringify(msg)}`));
      }
    });
    ws.on('error', reject);
  });
}

// Helper: wait for next JSON message from a websocket
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    ws.once('error', reject);
  });
}

// Helper: wait for next binary frame from a websocket
function nextBinary(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        ws.off('message', onMessage);
        resolve(data);
      }
    };
    ws.on('message', onMessage);
    ws.once('error', reject);
  });
}

describe('relay server', () => {
  let server: { close: () => void };
  const PORT = 9876;

  beforeEach(async () => {
    server = await startRelayServer(PORT);
    // Small delay to ensure server is fully listening
    await new Promise(r => setTimeout(r, 50));
  });

  afterEach(async () => {
    server.close();
    // Allow port to be released
    await new Promise(r => setTimeout(r, 50));
  });

  it('sends challenge on connect', async () => {
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      ws.once('message', (data: Buffer) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        ws.close();
      });
      ws.once('error', reject);
    });
    expect(msg['type']).toBe('challenge');
    expect(typeof msg['nonce']).toBe('string');
    // 32 bytes = 64 hex chars
    expect((msg['nonce'] as string).length).toBe(64);
  });

  it('authenticates with valid Ed25519 signature', async () => {
    const privKey = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, privKey);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('rejects invalid signature', async () => {
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      ws.once('message', () => {
        // Challenge received — send wrong sig
        ws.send(JSON.stringify({
          type: 'auth',
          pubHex: 'a'.repeat(64),
          sig: 'b'.repeat(128),
        }));
        ws.once('message', (d: Buffer) => {
          resolve(JSON.parse(d.toString()) as Record<string, unknown>);
          ws.close();
        });
      });
      ws.once('error', reject);
    });
    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('auth_failed');
  });

  it('rejects auth message with missing fields', async () => {
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      ws.once('message', () => {
        // Send auth missing sig field
        ws.send(JSON.stringify({ type: 'auth', pubHex: 'aa'.repeat(32) }));
        ws.once('message', (d: Buffer) => {
          resolve(JSON.parse(d.toString()) as Record<string, unknown>);
          ws.close();
        });
      });
      ws.once('error', reject);
    });
    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('auth_failed');
  });

  it('subscribe returns subscribed confirmation', async () => {
    const privKey = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, privKey);

    const msgPromise = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'subscribe', circleId: 'test-circle' }));
    const msg = await msgPromise;

    expect(msg['type']).toBe('subscribed');
    expect(msg['circleId']).toBe('test-circle');
    ws.close();
  });

  it('routes binary frames between subscribers in the same circle', async () => {
    const priv1 = ed25519.utils.randomSecretKey();
    const priv2 = ed25519.utils.randomSecretKey();
    const ws1 = await connectAndAuth(PORT, priv1);
    const ws2 = await connectAndAuth(PORT, priv2);

    const circleId = 'route-test';

    // Both subscribe
    await Promise.all([
      new Promise<void>(r => { ws1.once('message', () => r()); ws1.send(JSON.stringify({ type: 'subscribe', circleId })); }),
      new Promise<void>(r => { ws2.once('message', () => r()); ws2.send(JSON.stringify({ type: 'subscribe', circleId })); }),
    ]);

    // Build a valid 185-byte frame: 32B circleId + 153B payload
    const frame = Buffer.alloc(185);
    const cidBytes = Buffer.from(circleId.padEnd(32, '\0'), 'utf8');
    cidBytes.copy(frame, 0);
    frame[32] = 0xAB; // marker byte in payload

    const receivedPromise = nextBinary(ws2);
    // Small yield to ensure listener is registered before sending
    await new Promise(r => setTimeout(r, 10));
    ws1.send(frame);
    const received = await receivedPromise;

    expect(received.length).toBe(185);
    expect(received[32]).toBe(0xAB);
    ws1.close();
    ws2.close();
  });

  it('does not route frame back to sender', async () => {
    const priv = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, priv);

    await new Promise<void>(r => { ws.once('message', () => r()); ws.send(JSON.stringify({ type: 'subscribe', circleId: 'self-test' })); });

    const frame = Buffer.alloc(185);
    Buffer.from('self-test'.padEnd(32, '\0'), 'utf8').copy(frame, 0);
    ws.send(frame);

    // Should NOT receive it back — wait 200ms with no binary message
    const gotMessage = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 200);
      const onMsg = (_: Buffer, isBinary: boolean) => {
        if (isBinary) { clearTimeout(timer); ws.off('message', onMsg); resolve(true); }
      };
      ws.on('message', onMsg);
    });
    expect(gotMessage).toBe(false);
    ws.close();
  });

  it('rejects binary frame from unauthenticated client', async () => {
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      ws.once('message', () => {
        // Challenge received — skip auth, send binary immediately
        const frame = Buffer.alloc(185);
        ws.send(frame);
        ws.once('message', (d: Buffer) => {
          resolve(JSON.parse(d.toString()) as Record<string, unknown>);
          ws.close();
        });
      });
      ws.once('error', reject);
    });
    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('not_authenticated');
  });

  it('rejects binary frame with wrong size', async () => {
    const priv = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, priv);

    const msgPromise = nextMessage(ws);
    ws.send(Buffer.alloc(100)); // wrong size — not 185
    const msg = await msgPromise;

    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('invalid_frame_size');
    ws.close();
  });

  it('handles ping/pong', async () => {
    const priv = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, priv);

    const msgPromise = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await msgPromise;

    expect(msg['type']).toBe('pong');
    expect(typeof msg['ts']).toBe('number');
    expect(msg['ts'] as number).toBeGreaterThan(0);
    ws.close();
  });

  it('handles unsubscribe — removes client from circle', async () => {
    const priv1 = ed25519.utils.randomSecretKey();
    const priv2 = ed25519.utils.randomSecretKey();
    const ws1 = await connectAndAuth(PORT, priv1);
    const ws2 = await connectAndAuth(PORT, priv2);

    const circleId = 'unsub-test';

    // Both subscribe
    await Promise.all([
      new Promise<void>(r => { ws1.once('message', () => r()); ws1.send(JSON.stringify({ type: 'subscribe', circleId })); }),
      new Promise<void>(r => { ws2.once('message', () => r()); ws2.send(JSON.stringify({ type: 'subscribe', circleId })); }),
    ]);

    // ws2 unsubscribes
    ws2.send(JSON.stringify({ type: 'unsubscribe', circleId }));
    await new Promise(r => setTimeout(r, 100));

    // Send frame from ws1 — ws2 should NOT receive it
    const frame = Buffer.alloc(185);
    Buffer.from(circleId.padEnd(32, '\0'), 'utf8').copy(frame, 0);
    ws1.send(frame);

    const gotFrame = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 200);
      const onMsg = (_: Buffer, isBinary: boolean) => {
        if (isBinary) { clearTimeout(timer); ws2.off('message', onMsg); resolve(true); }
      };
      ws2.on('message', onMsg);
    });
    expect(gotFrame).toBe(false);

    ws1.close();
    ws2.close();
  });

  it('cleans up subscriptions on disconnect', async () => {
    const priv1 = ed25519.utils.randomSecretKey();
    const priv2 = ed25519.utils.randomSecretKey();
    const ws1 = await connectAndAuth(PORT, priv1);

    await new Promise<void>(r => { ws1.once('message', () => r()); ws1.send(JSON.stringify({ type: 'subscribe', circleId: 'cleanup-test' })); });

    // ws1 disconnects
    ws1.close();
    await new Promise(r => setTimeout(r, 150));

    // Server should still work — new client can connect and authenticate
    const ws2 = await connectAndAuth(PORT, priv2);
    expect(ws2.readyState).toBe(WebSocket.OPEN);
    ws2.close();
  });

  it('ignores malformed JSON messages', async () => {
    const priv = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, priv);

    // Send garbage JSON — server should not crash
    ws.send('this is not json {{{{');
    await new Promise(r => setTimeout(r, 100));

    // Server still responds to ping after malformed message
    const msgPromise = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await msgPromise;
    expect(msg['type']).toBe('pong');
    ws.close();
  });

  it('ignores frame with empty circleId after null strip', async () => {
    const priv = ed25519.utils.randomSecretKey();
    const ws = await connectAndAuth(PORT, priv);

    // Frame with all-zero circleId field (strips to empty string)
    const frame = Buffer.alloc(185, 0);
    ws.send(frame);
    await new Promise(r => setTimeout(r, 100));

    // Should not crash — server still responds to ping
    const msgPromise = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await msgPromise;
    expect(msg['type']).toBe('pong');
    ws.close();
  });

  it('multiple subscribers all receive broadcast frame', async () => {
    const priv1 = ed25519.utils.randomSecretKey();
    const priv2 = ed25519.utils.randomSecretKey();
    const priv3 = ed25519.utils.randomSecretKey();
    const ws1 = await connectAndAuth(PORT, priv1);
    const ws2 = await connectAndAuth(PORT, priv2);
    const ws3 = await connectAndAuth(PORT, priv3);

    const circleId = 'multi-test';
    await Promise.all([
      new Promise<void>(r => { ws1.once('message', () => r()); ws1.send(JSON.stringify({ type: 'subscribe', circleId })); }),
      new Promise<void>(r => { ws2.once('message', () => r()); ws2.send(JSON.stringify({ type: 'subscribe', circleId })); }),
      new Promise<void>(r => { ws3.once('message', () => r()); ws3.send(JSON.stringify({ type: 'subscribe', circleId })); }),
    ]);

    const frame = Buffer.alloc(185);
    Buffer.from(circleId.padEnd(32, '\0'), 'utf8').copy(frame, 0);
    frame[33] = 0xFF; // payload marker

    // Set up listeners first, then send
    const got2Promise = nextBinary(ws2);
    const got3Promise = nextBinary(ws3);
    ws1.send(frame);
    const got2 = await got2Promise;
    const got3 = await got3Promise;

    expect(got2[33]).toBe(0xFF);
    expect(got3[33]).toBe(0xFF);
    ws1.close();
    ws2.close();
    ws3.close();
  });

  it('subscribe is ignored if not authenticated', async () => {
    // Connect but don't auth — send subscribe directly
    const gotResponse = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      ws.once('message', () => {
        // Challenge received — skip auth, send subscribe
        ws.send(JSON.stringify({ type: 'subscribe', circleId: 'no-auth-circle' }));
        // Wait briefly for any response
        const timer = setTimeout(() => { resolve(false); ws.close(); }, 200);
        ws.once('message', (d: Buffer) => {
          clearTimeout(timer);
          const msg = JSON.parse(d.toString()) as Record<string, unknown>;
          // Only an error or no response expected — NOT 'subscribed'
          resolve(msg['type'] === 'subscribed');
          ws.close();
        });
      });
      ws.once('error', reject);
    });
    // Unauthenticated subscribe should be silently ignored (no 'subscribed' response)
    expect(gotResponse).toBe(false);
  });
});
