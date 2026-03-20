/**
 * DOT Protocol v0.3.0 — Transform Executor
 *
 * Correction #43: DOT is a lens, not a thermometer.
 * This module executes named transforms from the registry
 * and verifies their output is deterministic and valid.
 *
 * Rules for all transforms:
 *   Total:        always terminates (no infinite loops)
 *   Pure:         output depends only on input
 *   Named:        references an audited transform from the registry
 *   Re-executable: anyone can verify by re-running input through the named function
 */

import { TransformRegistry } from '@dotprotocol/core';
import type { DOT } from '@dotprotocol/core';
import type { TransformCondition } from '@dotprotocol/core';

export interface TransformExecutionResult {
  success: boolean;
  transformId: string;
  verified: boolean;
  reason?: string;
}

/**
 * Execute a named transform on an input DOT and produce an output DOT.
 * The transform must be registered and its verify function must pass.
 */
export function executeTransform(
  transformId: string,
  input: DOT,
  output: DOT
): TransformExecutionResult {
  const spec = TransformRegistry.get(transformId);
  if (!spec) {
    return {
      success: false,
      transformId,
      verified: false,
      reason: `Transform '${transformId}' not found in registry`,
    };
  }

  try {
    const verified = spec.verify(input, output);
    return {
      success: true,
      transformId,
      verified,
      reason: verified ? undefined : 'Transform verification returned false',
    };
  } catch (err) {
    return {
      success: false,
      transformId,
      verified: false,
      reason: `Transform threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check if a time-capsule transform condition is satisfied.
 * Returns true if the current time >= the trigger timestamp.
 */
export function checkTimeCapsule(
  condition: Extract<TransformCondition, { transformId: 'time-capsule' }>,
  nowMs: number = Date.now()
): boolean {
  return nowMs >= condition.triggerCondition.value;
}

/**
 * Check if a chain-depth-gate condition is satisfied.
 */
export function checkChainDepthGate(
  condition: Extract<TransformCondition, { transformId: 'chain-depth-gate' }>,
  currentDepth: number
): boolean {
  return currentDepth >= condition.triggerCondition.minDepth;
}

/**
 * Check if a signer-approval condition is satisfied.
 * The approval DOT must be signed by the required key.
 */
export function checkSignerApproval(
  condition: Extract<TransformCondition, { transformId: 'signer-approval' }>,
  approvalDOT: DOT
): boolean {
  const requiredKey = condition.triggerCondition.requiredKey;
  // Convert hex key to bytes for comparison
  const keyBytes = new Uint8Array(
    requiredKey.match(/.{2}/g)!.map((h) => parseInt(h, 16))
  );
  return approvalDOT.pubkey.every((b, i) => b === keyBytes[i]);
}

/**
 * Verify a transform condition against current state.
 * Returns true if the condition is satisfied and the transform should execute.
 */
export function evaluateCondition(
  condition: TransformCondition,
  context: {
    nowMs?: number;
    chainDepth?: number;
    approvalDOT?: DOT;
  }
): boolean {
  switch (condition.transformId) {
    case 'time-capsule':
      return checkTimeCapsule(condition, context.nowMs);

    case 'chain-depth-gate':
      return checkChainDepthGate(condition, context.chainDepth ?? 0);

    case 'signer-approval':
      if (!context.approvalDOT) return false;
      return checkSignerApproval(condition, context.approvalDOT);

    default:
      return false;
  }
}
