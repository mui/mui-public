export {
  HAST_DICTIONARY,
  MAX_DICTIONARY_SIZE,
  CHECKSUM_BYTES,
  buildDictionary,
  computeDictionaryChecksum,
  HastDictionaryMismatchError,
} from './hastDictionary';
export { compressHast, compressHastAsync } from './hastCompress';
export { decompressHast, decompressHastAsync } from './hastDecompress';

// `compressHast` / `decompressHast` are string-in/string-out DEFLATE with an
// optional preset dictionary — generic beyond HAST. These aliases name that
// generic use (e.g. the Coordinated Streaming pattern passing a compressed
// payload from a fallback to the full content, decoded against a hoisted
// dictionary).
export { compressHast as compressString, compressHastAsync as compressStringAsync } from './hastCompress';
export {
  decompressHast as decompressString,
  decompressHastAsync as decompressStringAsync,
} from './hastDecompress';
