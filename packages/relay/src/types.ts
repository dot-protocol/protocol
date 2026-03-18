// CHORUS relay protocol types
// Frame format: 32B circleId (UTF-8, null-padded) + 153B DOT = 185 bytes total

export const CIRCLE_ID_SIZE = 32 as const;
export const DOT_SIZE = 153 as const;
export const FRAME_SIZE = 185 as const;

export interface RelayConfig {
  url: string;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  pingIntervalMs?: number;
}

export type RelayStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export interface IncomingFrame {
  circleId: string;
  dotBytes: Uint8Array;
}

export type RelayMessage =
  | { type: 'challenge'; nonce: string }
  | { type: 'authenticated'; pubHex: string }
  | { type: 'subscribed'; circleId: string }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; reason?: string };

/** Encode circleId to 32-byte null-padded buffer */
export function encodeCircleId(circleId: string): Uint8Array {
  const buf = new Uint8Array(CIRCLE_ID_SIZE);
  const encoded = new TextEncoder().encode(circleId.slice(0, CIRCLE_ID_SIZE));
  buf.set(encoded);
  return buf;
}

/** Decode circleId from 32-byte buffer (strip null padding) */
export function decodeCircleId(bytes: Uint8Array): string {
  const nullIdx = bytes.indexOf(0);
  return new TextDecoder().decode(nullIdx === -1 ? bytes : bytes.slice(0, nullIdx));
}

/** Pack a 185-byte relay frame from circleId + 153-byte DOT bytes */
export function packFrame(circleId: string, dotBytes: Uint8Array): Uint8Array {
  if (dotBytes.length !== DOT_SIZE) {
    throw new Error(`DOT must be ${DOT_SIZE} bytes, got ${dotBytes.length}`);
  }
  const frame = new Uint8Array(FRAME_SIZE);
  frame.set(encodeCircleId(circleId), 0);
  frame.set(dotBytes, CIRCLE_ID_SIZE);
  return frame;
}

/** Unpack a 185-byte relay frame into circleId + dotBytes */
export function unpackFrame(frame: Uint8Array): { circleId: string; dotBytes: Uint8Array } {
  if (frame.length !== FRAME_SIZE) {
    throw new Error(`Frame must be ${FRAME_SIZE} bytes, got ${frame.length}`);
  }
  return {
    circleId: decodeCircleId(frame.slice(0, CIRCLE_ID_SIZE)),
    dotBytes: frame.slice(CIRCLE_ID_SIZE),
  };
}
