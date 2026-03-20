import { describe, it, expect, beforeEach } from 'vitest';
import {
  TransformRegistry,
  registerBuiltinTransforms,
  serializeTransformCondition,
  deserializeTransformCondition,
} from '../transform.js';
import type { TransformCondition } from '../transform.js';
import { createKeypair, createDOT } from '../index.js';

// Reset registry state before tests that register new transforms
beforeEach(() => {
  // Built-ins auto-register on module load — just ensure they're there
  registerBuiltinTransforms();
});

describe('TransformRegistry — register / get / list / has', () => {
  it('has 3 built-in transforms after load', () => {
    expect(TransformRegistry.has('time-capsule')).toBe(true);
    expect(TransformRegistry.has('signer-approval')).toBe(true);
    expect(TransformRegistry.has('chain-depth-gate')).toBe(true);
  });

  it('list() returns all registered specs', () => {
    const specs = TransformRegistry.list();
    const ids = specs.map((s) => s.id);
    expect(ids).toContain('time-capsule');
    expect(ids).toContain('signer-approval');
    expect(ids).toContain('chain-depth-gate');
  });

  it('get() returns spec for known id', () => {
    const spec = TransformRegistry.get('time-capsule');
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe('time-capsule');
    expect(spec!.version).toBe(3);
  });

  it('get() returns null for unknown id', () => {
    expect(TransformRegistry.get('nonexistent')).toBeNull();
  });

  it('registering duplicate id throws', () => {
    expect(() =>
      TransformRegistry.register({
        id: 'time-capsule',
        version: 99,
        inputSchema: { description: 'x' },
        outputSchema: { description: 'y' },
        verify: () => true,
        description: 'duplicate',
      })
    ).toThrow();
  });
});

describe('TransformRegistry — verify', () => {
  it('returns false for unknown transform id', async () => {
    const kp = await createKeypair();
    const dot = await createDOT({ keypair: kp });
    expect(TransformRegistry.verify('nonexistent', dot, dot)).toBe(false);
  });

  it('time-capsule: verify passes when pubkeys match', async () => {
    const kp = await createKeypair();
    const dot1 = await createDOT({ keypair: kp });
    const dot2 = await createDOT({ keypair: kp });
    expect(TransformRegistry.verify('time-capsule', dot1, dot2)).toBe(true);
  });

  it('time-capsule: verify fails when pubkeys differ', async () => {
    const kp1 = await createKeypair();
    const kp2 = await createKeypair();
    const dot1 = await createDOT({ keypair: kp1 });
    const dot2 = await createDOT({ keypair: kp2 });
    expect(TransformRegistry.verify('time-capsule', dot1, dot2)).toBe(false);
  });

  it('signer-approval: verify passes when output chain is non-zero', async () => {
    const kp = await createKeypair();
    const dot1 = await createDOT({ keypair: kp });
    // dot2 must reference dot1 in chain
    const dot2 = await createDOT({ keypair: kp, previous: dot1 });
    expect(TransformRegistry.verify('signer-approval', dot1, dot2)).toBe(true);
  });

  it('signer-approval: verify fails when output chain is zero (no link)', async () => {
    const kp = await createKeypair();
    const dot1 = await createDOT({ keypair: kp });
    const dot2 = await createDOT({ keypair: kp }); // genesis — chain is all zeros
    expect(TransformRegistry.verify('signer-approval', dot1, dot2)).toBe(false);
  });

  it('chain-depth-gate: verify passes when output chain is non-zero', async () => {
    const kp = await createKeypair();
    const dot1 = await createDOT({ keypair: kp });
    const dot2 = await createDOT({ keypair: kp, previous: dot1 });
    expect(TransformRegistry.verify('chain-depth-gate', dot1, dot2)).toBe(true);
  });
});

describe('TransformCondition serialization', () => {
  it('round-trips a time-capsule condition', () => {
    const cond: TransformCondition = {
      transformId: 'time-capsule',
      triggerCondition: { type: 'timestamp', value: 9999999999000, verifier: 'chain-clock' },
      stateChange: { from: { accessLevel: 0 }, to: { accessLevel: 2 } },
    };
    const bytes = serializeTransformCondition(cond);
    const decoded = deserializeTransformCondition(bytes);
    expect(decoded).toEqual(cond);
  });

  it('round-trips a chain-depth-gate condition', () => {
    const cond: TransformCondition = {
      transformId: 'chain-depth-gate',
      triggerCondition: { type: 'chain-depth', minDepth: 100 },
      stateChange: { from: { accessLevel: 1 }, to: { accessLevel: 3 } },
    };
    const bytes = serializeTransformCondition(cond);
    const decoded = deserializeTransformCondition(bytes);
    expect(decoded).toEqual(cond);
  });

  it('round-trips a signer-approval condition', () => {
    const cond: TransformCondition = {
      transformId: 'signer-approval',
      triggerCondition: { type: 'signature', requiredKey: 'deadbeef'.repeat(8) },
      stateChange: { from: { status: 'pending' }, to: { status: 'approved' } },
    };
    const bytes = serializeTransformCondition(cond);
    const decoded = deserializeTransformCondition(bytes);
    expect(decoded).toEqual(cond);
  });
});
