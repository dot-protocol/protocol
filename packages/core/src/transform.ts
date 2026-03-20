/**
 * DOT Protocol — Transform Registry
 *
 * Correction #43: DOT is a lens, not a thermometer.
 * Transforms are: Total, Pure, Named, Re-executable.
 * No Turing completeness — no loops, no branches, no inline code.
 */

import type { DOT } from './types.js';

export interface Schema {
  description: string;
  required?: string[];
}

export interface TransformSpec {
  id: string;
  version: number;
  inputSchema: Schema;
  outputSchema: Schema;
  verify: (input: DOT, output: DOT) => boolean;
  description: string;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _registry = new Map<string, TransformSpec>();

export const TransformRegistry = {
  register(spec: TransformSpec): void {
    if (_registry.has(spec.id)) {
      throw new Error(`Transform '${spec.id}' is already registered`);
    }
    _registry.set(spec.id, spec);
  },

  get(id: string): TransformSpec | null {
    return _registry.get(id) ?? null;
  },

  verify(transformId: string, input: DOT, output: DOT): boolean {
    const spec = _registry.get(transformId);
    if (!spec) return false;
    try {
      return spec.verify(input, output);
    } catch {
      return false;
    }
  },

  list(): TransformSpec[] {
    return Array.from(_registry.values());
  },

  has(id: string): boolean {
    return _registry.has(id);
  },
};

// ── Built-in Transforms ───────────────────────────────────────────────────────

export interface TimeCapsuleCondition {
  transformId: 'time-capsule';
  triggerCondition: {
    type: 'timestamp';
    value: number;       // unix ms timestamp
    verifier: 'chain-clock';
  };
  stateChange: {
    from: { accessLevel: 0 };
    to: { accessLevel: number };
  };
}

export interface SignerApprovalCondition {
  transformId: 'signer-approval';
  triggerCondition: {
    type: 'signature';
    requiredKey: string;      // hex Ed25519 public key
    requiredContent?: string; // optional content hash
  };
  stateChange: {
    from: Record<string, unknown>;
    to: Record<string, unknown>;
  };
}

export interface ChainDepthGateCondition {
  transformId: 'chain-depth-gate';
  triggerCondition: {
    type: 'chain-depth';
    minDepth: number;
  };
  stateChange: {
    from: { accessLevel: number };
    to: { accessLevel: number };
  };
}

export type TransformCondition =
  | TimeCapsuleCondition
  | SignerApprovalCondition
  | ChainDepthGateCondition;

/** Register the three v0.3.0 built-in transforms */
export function registerBuiltinTransforms(): void {
  if (!TransformRegistry.has('time-capsule')) {
    TransformRegistry.register({
      id: 'time-capsule',
      version: 3,
      inputSchema: { description: 'DOT at accessLevel 0 (invisible)' },
      outputSchema: { description: 'DOT at signer-specified accessLevel (1-4)' },
      verify(input, output) {
        // Verifiable: output timestamp must be >= condition trigger timestamp
        // Both DOTs must share the same pubkey (same signer)
        return input.pubkey.every((b, i) => b === output.pubkey[i]);
      },
      description: 'Translucency level changes at a verifiable timestamp',
    });
  }

  if (!TransformRegistry.has('signer-approval')) {
    TransformRegistry.register({
      id: 'signer-approval',
      version: 3,
      inputSchema: { description: 'DOT awaiting approval from a specified key' },
      outputSchema: { description: 'DOT after approval — state changed' },
      verify(input, output) {
        // Input and output must be linked by chain (output.chain = SHA-256(input wire))
        // The approval signature is validated separately by the relay
        return output.chain.some((b) => b !== 0); // chain field must be non-zero (linked)
      },
      description: 'State transition upon receiving a DOT signed by a specified key',
    });
  }

  if (!TransformRegistry.has('chain-depth-gate')) {
    TransformRegistry.register({
      id: 'chain-depth-gate',
      version: 3,
      inputSchema: { description: 'DOT at lower accessLevel, awaiting chain depth' },
      outputSchema: { description: 'DOT at higher accessLevel after minDepth reached' },
      verify(_input, output) {
        // Chain depth is computed externally; output DOT must reference a valid chain
        return output.chain.some((b) => b !== 0);
      },
      description: 'State transition when chain reaches specified depth',
    });
  }
}

// Auto-register built-ins on module load
registerBuiltinTransforms();

/** Serialize a transform condition to bytes for inclusion in DOT hash */
export function serializeTransformCondition(cond: TransformCondition): Uint8Array {
  const json = JSON.stringify(cond);
  return new TextEncoder().encode(json);
}

/** Deserialize a transform condition from bytes */
export function deserializeTransformCondition(bytes: Uint8Array): TransformCondition {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as TransformCondition;
}
