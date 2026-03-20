// @dotprotocol/wrapper — public API

export { wrap } from './wrap.js';
export { unwrap } from './unwrap.js';
export { createSession, createSessionFromKeypair } from './session.js';
export { bridge, bridgeFetch } from './bridge.js';
export { dotId } from './identity.js';
export type {
  WrappedChain,
  UnwrappedPayload,
  WrapOptions,
  UnwrapOptions,
  WrapSession,
  Protocol,
  BridgeOptions,
  BridgeHandle,
} from './types.js';
export type { DotIdentity, IdentityOptions } from './identity.js';
export { DotType } from '@dotprotocol/core';
