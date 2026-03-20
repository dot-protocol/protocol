// @dotprotocol/wrapper — bridge()
// TCP proxy that translates DOT chains <-> HTTP requests.
// Node.js only (net, fetch — not browser).

import * as net from 'node:net';
import { wrap, unwrap } from './index.js';
import { createSession } from './session.js';
import type { WrapSession, BridgeOptions, BridgeHandle } from './types.js';

// ─── Wire protocol helpers ─────────────────────────────────────────────────────

/**
 * Serialize an HTTP request into the DOT payload bytes format:
 * [method_len (1B)][method][url_len (2B uint16 BE)][url][headers_len (2B uint16 BE)][headers JSON][body_len (4B uint32 BE)][body]
 */
function serializeRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const methodBytes = enc.encode(method);
  const urlBytes = enc.encode(url);
  const headersBytes = enc.encode(JSON.stringify(headers));

  const totalLen =
    1 + methodBytes.length +
    2 + urlBytes.length +
    2 + headersBytes.length +
    4 + body.length;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let offset = 0;

  // method_len (1B)
  buf[offset++] = methodBytes.length;
  // method
  buf.set(methodBytes, offset); offset += methodBytes.length;
  // url_len (2B BE)
  view.setUint16(offset, urlBytes.length, false); offset += 2;
  // url
  buf.set(urlBytes, offset); offset += urlBytes.length;
  // headers_len (2B BE)
  view.setUint16(offset, headersBytes.length, false); offset += 2;
  // headers JSON
  buf.set(headersBytes, offset); offset += headersBytes.length;
  // body_len (4B BE)
  view.setUint32(offset, body.length, false); offset += 4;
  // body
  buf.set(body, offset);

  return buf;
}

/**
 * Deserialize the HTTP request bytes (see serializeRequest for layout).
 */
function deserializeRequest(data: Uint8Array): {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
} {
  const dec = new TextDecoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const methodLen = data[offset++]!;
  const method = dec.decode(data.subarray(offset, offset + methodLen)); offset += methodLen;

  const urlLen = view.getUint16(offset, false); offset += 2;
  const url = dec.decode(data.subarray(offset, offset + urlLen)); offset += urlLen;

  const headersLen = view.getUint16(offset, false); offset += 2;
  const headersJson = dec.decode(data.subarray(offset, offset + headersLen)); offset += headersLen;
  const headers: Record<string, string> = JSON.parse(headersJson);

  const bodyLen = view.getUint32(offset, false); offset += 4;
  const body = data.subarray(offset, offset + bodyLen);

  return { method, url, headers, body };
}

/**
 * Serialize an HTTP response into bytes:
 * [status (2B uint16 BE)][headers_len (2B uint16 BE)][headers JSON][body_len (4B uint32 BE)][body]
 */
function serializeResponse(
  status: number,
  headers: Record<string, string>,
  body: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const headersBytes = enc.encode(JSON.stringify(headers));

  const totalLen = 2 + 2 + headersBytes.length + 4 + body.length;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let offset = 0;

  view.setUint16(offset, status, false); offset += 2;
  view.setUint16(offset, headersBytes.length, false); offset += 2;
  buf.set(headersBytes, offset); offset += headersBytes.length;
  view.setUint32(offset, body.length, false); offset += 4;
  buf.set(body, offset);

  return buf;
}

/**
 * Deserialize the HTTP response bytes (see serializeResponse for layout).
 */
function deserializeResponse(data: Uint8Array): {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
} {
  const dec = new TextDecoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const status = view.getUint16(offset, false); offset += 2;

  const headersLen = view.getUint16(offset, false); offset += 2;
  const headersJson = dec.decode(data.subarray(offset, offset + headersLen)); offset += headersLen;
  const headers: Record<string, string> = JSON.parse(headersJson);

  const bodyLen = view.getUint32(offset, false); offset += 4;
  const body = data.subarray(offset, offset + bodyLen);

  return { status, headers, body };
}

// ─── Frame I/O ────────────────────────────────────────────────────────────────

/**
 * Read a single length-prefixed DOT frame from a socket.
 * Wire: [uint32_BE frame_len][frame bytes]
 *
 * Accumulates all data until we have 4 (length header) + frame_len bytes,
 * then resolves. Handles the case where all data arrives in one chunk
 * (common on loopback).
 */
function readFrame(socket: net.Socket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let accumulated = Buffer.alloc(0);

    const tryParse = () => {
      // Need at least 4 bytes for the length prefix
      if (accumulated.length < 4) return;
      const frameLen = accumulated.readUInt32BE(0);
      // Need 4 + frameLen bytes total
      if (accumulated.length < 4 + frameLen) return;

      // Got a complete frame — resolve and clean up
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);

      resolve(new Uint8Array(accumulated.subarray(4, 4 + frameLen)));
    };

    const onData = (chunk: Buffer) => {
      accumulated = Buffer.concat([accumulated, chunk]);
      tryParse();
    };

    const onError = (err: Error) => {
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
      reject(err);
    };

    const onClose = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      reject(new Error('socket closed before read complete'));
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

