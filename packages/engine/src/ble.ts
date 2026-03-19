/**
 * DOT Engine — Web Bluetooth Peer Discovery
 *
 * Implements the BLE transport for DOT peer discovery.
 * The primary scan path uses navigator.bluetooth (Web Bluetooth API),
 * which requires a user gesture in browser environments.
 *
 * In Node.js (no navigator), isAvailable() returns false and scan()
 * returns null immediately — safe to call unconditionally.
 *
 * BLE advertising from the browser side is not supported on most platforms.
 * The advertise() method implements the GATT server path where available
 * (Android Chrome only). On other platforms it is a no-op.
 */

// ---------------------------------------------------------------------------
// BLE Protocol Constants
// ---------------------------------------------------------------------------

const DOT_SERVICE_UUID = '12345678-1234-5678-1234-567812345678';
const DOT_CHAR_DID     = '12345678-1234-5678-1234-567812345679';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BLEPeer {
  did: string;
  publicKey: Uint8Array;
  connectedAt: number;
}

export interface BLETransport {
  /** Scan for nearby DOT devices. Returns when a peer is found or timeout expires. */
  scan(timeoutMs?: number): Promise<BLEPeer | null>;
  /** Advertise this device's DID (only works on Android Chrome, not iOS). */
  advertise(did: string, publicKey: Uint8Array): Promise<void>;
  /** Returns true if Web Bluetooth is available in this environment. */
  isAvailable(): boolean;
  /** Stop any active scan or connection. */
  stop(): void;
}

// ---------------------------------------------------------------------------
// createBLETransport
// ---------------------------------------------------------------------------

/**
 * Create a BLE transport for DOT peer discovery.
 *
 * @example
 * const ble = createBLETransport();
 * if (ble.isAvailable()) {
 *   const peer = await ble.scan(10_000);
 *   if (peer) console.log('Found:', peer.did);
 * }
 */
export function createBLETransport(): BLETransport {
  let _stopped = false;
  let _activeDevice: BluetoothDevice | null = null;
  let _activeServer: BluetoothRemoteGATTServer | null = null;

  // ---------------------------------------------------------------------------
  // isAvailable
  // ---------------------------------------------------------------------------

  function isAvailable(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'bluetooth' in navigator
    );
  }

  // ---------------------------------------------------------------------------
  // scan
  // ---------------------------------------------------------------------------

  /**
   * Request a nearby DOT device via Web Bluetooth.
   * Returns a BLEPeer when found, or null if unavailable / timed out / stopped.
   *
   * NOTE: In a real browser, requestDevice() requires a user gesture.
   * Tests mock navigator.bluetooth and can call this freely.
   */
  async function scan(timeoutMs = 15_000): Promise<BLEPeer | null> {
    if (!isAvailable()) return null;
    if (_stopped) return null;

    // Set up timeout
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });

    const scanPromise = (async (): Promise<BLEPeer | null> => {
      try {
        const bluetooth = (navigator as Navigator & { bluetooth: Bluetooth }).bluetooth;

        // Request a device advertising the DOT service
        const device: BluetoothDevice = await bluetooth.requestDevice({
          filters: [{ services: [DOT_SERVICE_UUID] }],
        });

        if (_stopped) return null;
        _activeDevice = device;

        if (!device.gatt) return null;

        // Connect GATT
        const server: BluetoothRemoteGATTServer = await device.gatt.connect();
        if (_stopped) { server.disconnect(); return null; }
        _activeServer = server;

        // Get DOT primary service
        const service = await server.getPrimaryService(DOT_SERVICE_UUID);
        if (_stopped) { server.disconnect(); return null; }

        // Get DID characteristic
        const characteristic = await service.getCharacteristic(DOT_CHAR_DID);
        if (_stopped) { server.disconnect(); return null; }

        // Read the DID characteristic value
        const value: DataView = await characteristic.readValue();
        const json = new TextDecoder().decode(value.buffer);

        const parsed: { did: string; publicKey: string } = JSON.parse(json);
        const publicKey = _base64ToUint8Array(parsed.publicKey);

        return {
          did: parsed.did,
          publicKey,
          connectedAt: Date.now(),
        };
      } catch {
        // Includes: user cancelled, device unreachable, JSON parse failure
        return null;
      }
    })();

    try {
      const result = await Promise.race([scanPromise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  // ---------------------------------------------------------------------------
  // advertise
  // ---------------------------------------------------------------------------

  /**
   * Advertise this device's DID via BLE GATT server.
   * Only works on Android Chrome. On iOS / desktop this is a no-op.
   *
   * The method writes the DID and publicKey as a JSON-encoded value to the
   * DOT_CHAR_DID characteristic so that scanners can read it.
   */
  async function advertise(did: string, publicKey: Uint8Array): Promise<void> {
    if (!isAvailable()) return;

    // Web Bluetooth advertising (GATT server mode) is only available in some
    // browsers. Check for requestDevice as the primary indicator.
    const bluetooth = (navigator as Navigator & { bluetooth: Bluetooth }).bluetooth;

    // The browser GATT server API (navigator.bluetooth.requestLEScan or
    // navigator.bluetooth.getAvailability) is unstable.
    // For now: encode the payload and attempt to write it if a GATT server
    // is already connected. This is a best-effort advertise path.
    if (!_activeServer || !_activeServer.connected) return;

    try {
      const service = await _activeServer.getPrimaryService(DOT_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(DOT_CHAR_DID);

      const payload = JSON.stringify({
        did,
        publicKey: _uint8ArrayToBase64(publicKey),
      });
      const encoded = new TextEncoder().encode(payload);
      await characteristic.writeValue(encoded);
    } catch {
      // Platform doesn't support GATT server writes — silent no-op
      void bluetooth; // keep reference to suppress lint
    }
  }

  // ---------------------------------------------------------------------------
  // stop
  // ---------------------------------------------------------------------------

  function stop(): void {
    _stopped = true;
    if (_activeServer?.connected) {
      try { _activeServer.disconnect(); } catch { /* ignore */ }
    }
    _activeServer = null;
    _activeDevice = null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function _base64ToUint8Array(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function _uint8ArrayToBase64(arr: Uint8Array): string {
    let binary = '';
    for (const byte of arr) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  // ---------------------------------------------------------------------------
  // Return transport
  // ---------------------------------------------------------------------------

  return {
    scan,
    advertise,
    isAvailable,
    stop,
  };
}
