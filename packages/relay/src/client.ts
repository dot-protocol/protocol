/// <reference lib="dom" />
// client.ts — CHORUS relay client (browser + Node compatible)

import { packFrame, unpackFrame, FRAME_SIZE, type RelayConfig, type RelayStatus } from './types.js';
import type { Keypair } from '@dot-protocol/core';

const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(h: string): Uint8Array {
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  }
  return bytes;
}

async function signNonce(privateKey: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(privateKey, PKCS8_PREFIX.length);
  const privKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('Ed25519', privKey, nonce.buffer as ArrayBuffer));
}

export type FrameHandler = (circleId: string, dotBytes: Uint8Array) => void;
export type StatusHandler = (status: RelayStatus) => void;

export class RelayClient {
  private ws: WebSocket | null = null;
  private status: RelayStatus = 'disconnected';
  private keypair: Keypair | null = null;
  private subscribedCircles = new Set<string>();
  private frameHandlers: FrameHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private config: Required<RelayConfig>;

  constructor(config: RelayConfig) {
    this.config = {
      reconnect: true,
      reconnectDelayMs: 3000,
      pingIntervalMs: 20_000,
      ...config,
    };
  }

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.push(handler);
    return () => { this.frameHandlers = this.frameHandlers.filter(h => h !== handler); };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => { this.statusHandlers = this.statusHandlers.filter(h => h !== handler); };
  }

  connect(keypair: Keypair): void {
    this.keypair = keypair;
    this._setStatus('connecting');
    this._open();
  }

  disconnect(): void {
    this.config.reconnect = false;
    this.ws?.close();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this._setStatus('disconnected');
  }

  subscribe(circleId: string): void {
    this.subscribedCircles.add(circleId);
    if (this.status === 'connected' && this.ws) {
      this.ws.send(JSON.stringify({ type: 'subscribe', circleId }));
    }
  }

  unsubscribe(circleId: string): void {
    this.subscribedCircles.delete(circleId);
  }

  sendFrame(circleId: string, dotBytes: Uint8Array): boolean {
    if (this.status !== 'connected' || !this.ws) return false;
    const frame = packFrame(circleId, dotBytes);
    this.ws.send(frame.buffer as ArrayBuffer);
    return true;
  }

  getStatus(): RelayStatus { return this.status; }

  private _setStatus(s: RelayStatus): void {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  private _open(): void {
    const ws = new WebSocket(this.config.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => this._setStatus('authenticating');

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = new Uint8Array(event.data);
        if (frame.length !== FRAME_SIZE) return;
        const { circleId, dotBytes } = unpackFrame(frame);
        for (const h of this.frameHandlers) h(circleId, dotBytes);
        return;
      }
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg['type'] === 'challenge' && typeof msg['nonce'] === 'string') {
          const nonce = hexToBytes(msg['nonce']);
          const sig = await signNonce(this.keypair!.privateKey, nonce);
          ws.send(JSON.stringify({
            type: 'auth',
            pubHex: bytesToHex(this.keypair!.publicKey),
            sig: bytesToHex(sig),
          }));
        } else if (msg['type'] === 'authenticated') {
          this._setStatus('connected');
          for (const circleId of this.subscribedCircles) {
            ws.send(JSON.stringify({ type: 'subscribe', circleId }));
          }
          this.pingTimer = setInterval(() => {
            if (ws.readyState === 1 /* WebSocket.OPEN */) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, this.config.pingIntervalMs);
        }
      } catch { /* malformed message */ }
    };

    ws.onerror = () => this._setStatus('disconnected');

    ws.onclose = () => {
      this._setStatus('disconnected');
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.config.reconnect && this.keypair) {
        setTimeout(() => this._open(), this.config.reconnectDelayMs);
      }
    };
  }
}
