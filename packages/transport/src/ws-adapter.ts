/**
 * @dotprotocol/transport — WebSocket transport adapter
 *
 * Production adapter for DOT transport over WebSocket.
 * Sends and receives raw 153-byte binary frames.
 * No handshake beyond WebSocket upgrade. No TLS negotiation (use wss:// URL).
 */

import { DOT_SIZE } from '@dotprotocol/core';
import type { TransportAdapter, TransportState, TransportType } from './types.js';

type ReceiveHandler = (bytes: Uint8Array, source: string) => void;

export interface WebSocketAdapterOptions {
  /** WebSocket server URL (e.g. "wss://dotdotdot.rocks") */
  url: string;
  /** Reconnect on close/error (default: true) */
  reconnect?: boolean;
  /** Max reconnect attempts (default: 10, 0 = infinite) */
  maxReconnectAttempts?: number;
  /** Base reconnect delay in ms (default: 1000, exponential backoff applied) */
  reconnectDelay?: number;
  /** Optional identifier for this peer (sent as subprotocol) */
  peerId?: string;
}

export class WebSocketAdapter implements TransportAdapter {
  readonly type: TransportType = 'websocket';
  private _state: TransportState = 'disconnected';
  private ws: WebSocket | null = null;
  private handlers: ReceiveHandler[] = [];
  private opts: Required<WebSocketAdapterOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(opts: WebSocketAdapterOptions) {
    this.opts = {
      url: opts.url,
      reconnect: opts.reconnect ?? true,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 10,
      reconnectDelay: opts.reconnectDelay ?? 1000,
      peerId: opts.peerId ?? '',
    };
  }

  get state(): TransportState {
    return this._state;
  }

  async send(bytes: Uint8Array, _destination: string): Promise<void> {
    if (this._state !== 'connected' || !this.ws) {
      throw new Error('WebSocket not connected');
    }
    if (bytes.length !== DOT_SIZE) {
      throw new Error(`DOT must be ${DOT_SIZE} bytes, got ${bytes.length}`);
    }
    this.ws.send(bytes);
  }

  onReceive(handler: ReceiveHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return;

    this.intentionalClose = false;
    this._state = 'connecting';

    return new Promise<void>((resolve, reject) => {
      try {
        const protocols = this.opts.peerId ? [this.opts.peerId] : undefined;
        this.ws = new WebSocket(this.opts.url, protocols);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this._state = 'connected';
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          const data = event.data;
          let bytes: Uint8Array;

          if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
          } else if (data instanceof Uint8Array) {
            bytes = data;
          } else {
            return; // Ignore text frames
          }

          if (bytes.length !== DOT_SIZE) return; // Only 153-byte DOTs

          const source = this.opts.url;
          for (const handler of this.handlers) {
            handler(bytes, source);
          }
        };

        this.ws.onclose = () => {
          this._state = 'disconnected';
          this.ws = null;
          if (!this.intentionalClose && this.opts.reconnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = () => {
          if (this._state === 'connecting') {
            this._state = 'error';
            reject(new Error(`WebSocket connection failed: ${this.opts.url}`));
          } else {
            this._state = 'error';
          }
        };
      } catch (err) {
        this._state = 'error';
        reject(err);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this._state = 'disconnected';
  }

  private scheduleReconnect(): void {
    if (this.opts.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
      this._state = 'error';
      return;
    }

    const delay = this.opts.reconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts, 6));
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect failed — onclose will trigger another attempt
      });
    }, delay);
  }
}
