import { deflateSync, deflate, inflateSync, inflate, strToU8, strFromU8 } from 'fflate';
import { encode, decode } from 'uint8-to-base64';

/**
 * Shared dictionary for DEFLATE compression of HAST JSON.
 *
 * Contains byte sequences that frequently appear in JSON-serialized HAST trees
 * (syntax-highlighted TypeScript type documentation). The dictionary is
 * embedded in both the server build and the client bundle, so it must stay
 * small — currently ~600 bytes uncompressed.
 *
 * IMPORTANT: Changing this dictionary is a **breaking change** for any
 * previously-compressed payloads. When the dictionary is updated, all cached
 * or persisted `hastGzip` strings become undecodable. Bump the dictionary only
 * between major precomputed data regeneration cycles.
 */
const HAST_DICTIONARY = strToU8(
  [
    // JSON structural patterns (most frequent first)
    '{"type":"element","tagName":"span","properties":{"className":["',
    '{"type":"element","tagName":"a","properties":{"href":"',
    '{"type":"text","value":"',
    '"children":[',
    '"properties":{}',
    '"tagName":"code"',
    '"tagName":"pre"',
    '"type":"root"',
    '"type":"element"',
    '"type":"text"',
    // Starry Night highlighting class names
    'pl-k","pl-',
    'pl-smi',
    'pl-c1',
    'pl-en',
    'pl-s',
    'pl-v',
    'pl-pds',
    // Frame & line structure
    '"className":["frame"]',
    '"className":["line"]',
    '"dataFrameStartLine":',
    '"dataFrameEndLine":',
    '"dataLn":',
    // Common TypeScript tokens in type documentation
    'string',
    'number',
    'boolean',
    'undefined',
    'null',
    'object',
    'void',
    'Array',
    'Record',
    'Partial',
    'React.ReactNode',
    'React.HTMLAttributes',
    'HTMLElement',
  ].join(''),
);

/**
 * Compress a JSON string using DEFLATE with the shared HAST dictionary.
 * Returns a base64-encoded string suitable for embedding in serialized props.
 */
export function compressHast(json: string): string {
  return encode(deflateSync(strToU8(json), { level: 9, dictionary: HAST_DICTIONARY }));
}

/**
 * Decompress a base64-encoded DEFLATE payload that was compressed with
 * `compressHast`. Returns the original JSON string.
 *
 * Throws if the payload was not compressed with the matching dictionary.
 */
export function decompressHast(base64: string): string {
  return strFromU8(inflateSync(decode(base64), { dictionary: HAST_DICTIONARY }));
}

/**
 * Compress a string asynchronously using DEFLATE with the shared HAST dictionary.
 * Returns a base64-encoded string.
 */
export function compressHastAsync(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    deflate(
      strToU8(input),
      { consume: true, level: 9, dictionary: HAST_DICTIONARY },
      (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(encode(output));
        }
      },
    );
  });
}

/**
 * Decompress a base64-encoded DEFLATE payload asynchronously.
 * Returns the original JSON string.
 */
export function decompressHastAsync(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    inflate(decode(base64), { consume: true, dictionary: HAST_DICTIONARY }, (err, output) => {
      if (err) {
        reject(err);
      } else {
        resolve(strFromU8(output));
      }
    });
  });
}
