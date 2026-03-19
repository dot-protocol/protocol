/**
 * .dot file format — binary container for DOT chains
 *
 * HEADER (50 bytes):
 *   [0..3]    magic     4B   "DOT\x00" (0x44 0x4F 0x54 0x00)
 *   [4]       version   1B   0x01
 *   [5]       flags     1B   bit 0: compressed (BLS batch), bit 1: encrypted
 *   [6..9]    count     4B   uint32 LE — number of DOTs
 *   [10..41]  pubkey   32B   Ed25519 public key of chain author
 *   [42..49]  created   8B   timestamp of first DOT, big-endian uint64
 *
 * BODY:
 *   If flags.compressed = 0: count × 153 raw DOT bytes
 *   If flags.compressed = 1: BLS batch frame(s) [Phase 2]
 *
 * Extension: .dot
 * MIME type:  application/x-dot-chain
 * Magic:      44 4F 54 00
 */

export const DOT_FILE_MAGIC = new Uint8Array([0x44, 0x4F, 0x54, 0x00]); // "DOT\0"
export const DOT_FILE_VERSION = 0x01;
export const DOT_FILE_HEADER_SIZE = 50;

export const DOT_FILE_FLAGS = {
  COMPRESSED: 0b00000001,
  ENCRYPTED:  0b00000010,
} as const;

export interface DotFileHeader {
  magic: Uint8Array;
  version: number;
  flags: number;
  count: number;
  pubkey: Uint8Array;    // 32 bytes
  created: bigint;       // uint64 big-endian, Unix ms
}

export interface DotFile {
  header: DotFileHeader;
  dots: Uint8Array[];    // array of 153-byte DOTs
}
