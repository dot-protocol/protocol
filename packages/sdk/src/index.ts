/**
 * @dot-protocol/sdk
 *
 * Umbrella package re-exporting all @dot-protocol/* packages.
 * Install this for the full DOT Protocol developer experience.
 *
 * @example
 * import { createDOT, wrap, dotId, serializeBatchV2 } from '@dot-protocol/sdk';
 */

// ── Core — DOT creation, signing, verification, BLS ─────────────────────────
export * from '@dot-protocol/core';

// ── Compression — batch v2, zstd, rANS, predictor, Weissman ─────────────────
export * from '@dot-protocol/compression';

// ── Identity — keypair + genesis DOT + export/import ────────────────────────
// (createIdentity, exportIdentity, importIdentity — no conflicts with core)
export * from '@dot-protocol/identity';

// ── Chain — append-only worldline + pluggable storage ───────────────────────
// (createChain, appendDOT, getHead, getRange, verifyChain, MemoryStorage — no conflicts)
export * from '@dot-protocol/chain';

// ── Relay — CHORUS relay client + server ────────────────────────────────────
// DOT_SIZE is excluded here — it conflicts with core's DOT_SIZE (both = 153).
// Use the relay-specific constants via their unique names.
export {
  RelayClient,
  packFrame,
  unpackFrame,
  encodeCircleId,
  decodeCircleId,
  FRAME_SIZE,
  CIRCLE_ID_SIZE,
} from '@dot-protocol/relay';
export type {
  RelayConfig,
  RelayStatus,
  IncomingFrame,
  RelayMessage,
  FrameHandler,
  StatusHandler,
} from '@dot-protocol/relay';

// ── QR — encode/decode DOTs into scannable physical objects (Falooda) ────────
export {
  encodeBinary,
  decodeBinary,
  encodeSteganographic,
  decodeSteganographic,
  encodeNested,
  decodeNested,
  selectQRSpec,
  verifyPhysicalDOTs,
  QR_CAPACITY,
} from '@dot-protocol/qr';
export type {
  QRDOTSpec,
  PhysicalDOT,
  QRDecodeResult,
  QREncoding,
  QRErrorCorrection,
} from '@dot-protocol/qr';

// ── Arena — Elo engine, blind evaluation, prediction resolution ──────────────
export {
  updateElo,
  applyEloUpdates,
  computeEloFromMatches,
  computeEloPercentile,
  rankLeaderboard,
  ELO_DEFAULT,
  verifyResolution,
  verifyPrediction,
  resolveSession,
  hashPredictionDOT,
} from '@dot-protocol/arena';
export type {
  PredictionDOT,
  ResolutionDOT,
  ArenaMatch,
  BlindEvalSession,
  LeaderboardEntry,
  EloUpdate,
} from '@dot-protocol/arena';

// ── Wrapper — wrap/unwrap any binary payload as DOT chain ───────────────────
// DotType is excluded here — it is already exported by core above.
export {
  wrap,
  unwrap,
  createSession,
  createSessionFromKeypair,
  bridge,
  bridgeFetch,
  dotId,
} from '@dot-protocol/wrapper';
export type {
  WrappedChain,
  UnwrappedPayload,
  WrapOptions,
  UnwrapOptions,
  WrapSession,
  Protocol,
  BridgeOptions,
  BridgeHandle,
  DotIdentity,
  IdentityOptions,
} from '@dot-protocol/wrapper';
