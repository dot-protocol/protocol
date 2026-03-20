# @dotprotocol/qr

Physical DOT — encode DOTs into QR codes and PNG steganography. The Falooda Protocol.

[![npm](https://img.shields.io/npm/v/@dotprotocol/qr)](https://www.npmjs.com/package/@dotprotocol/qr)

## Install

```bash
npm install @dotprotocol/qr
```

## Quick start

```js
import { encodeBinary, decodeBinary, selectQRSpec } from '@dotprotocol/qr';
import QRCode from 'qrcode'; // any QR library

// Pack up to 19 DOTs into a single QR code
const dots = [dot1, dot2, dot3];
const spec  = selectQRSpec(dots.length, 'binary');
const bytes = encodeBinary(dots, spec);

// Render with any QR library
await QRCode.toFile('dots.png', Buffer.from(bytes));

// Decode scanned QR
const result = decodeBinary(scannedBytes);
if (result.valid) {
  console.log(`${result.dots.length} DOTs recovered`);
}
```

## Capacity

| Mode | DOTs per code | Notes |
|------|--------------|-------|
| Binary | up to 19 | Standard QR — scan with any reader |
| Steganographic | up to 5 | Hidden in PNG pixel data |
| Nested | unlimited | Chain of QR codes |

19 DOTs × 153 bytes = 2,907 bytes. Standard QR capacity is 2,953 bytes (error correction M).

## API

### Binary mode

```js
import { encodeBinary, decodeBinary, selectQRSpec, QR_CAPACITY } from '@dotprotocol/qr';

// Encode
const spec  = selectQRSpec(dots.length, 'binary');
const bytes = encodeBinary(dots, spec);

// Decode
const result = decodeBinary(bytes);
// { valid: boolean, dots: Uint8Array[], count: number }

// Constants
QR_CAPACITY.maxBytesPerCode  // 2953
QR_CAPACITY.dotsPerCode      // 19
QR_CAPACITY.bytesPerDOT      // 153
```

### Steganographic mode

Hide DOTs in PNG pixel data — imperceptible to the eye.

```js
import { encodeSteganographic, decodeSteganographic } from '@dotprotocol/qr';

const hostImage  = fs.readFileSync('photo.png');
const withDOTs   = encodeSteganographic(dots, hostImage);
fs.writeFileSync('photo-with-dots.png', withDOTs);

// Recover
const result = decodeSteganographic(fs.readFileSync('photo-with-dots.png'));
// { valid: boolean, dots: Uint8Array[] }
```

### Nested mode

Chain of QR codes — for more than 19 DOTs in physical form.

```js
import { encodeNested, decodeNested } from '@dotprotocol/qr';

// Returns array of QR payloads — one per physical code
const codes = encodeNested(manyDots);
// codes[0], codes[1], ... → render each as a separate QR

// Decode — provide all scanned codes
const result = decodeNested(codes);
```

### Verification

```js
import { verifyPhysicalDOTs } from '@dotprotocol/qr';

const { valid, verified, failed } = await verifyPhysicalDOTs(dots);
// valid: boolean (all passed)
// verified: number (count that passed)
// failed: number (count that failed)
```

## The Falooda Protocol

DOT was designed for people without internet. A single printed QR code IS the message — signed, chained, verifiable with a phone that's never been online. The decode logic runs in 3KB of JavaScript.

```
Sender prints QR code ──► recipient scans ──► instant cryptographic verification
                                         ──► no server, no internet, no trust required
```

## License

MIT
