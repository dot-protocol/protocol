// Mock engine — used when @dot-protocol/engine source isn't available yet.
// Mirrors the real engine API shape so the UI compiles and runs.

export interface PeerInfo {
  did: string;
  online: boolean;
  lastSeen: number;
}

export interface EngineStats {
  totalDots: number;
  totalRawBytes: number;
  compressionRatio: number;
  relayConnected: boolean;
  peersOnline: number;
}

export interface BootOptions {
  relayUrl?: string;
}

type EventCallback = (...args: unknown[]) => void;

class MockDOTEngine {
  me: { did: string; publicKey: Uint8Array } | null = null;
  private _handlers: Map<string, EventCallback[]> = new Map();
  private _dotCount = 0;
  private _totalBytes = 0;

  async boot(opts: BootOptions = {}): Promise<void> {
    // Generate a mock DID — in real engine this is Ed25519 keypair
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    this.me = {
      did: `dot:${hex}`,
      publicKey: new Uint8Array(32),
    };
    console.log('[DOT] Engine booted (mock)', this.me.did);
    console.log('[DOT] Relay:', opts.relayUrl ?? 'none');
  }

  async create(datom: { WHAT?: string; type?: number }): Promise<Uint8Array> {
    this._dotCount++;
    const text = datom.WHAT ?? '';
    const encoded = new TextEncoder().encode(text);
    this._totalBytes += encoded.length;

    // Produce 153-byte mock DOT
    const dot = new Uint8Array(153);
    // Fill payload region [137..152] with message bytes (max 16)
    const payload = encoded.slice(0, 16);
    dot.set(payload, 137);
    return dot;
  }

  on(event: string, cb: EventCallback): void {
    const list = this._handlers.get(event) ?? [];
    list.push(cb);
    this._handlers.set(event, list);
  }

  off(event: string, cb: EventCallback): void {
    const list = this._handlers.get(event) ?? [];
    this._handlers.set(event, list.filter(h => h !== cb));
  }

  stats(): EngineStats {
    return {
      totalDots: this._dotCount,
      totalRawBytes: this._totalBytes,
      compressionRatio: this._dotCount > 0 ? (this._dotCount * 153) / Math.max(this._totalBytes, 1) : 1,
      relayConnected: false,
      peersOnline: 0,
    };
  }

  health(): { status: 'healthy' | 'degraded' | 'critical' } {
    // Mock always returns healthy
    return { status: 'healthy' };
  }

  async shutdown(): Promise<void> {
    this._handlers.clear();
  }
}

export const DOT = new MockDOTEngine();
