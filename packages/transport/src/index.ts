/**
 * @dotprotocol/transport — DOT Transport Protocol (DTP)
 *
 * No handshake. No session. No TLS. DOTs as message unit.
 * Any transport underneath: memory, WebSocket, libp2p, Bluetooth, NFC, QR.
 *
 * Architecture:
 * - send(): Fire a DOT over any adapter
 * - receive(): Listen for incoming DOTs (auto-verified)
 * - relay(): Stateless relay — dumb pipe, passes 153 bytes
 * - Offline queue: DOTs queue locally, sync on reconnect
 */

export { send } from './send.js';
export { receive } from './receive.js';
export { Relay } from './relay.js';
export { OfflineQueue } from './queue.js';
export { MemoryAdapter, MemoryBus, defaultBus } from './memory-adapter.js';

export type {
  TransportType,
  TransportState,
  TransportAdapter,
  ReceivedDOT,
  SendOptions,
  ReceiveOptions,
  RelayOptions,
  RelayStats,
  QueuedDOT,
} from './types.js';
