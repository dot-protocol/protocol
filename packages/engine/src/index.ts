export { DOT } from './engine.js';

// v0.3.0 — Transform execution + condition evaluation
export {
  executeTransform,
  checkTimeCapsule,
  checkChainDepthGate,
  checkSignerApproval,
  evaluateCondition,
} from './transform-executor.js';
export type { TransformExecutionResult } from './transform-executor.js';
export { createRelay } from './relay.js';
export { collectEntropy, hashEntropy, deviceFingerprint } from './sensor.js';
export { ecdh, edToX25519Pub, edToX25519Priv, encryptPayload, decryptPayload } from './crypto.js';
export { createBatchCompressor } from './compress.js';
export { createWatchdog } from './watchdog.js';
export { createBLETransport } from './ble.js';
export type { EngineAPI, EngineOptions, EngineStats, PeerInfo } from './engine.js';
export type { RelayTransport, RelayOptions } from './relay.js';
export type { Datom, PhysicsStats } from './physics.js';
export type { Chain, DotEntry } from './chain.js';
export type { DotIdentity, FullIdentity } from './identity.js';
export type { CompressionStats, BatchCompressor } from './compress.js';
export type { EntropyOptions } from './sensor.js';
export type { HealthReport, HealthStatus, RelayHealth, ChainHealth, PredictorHealth, IdentityHealth, CompressionHealth } from './health.js';
export type { Watchdog, WatchdogConfig, WatchdogState } from './watchdog.js';
export type { BLEPeer, BLETransport } from './ble.js';
