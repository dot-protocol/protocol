/**
 * @dotprotocol/transport — receive()
 *
 * Receive DOTs from any transport. Auto-verified by default.
 */

import { verifyDOT, fromBytes, DOT_SIZE } from '@dotprotocol/core';
import type { ReceivedDOT, ReceiveOptions, TransportAdapter } from './types.js';

/** Register a handler for incoming DOTs on the given adapter */
export function receive(
  adapter: TransportAdapter,
  handler: (received: ReceivedDOT) => void,
  opts?: ReceiveOptions,
): () => void {
  const autoVerify = opts?.autoVerify ?? true;
  const filterKey = opts?.filterKey;

  return adapter.onReceive(async (bytes, _source) => {
    // Size check
    if (bytes.length !== DOT_SIZE) return;

    try {
      const dot = fromBytes(bytes);

      // Filter by sender key
      if (filterKey && !dot.pubkey.every((b, i) => b === filterKey[i])) {
        return;
      }

      // Verify signature
      let verified = false;
      if (autoVerify) {
        verified = await verifyDOT(dot);
        if (!verified) return; // Drop unverified DOTs
      }

      handler({
        dot,
        bytes: new Uint8Array(bytes),
        transport: adapter.type,
        receivedAt: Date.now(),
        verified,
      });
    } catch {
      // Malformed DOT — drop silently
    }
  });
}
