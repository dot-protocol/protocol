/**
 * @dotprotocol/sign — describe()
 *
 * Human-readable user manual for any DOT.
 * Every DOT is self-describing (Correction #47).
 */

import { fromBytes, DOT_SIZE, DotType, activeFaces } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import { TeachByte } from './types.js';
import type { SignedDOT, DOTDescription } from './types.js';

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const ACCESS_NAMES: Record<number, string> = {
  [DotType.PUBLIC]: 'public',
  [DotType.CIRCLE]: 'circle',
  [DotType.PRIVATE]: 'private',
  [DotType.EPHEMERAL]: 'ephemeral',
};

const TEACH_NAMES: Record<number, string> = {
  [TeachByte.None]: 'none',
  [TeachByte.SelfDescribing]: 'self-describing',
  [TeachByte.SchemaRef]: 'schema-ref',
  [TeachByte.HumanReadable]: 'human-readable',
  [TeachByte.MachineReadable]: 'machine-readable',
};

/** Produce a human-readable description of a DOT */
export function describe(input: SignedDOT | DOT | Uint8Array): DOTDescription {
  let dot: DOT;
  let face = 0;
  let teach = TeachByte.None;

  if (input instanceof Uint8Array) {
    dot = fromBytes(input);
  } else if ('dot' in input && 'bytes' in input) {
    const signed = input as SignedDOT;
    dot = signed.dot;
    face = signed.face;
    teach = signed.teach;
  } else {
    dot = input as DOT;
    face = dot.faceMask ?? 0;
  }

  const isGenesis = dot.chain.every((b) => b === 0);
  const isPing = dot.payload.every((b) => b === 0);

  return {
    key: bytesToHex(dot.pubkey),
    chain: bytesToHex(dot.chain),
    time: new Date(dot.ts).toISOString(),
    ts: dot.ts,
    access: ACCESS_NAMES[dot.type] ?? `unknown(0x${dot.type.toString(16)})`,
    payload: bytesToHex(dot.payload),
    faces: face !== 0 ? activeFaces(face) : [],
    teach: TEACH_NAMES[teach] ?? `unknown(0x${teach.toString(16)})`,
    isGenesis,
    isPing,
    size: DOT_SIZE,
  };
}
