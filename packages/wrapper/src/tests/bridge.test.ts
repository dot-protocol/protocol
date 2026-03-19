import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import { bridge, bridgeFetch } from '../index.js';
import type { BridgeHandle } from '../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startEchoServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = Buffer.alloc(0);
      req.on('data', (chunk: Buffer) => { body = Buffer.concat([body, chunk]); });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, path: req.url, body: body.toString() }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bridge — lifecycle', () => {
  let handle: BridgeHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it('starts and stops cleanly', async () => {
    handle = await bridge({ port: 0 });
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.requestCount).toBe(0);
    await handle.close();
    handle = null;
  });

  it('port 0 gets an auto-assigned port', async () => {
    handle = await bridge({ port: 0 });
    expect(handle.port).toBeGreaterThan(1024);
  });
});

describe('bridge — echo mode (no forward)', () => {
  let handle: BridgeHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it('wraps/unwraps a round-trip without HTTP forwarding', async () => {
    handle = await bridge({ port: 0 });

    // In echo mode the bridge returns the unwrapped request bytes as-is.
    // bridgeFetch serializes a request then deserializes what comes back.
    // Since there's no forward target, the bridge echoes the serialized
    // request bytes directly — which won't parse as a response.
    // Instead, test the TCP layer directly: send a DOT chain, get it back.
    const { wrap, unwrap, createSession } = await import('../index.js');

    const session = await createSession();
    const payload = new TextEncoder().encode('echo test payload');
    const wrapped = await wrap(payload, { session, protocol: 'raw' });

    // Send the DOT frame to the bridge over a raw TCP socket
    const response = await new Promise<Uint8Array>((resolve, reject) => {
      const socket = net.createConnection({ port: handle!.port, host: '127.0.0.1' }, () => {
        // Write length-prefixed frame
        const lenBuf = Buffer.allocUnsafe(4);
        lenBuf.writeUInt32BE(wrapped.frame.length, 0);
        socket.write(lenBuf);
        socket.write(wrapped.frame);
      });

      socket.on('error', reject);

      // Read length-prefixed response frame
      let received = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 4) {
          const frameLen = received.readUInt32BE(0);
          if (received.length >= 4 + frameLen) {
            resolve(new Uint8Array(received.subarray(4, 4 + frameLen)));
          }
        }
      });
    });

    // Unwrap the response — it should contain the original payload (echo mode)
    const result = await unwrap(response);
    expect(result.data).toEqual(payload);
  });
});

describe('bridge — HTTP forwarding', () => {
  let bridgeHandle: BridgeHandle | null = null;
  let echoServer: http.Server | null = null;

  afterEach(async () => {
    if (bridgeHandle) {
      await bridgeHandle.close();
      bridgeHandle = null;
    }
    if (echoServer) {
      await closeServer(echoServer);
      echoServer = null;
    }
  });

  it('forwards a GET request and returns the response', async () => {
    const { server, url } = await startEchoServer();
    echoServer = server;

    bridgeHandle = await bridge({ port: 0, forward: url });

    const resp = await bridgeFetch(bridgeHandle.port, {
      method: 'GET',
      url: '/hello',
    });

    expect(resp.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(resp.body));
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/hello');
  });

  it('forwards a POST request with a body', async () => {
    const { server, url } = await startEchoServer();
    echoServer = server;

    bridgeHandle = await bridge({ port: 0, forward: url });

    const reqBody = new TextEncoder().encode('{"key":"value"}');
    const resp = await bridgeFetch(bridgeHandle.port, {
      method: 'POST',
      url: '/api/data',
      headers: { 'content-type': 'application/json' },
      body: reqBody,
    });

    expect(resp.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(resp.body));
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/api/data');
    expect(body.body).toBe('{"key":"value"}');
  });
});

describe('bridge — large payload', () => {
  let bridgeHandle: BridgeHandle | null = null;
  let echoServer: http.Server | null = null;

  afterEach(async () => {
    if (bridgeHandle) {
      await bridgeHandle.close();
      bridgeHandle = null;
    }
    if (echoServer) {
      await closeServer(echoServer);
      echoServer = null;
    }
  });

  it('handles a 5KB request body round-trip', async () => {
    const { server, url } = await startEchoServer();
    echoServer = server;

    bridgeHandle = await bridge({ port: 0, forward: url });

    // 5KB of repeating ASCII data
    const fiveKb = new Uint8Array(5120);
    for (let i = 0; i < fiveKb.length; i++) fiveKb[i] = 65 + (i % 26); // A-Z repeating

    const resp = await bridgeFetch(bridgeHandle.port, {
      method: 'POST',
      url: '/large',
      headers: { 'content-type': 'application/octet-stream' },
      body: fiveKb,
    });

    expect(resp.status).toBe(200);
    const parsed = JSON.parse(new TextDecoder().decode(resp.body));
    // The echo server returns the body as a string
    expect(parsed.body.length).toBe(5120);
  }, 15000);
});