/**
 * Write a length-prefixed DOT frame to a socket.
 */
function writeFrame(socket: net.Socket, frame: Uint8Array): void {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(frame.length, 0);
  socket.write(lenBuf);
  socket.write(frame);
}

// ─── bridge() ─────────────────────────────────────────────────────────────────

/**
 * Start a DOT bridge server that translates DOT chains <-> HTTP.
 *
 * The bridge listens for incoming TCP connections. Each connection:
 * 1. Reads a length-prefixed DOT frame
 * 2. Unwraps it to get the HTTP request payload
 * 3. Makes the actual HTTP request (if `forward` is set), or echoes (test mode)
 * 4. Wraps the response as a DOT chain
 * 5. Sends back the length-prefixed DOT frame
 *
 * @example
 * const bridge = await dot.bridge({
 *   port: 8100,
 *   forward: 'https://api.example.com',
 * });
 * bridge.close();
 *
 * @example
 * // Echo mode — wraps/unwraps without HTTP forwarding (for testing)
 * const bridge = await dot.bridge({ port: 8100 });
 */
export async function bridge(options?: BridgeOptions): Promise<BridgeHandle> {
  const port = options?.port ?? 8100;
  const host = options?.host ?? '127.0.0.1';
  const forward = options?.forward;
  const maxBodySize = options?.maxBodySize ?? 10 * 1024 * 1024; // 10MB
  const blsPublicKey = options?.blsPublicKey;

  // Session for wrapping responses — create fresh if not provided
  const session: WrapSession = options?.session ?? await createSession();

  let requestCount = 0;

  const server = net.createServer((socket) => {
    socket.on('error', () => {
      // Ignore per-connection errors (client disconnects, etc.)
    });

    (async () => {
      try {
        // 1. Read incoming DOT frame
        const inFrame = await readFrame(socket);

        // 2. Unwrap DOT chain → raw HTTP request bytes
        const unwrapped = await unwrap(inFrame, blsPublicKey ? { blsPublicKey } : undefined);
        const reqBytes = unwrapped.data;

        let responseBytes: Uint8Array;

        if (forward) {
          // 3. Deserialize the HTTP request
          const { method, url, headers, body } = deserializeRequest(reqBytes);

          // Build the full URL (base + path)
          const targetUrl = forward.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);

          // Guard body size
          if (body.length > maxBodySize) {
            throw new Error(`bridge: request body too large (${body.length} > ${maxBodySize})`);
          }

          // 4. Make the actual HTTP request
          const fetchResponse = await fetch(targetUrl, {
            method,
            headers,
            body: body.length > 0 ? body : undefined,
          });

          // Read response body
          const respBodyBuffer = await fetchResponse.arrayBuffer();
          const respBody = new Uint8Array(respBodyBuffer);

          // Collect response headers
          const respHeaders: Record<string, string> = {};
          fetchResponse.headers.forEach((value, key) => {
            respHeaders[key] = value;
          });

          // 5. Serialize the HTTP response
          responseBytes = serializeResponse(fetchResponse.status, respHeaders, respBody);
        } else {
          // Echo mode: return the request bytes as-is (for testing)
          responseBytes = reqBytes;
        }

        // 6. Wrap response as DOT chain
        const wrapped = await wrap(responseBytes, { session, protocol: 'raw' });

        // 7. Send back length-prefixed DOT frame
        writeFrame(socket, wrapped.frame);

        requestCount++;
      } catch (_err) {
        // On any error, close the socket cleanly
      } finally {
        socket.end();
      }
    })();
  });

  // Start listening
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const actualPort = (server.address() as net.AddressInfo).port;

  return {
    get port() { return actualPort; },
    get requestCount() { return requestCount; },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

// ─── bridgeFetch() ────────────────────────────────────────────────────────────

/**
 * Send an HTTP request via a DOT bridge.
 * Wraps the request as a DOT chain, sends to bridge over TCP, unwraps response.
 *
 * @example
 * const bridge = await startBridge({ port: 8100, forward: 'https://api.example.com' });
 * const response = await bridgeFetch(bridge.port, {
 *   method: 'GET',
 *   url: '/v1/messages',
 * });
 */
export async function bridgeFetch(
  port: number,
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
    host?: string;
  },
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}> {
  const method = request.method.toUpperCase();
  const url = request.url;
  const headers = request.headers ?? {};
  const body = request.body ?? new Uint8Array(0);

  // Serialize the HTTP request into bytes
  const reqBytes = serializeRequest(method, url, headers, body);

  // Wrap as DOT chain
  const wrapped = await wrap(reqBytes, { protocol: 'raw' });

  // Connect to bridge and send
  const response = await new Promise<Uint8Array>((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      writeFrame(socket, wrapped.frame);
    });

    socket.on('error', reject);

    readFrame(socket).then(resolve, reject);
  });

  // Unwrap response DOT chain
  const unwrapped = await unwrap(response);

  // Deserialize HTTP response
  const { status, headers: respHeaders, body: respBody } = deserializeResponse(unwrapped.data);

  return { status, headers: respHeaders, body: respBody };
}

