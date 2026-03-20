export { createKeypair } from './keypair.js';
export { createDOT } from './create.js';
export { verifyDOT, checkChain } from './verify.js';
export { toBytes, fromBytes } from './bytes.js';
export { DotType, DOT_SIZE, PAYLOAD_SIZE, OFF } from './types.js';
export type { DOT, Keypair, CreateDOTInput } from './types.js';

// Batch compression (Phase 1 — Ed25519)
export { batchPack, batchUnpack } from './batch.js';

// Batch compression (Phase 1.5 — BLS)
export { batchPackBLS, batchUnpackBLS } from './batch.js';
export type { BatchFrame, BatchHeader, BatchEntry } from './batch-types.js';
export { BATCH_VERSION_ED25519, BATCH_VERSION_BLS, BATCH_HEADER_SIZE, ED25519_ENTRY_SIZE, BLS_ENTRY_SIZE, BLS_AGG_SIG_SIZE } from './batch-types.js';

// BLS12-381 signing + aggregation
export { createBLSKeypair, signBLS, verifyBLS, aggregateSignatures, verifyAggregateSameSigner } from './bls.js';
export type { BLSKeypair } from './bls.js';
export { BLS_PUBKEY_SIZE, BLS_SIG_SIZE } from './bls.js';

// .dot file format
export { writeDotFile, readDotFile, inspectDotFile } from './dot-file.js';
export type { DotFile, DotFileHeader } from './dot-file-types.js';
export { DOT_FILE_MAGIC, DOT_FILE_VERSION, DOT_FILE_HEADER_SIZE, DOT_FILE_FLAGS } from './dot-file-types.js';

// v0.3.0 — 12+1 Face Architecture (Correction: Grammar Audit)
export { DOTFace, ALPHABET_FACES, validateFaceMask, hasFace, composeFaces, activeFaces } from './faces.js';
export type { DOTFaceMask } from './faces.js';

// v0.3.0 — Transform Registry (Correction #43: DOT is a lens, not a thermometer)
export { TransformRegistry, registerBuiltinTransforms, serializeTransformCondition, deserializeTransformCondition } from './transform.js';
export type { TransformSpec, Schema, TransformCondition, TimeCapsuleCondition, SignerApprovalCondition, ChainDepthGateCondition } from './transform.js';

// v0.3.0 — TEACH Byte Royalty (Article II.6)
export { computeRoyalty, validateTEACHConfig, DEFAULT_TEACH_CONFIG } from './teach.js';
export type { TEACHConfig, PropagationEvent, PaymentMethod } from './teach.js';
