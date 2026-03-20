/**
 * DOT Protocol — TEACH Byte Royalty
 *
 * Article II.6: When a DOT with a TEACH byte is propagated (someone creates
 * a new DOT that references the TEACH DOT as learning source), the original
 * creator earns a protocol-enforced royalty.
 *
 * DOT spreads like life, not like messages.
 * TEACH byte = blueprint. Chain = constructor. Receiver = copier.
 */

export type PaymentMethod = 'x402' | 'lightning' | 'onchain';

export interface TEACHConfig {
  byte: number;              // TEACH byte value (0x01–0xFF, 0x00 = no royalty)
  royaltyBps: number;        // basis points (100 = 1%)
  propagationDepth: number;  // how many generations the royalty applies
  paymentMethod: PaymentMethod;
}

export interface PropagationEvent {
  sourceDOTHash: string;     // hex of the teacher's DOT wire bytes
  learnedDOTHash: string;    // hex of the learner's new DOT wire bytes
  depth: number;             // propagation steps from source (1 = direct)
  royaltyDue: number;        // computed from TEACHConfig × value (in bps)
}

/** Compute royalty due for a propagation event */
export function computeRoyalty(
  config: TEACHConfig,
  depth: number,
  baseValue: number
): number {
  if (depth > config.propagationDepth) return 0;
  if (config.byte === 0x00) return 0;

  // Royalty decays linearly with depth
  const depthMultiplier = 1 - (depth - 1) / Math.max(1, config.propagationDepth);
  return Math.floor((baseValue * config.royaltyBps * depthMultiplier) / 10_000);
}

/** Check if a TEACH config is valid */
export function validateTEACHConfig(config: TEACHConfig): { valid: boolean; reason?: string } {
  if (config.byte < 0x00 || config.byte > 0xFF) {
    return { valid: false, reason: 'TEACH byte must be 0x00–0xFF' };
  }
  if (config.royaltyBps < 0 || config.royaltyBps > 10_000) {
    return { valid: false, reason: 'royaltyBps must be 0–10000 (0–100%)' };
  }
  if (config.propagationDepth < 1) {
    return { valid: false, reason: 'propagationDepth must be >= 1' };
  }
  return { valid: true };
}

/** Default TEACH config (1% royalty, 3 generations deep, x402) */
export const DEFAULT_TEACH_CONFIG: TEACHConfig = {
  byte: 0x01,
  royaltyBps: 100,
  propagationDepth: 3,
  paymentMethod: 'x402',
};
