/**
 * @dotprotocol/transport — send()
 *
 * Send a DOT over any transport. No handshake. No session. No TLS.
 */

import { toBytes, DOT_SIZE } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import type { SignedDOT } from '@dotprotocol/sign';
import type { SendOptions, TransportAdapter } from './types.js';
import { OfflineQueue } from './queue.js';

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Resolve input to 153-byte wire format */
function resolveBytes(input: SignedDOT | DOT | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    if (input.length !== DOT_SIZE) {
      throw new Error(`DOT must be ${DOT_SIZE} bytes, got ${input.length}`);
    }
    return input;
  }
  if ('bytes' in input && 'dot' in input) {
    return (input as SignedDOT).bytes;
  }
  return toBytes(input as DOT);
}

/** Resolve destination address from options */
function resolveDestination(opts?: SendOptions): string {
  if (opts?.channel) return opts.channel;
  if (opts?.recipientKey) return bytesToHex(opts.recipientKey);
  return 'broadcast';
}

/** Send a DOT over the specified transport */
export async function send(
  input: SignedDOT | DOT | Uint8Array,
  adapter: TransportAdapter,
  opts?: SendOptions,
  queue?: OfflineQueue,
): Promise<boolean> {
  const bytes = resolveBytes(input);
  const destination = resolveDestination(opts);

  if (adapter.state !== 'connected') {
    if (queue) {
      queue.enqueue(bytes, destination, opts?.channel);
      return false;
    }
    throw new Error(`Transport not connected (state: ${adapter.state})`);
  }

  try {
    await adapter.send(bytes, destination);
    return true;
  } catch (err) {
    if (queue) {
      queue.enqueue(bytes, destination, opts?.channel);
      return false;
    }
    throw err;
  }
}
