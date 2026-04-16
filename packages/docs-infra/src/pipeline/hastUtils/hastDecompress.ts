import { inflateSync, inflate, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';
import {
  buildDictionary,
  computeDictionaryChecksum,
  CHECKSUM_BYTES,
  HastDictionaryMismatchError,
} from './hastDictionary';

/**
 * Decompress a base64-encoded DEFLATE payload that was compressed with
 * `compressHast`. Returns the original JSON string.
 *
 * When `textContent` is provided, the first 4 bytes of the decoded payload
 * are treated as a dictionary checksum. If the checksum does not match the
 * dictionary built from `textContent`, a `HastDictionaryMismatchError` is
 * thrown — this prevents silently rendering corrupted data.
 *
 * When `textContent` is omitted, only the static dictionary is used for
 * decompression and no checksum verification is performed.
 */
export function decompressHast(base64: string, textContent?: string): string {
  const raw = decode(base64);
  const dictionary = buildDictionary(textContent);

  if (textContent != null) {
    verifyChecksum(raw, dictionary);
    return strFromU8(inflateSync(raw.subarray(CHECKSUM_BYTES), { dictionary }));
  }

  return strFromU8(inflateSync(raw, { dictionary }));
}

/**
 * Decompress a base64-encoded DEFLATE payload asynchronously.
 * Returns the original JSON string.
 *
 * See `decompressHast` for `textContent` semantics.
 */
export function decompressHastAsync(base64: string, textContent?: string): Promise<string> {
  const raw = decode(base64);
  const dictionary = buildDictionary(textContent);

  if (textContent != null) {
    try {
      verifyChecksum(raw, dictionary);
    } catch (checksumError) {
      return Promise.reject(checksumError);
    }
    return new Promise((resolve, reject) => {
      inflate(raw.subarray(CHECKSUM_BYTES), { consume: true, dictionary }, (err, output) => {
        if (err) {
          reject(err);
        } else {
          resolve(strFromU8(output));
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    inflate(raw, { consume: true, dictionary }, (err, output) => {
      if (err) {
        reject(err);
      } else {
        resolve(strFromU8(output));
      }
    });
  });
}

function verifyChecksum(raw: Uint8Array, dictionary: Uint8Array): void {
  if (raw.byteLength < CHECKSUM_BYTES) {
    throw new HastDictionaryMismatchError();
  }

  const expected = computeDictionaryChecksum(dictionary);
  for (let i = 0; i < CHECKSUM_BYTES; i += 1) {
    if (raw[i] !== expected[i]) {
      throw new HastDictionaryMismatchError();
    }
  }
}
