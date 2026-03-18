import { describe, it, expect } from 'vitest';
import { packFrame, unpackFrame, FRAME_SIZE, DOT_SIZE, encodeCircleId, decodeCircleId, CIRCLE_ID_SIZE } from '../types.js';

describe('frame encoding', () => {
  it('packFrame produces FRAME_SIZE bytes', () => {
    const dotBytes = new Uint8Array(DOT_SIZE).fill(0xab);
    const frame = packFrame('test-circle-id', dotBytes);
    expect(frame.length).toBe(FRAME_SIZE);
  });

  it('unpackFrame recovers circleId', () => {
    const dotBytes = new Uint8Array(DOT_SIZE).fill(0xcd);
    const frame = packFrame('my-circle-123', dotBytes);
    const { circleId } = unpackFrame(frame);
    expect(circleId).toBe('my-circle-123');
  });

  it('unpackFrame recovers dotBytes', () => {
    const dotBytes = new Uint8Array(DOT_SIZE).fill(0xef);
    const frame = packFrame('c', dotBytes);
    const { dotBytes: recovered } = unpackFrame(frame);
    expect(recovered).toEqual(dotBytes);
  });

  it('packFrame roundtrip with max-length circleId (32 chars)', () => {
    const longId = 'a'.repeat(32);
    const dotBytes = new Uint8Array(DOT_SIZE).fill(1);
    const frame = packFrame(longId, dotBytes);
    const { circleId } = unpackFrame(frame);
    expect(circleId).toBe(longId);
  });

  it('circleId longer than 32 bytes is truncated', () => {
    const dotBytes = new Uint8Array(DOT_SIZE).fill(0);
    const frame = packFrame('x'.repeat(40), dotBytes);
    const { circleId } = unpackFrame(frame);
    expect(circleId.length).toBe(32);
  });

  it('packFrame throws if dotBytes is wrong size', () => {
    expect(() => packFrame('test', new Uint8Array(100))).toThrow();
  });

  it('unpackFrame throws if frame is wrong size', () => {
    expect(() => unpackFrame(new Uint8Array(100))).toThrow();
  });

  it('encodeCircleId / decodeCircleId roundtrip', () => {
    const id = 'hello-world';
    const encoded = encodeCircleId(id);
    expect(encoded.length).toBe(CIRCLE_ID_SIZE);
    expect(decodeCircleId(encoded)).toBe(id);
  });
});
