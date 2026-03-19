/**
 * DOT Engine — BLE Transport Tests
 *
 * Mocks navigator.bluetooth and verifies BLE transport behavior in isolation.
 * In Node.js, navigator is not defined so isAvailable() returns false by default.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBLETransport } from '../ble.js';
import type { BLEPeer } from '../ble.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock DataView wrapping a JSON payload */
function mockDataView(data: { did: string; publicKey: string }): DataView {
  const json = JSON.stringify(data);
  const encoded = new TextEncoder().encode(json);
  // DataView needs an ArrayBuffer with the full range available
  const buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  return new DataView(buf);
}

/** Build a minimal mock Bluetooth GATT characteristic */
function mockCharacteristic(dataView: DataView) {
  return {
    readValue: vi.fn().mockResolvedValue(dataView),
    writeValue: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build a minimal mock Bluetooth GATT service */
function mockService(characteristic: ReturnType<typeof mockCharacteristic>) {
  return {
    getCharacteristic: vi.fn().mockResolvedValue(characteristic),
  };
}

/** Build a minimal mock Bluetooth GATT server */
function mockGattServer(service: ReturnType<typeof mockService>) {
  return {
    connected: true,
    connect: vi.fn().mockResolvedValue({
      getPrimaryService: vi.fn().mockResolvedValue(service),
    }),
    disconnect: vi.fn(),
    getPrimaryService: vi.fn().mockResolvedValue(service),
  };
}

/** Build a mock BluetoothDevice with GATT */
function mockBluetoothDevice(gattServer: ReturnType<typeof mockGattServer>) {
  return {
    gatt: gattServer,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures — valid BLE peer payload
// ---------------------------------------------------------------------------

const TEST_DID = 'dot:dGVzdHB1YmxpY2tleQ';

// 32-byte public key encoded as base64
const TEST_PUBKEY_BYTES = new Uint8Array(32);
TEST_PUBKEY_BYTES[0] = 0xde;
TEST_PUBKEY_BYTES[1] = 0xad;
TEST_PUBKEY_BYTES[31] = 0xbe;

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const TEST_PUBKEY_B64 = uint8ArrayToBase64(TEST_PUBKEY_BYTES);

// ---------------------------------------------------------------------------
// Tests — availability
// ---------------------------------------------------------------------------

describe('BLE Transport — isAvailable()', () => {
  it('1: isAvailable() returns false in Node.js (no navigator)', () => {
    // navigator is not defined in Node.js test environment
    const ble = createBLETransport();
    // In vitest (Node.js), there is no navigator
    expect(ble.isAvailable()).toBe(false);
  });

  it('2: isAvailable() returns false when navigator.bluetooth is absent', () => {
    // Simulate browser without BT
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'test-browser' },
      configurable: true,
      writable: true,
    });

    const ble = createBLETransport();
    expect(ble.isAvailable()).toBe(false);

    // Restore
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('3: isAvailable() returns true when navigator.bluetooth is present (mocked)', () => {
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { bluetooth: {} },
      configurable: true,
      writable: true,
    });

    const ble = createBLETransport();
    expect(ble.isAvailable()).toBe(true);

    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
      writable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — scan() when unavailable
// ---------------------------------------------------------------------------

describe('BLE Transport — scan() unavailable paths', () => {
  it('4: scan() returns null when BLE not available (Node.js)', async () => {
    const ble = createBLETransport();
    const result = await ble.scan(100);
    expect(result).toBeNull();
  });

  it('5: stop() does not throw when called before scan', () => {
    const ble = createBLETransport();
    expect(() => ble.stop()).not.toThrow();
  });

  it('6: BLE transport created successfully (factory returns object)', () => {
    const ble = createBLETransport();
    expect(ble).toBeDefined();
    expect(typeof ble.scan).toBe('function');
    expect(typeof ble.advertise).toBe('function');
    expect(typeof ble.isAvailable).toBe('function');
    expect(typeof ble.stop).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Tests — scan() with mock Bluetooth
// ---------------------------------------------------------------------------

describe('BLE Transport — scan() with mock bluetooth', () => {
  let origNavigator: typeof globalThis.navigator;

  beforeEach(() => {
    origNavigator = globalThis.navigator;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('7: When mock bluetooth returns a device with DID characteristic, scan() returns BLEPeer', async () => {
    const dataView = mockDataView({ did: TEST_DID, publicKey: TEST_PUBKEY_B64 });
    const char = mockCharacteristic(dataView);
    const service = mockService(char);
    const gattServer = mockGattServer(service);

    // The server's connect() returns a server with getPrimaryService
    const innerServer = {
      getPrimaryService: vi.fn().mockResolvedValue(service),
      disconnect: vi.fn(),
      connected: true,
    };
    gattServer.connect = vi.fn().mockResolvedValue(innerServer);

    const device = mockBluetoothDevice(gattServer);

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        bluetooth: {
          requestDevice: vi.fn().mockResolvedValue(device),
        },
      },
      configurable: true,
      writable: true,
    });

    const ble = createBLETransport();
    expect(ble.isAvailable()).toBe(true);

    const peer = await ble.scan(5_000);

    expect(peer).not.toBeNull();
    expect(peer!.did).toBe(TEST_DID);
    expect(peer!.publicKey).toBeInstanceOf(Uint8Array);
    expect(peer!.publicKey.length).toBe(32);
    expect(typeof peer!.connectedAt).toBe('number');
    expect(peer!.connectedAt).toBeGreaterThan(0);
  });

  it('8: BLEPeer has correct did, publicKey (Uint8Array 32B), connectedAt (number)', async () => {
    const dataView = mockDataView({ did: TEST_DID, publicKey: TEST_PUBKEY_B64 });
    const char = mockCharacteristic(dataView);
    const service = mockService(char);

    const innerServer = {
      getPrimaryService: vi.fn().mockResolvedValue(service),
      disconnect: vi.fn(),
      connected: true,
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        bluetooth: {
          requestDevice: vi.fn().mockResolvedValue({
            gatt: {
              connect: vi.fn().mockResolvedValue(innerServer),
              disconnect: vi.fn(),
            },
          }),
        },
      },
      configurable: true,
      writable: true,
    });

    const ble = createBLETransport();
    const beforeScan = Date.now();
    const peer = await ble.scan(5_000);
    const afterScan = Date.now();

    expect(peer).not.toBeNull();
    const p = peer as BLEPeer;

    // did
    expect(p.did).toBe(TEST_DID);

    // publicKey: Uint8Array, 32 bytes, matches TEST_PUBKEY_BYTES
    expect(p.publicKey).toBeInstanceOf(Uint8Array);
    expect(p.publicKey.length).toBe(32);
    expect(p.publicKey[0]).toBe(TEST_PUBKEY_BYTES[0]);
    expect(p.publicKey[31]).toBe(TEST_PUBKEY_BYTES[31]);

    // connectedAt: reasonable timestamp
    expect(p.connectedAt).toBeGreaterThanOrEqual(beforeScan);
    expect(p.connectedAt).toBeLessThanOrEqual(afterScan + 10);
  });

  it('9: scan() returns null if bluetooth.requestDevice throws (user cancelled)', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        bluetooth: {
          requestDevice: vi.fn().mockRejectedValue(new Error('User cancelled')),
        },
      },
      configurable: true,
      writable: true,
    });

    const ble = createBLETransport();
    const peer = await ble.scan(5_000);
    expect(peer).toBeNull();
  });

  it('10: scan() returns null after stop() is called before completion', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        bluetooth: {
          requestDevice: vi.fn().mockImplementation(() => new Promise(resolve => {
            // Resolves after 500ms — stop() should cancel
            setTimeout(() => resolve({
              gatt: { connect: vi.fn() },
            }), 500);
          })),
        },
      },
      configurable: true,
      writable: true,
    });

    const ble = createBLETransport();
    ble.stop(); // Stop BEFORE scan resolves

    const peer = await ble.scan(5_000);
    // After stop(), isAvailable path is bypassed — but stop sets _stopped = true
    // The scan starts (BLE is "available"), then stop() marks _stopped = true
    // When requestDevice eventually resolves, the _stopped check returns null
    // But since we stopped first, result should be null
    expect(peer).toBeNull();
  });
});
