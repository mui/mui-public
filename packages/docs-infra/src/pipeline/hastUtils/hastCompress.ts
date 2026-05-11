import { deflateSync, deflate, strToU8 } from 'fflate';
import { encode } from 'uint8-to-base64';
import { buildDictionary, computeDictionaryChecksum, CHECKSUM_BYTES } from './hastDictionary';

/**
 * Compress a JSON string using DEFLATE with the shared HAST dictionary.
 * Returns a base64-encoded string suitable for embedding in serialized props.
 *
 * When `textContent` is provided, the text is prepended to the static
 * dictionary for better compression of payloads that repeat their own text.
 * A 4-byte checksum is embedded so `decompressHast` can verify the same
 * `textContent` was supplied.
 *
 * When `textContent` is omitted, only the static dictionary is used and no
 * checksum is embedded (opt-out / backward-compatible path).
 */
export function compressHast(json: string, textContent?: string): string {
  const dictionary = buildDictionary(textContent);
  const deflated = deflateSync(strToU8(json), { level: 9, dictionary });

  if (textContent != null) {
    const checksum = computeDictionaryChecksum(dictionary);
    const payload = new Uint8Array(CHECKSUM_BYTES + deflated.byteLength);
    payload.set(checksum, 0);
    payload.set(deflated, CHECKSUM_BYTES);
    return encode(payload);
  }

  return encode(deflated);
}

/**
 * Compress a string asynchronously using DEFLATE with the shared HAST
 * dictionary. Returns a base64-encoded string.
 *
 * See `compressHast` for `textContent` semantics.
 */
export function compressHastAsync(input: string, textContent?: string): Promise<string> {
  const dictionary = buildDictionary(textContent);
  const checksumBytes = textContent != null ? computeDictionaryChecksum(dictionary) : null;

  return new Promise((resolve, reject) => {
    deflate(strToU8(input), { consume: true, level: 9, dictionary }, (err, output) => {
      if (err) {
        reject(err);
        return;
      }

      if (checksumBytes) {
        const payload = new Uint8Array(CHECKSUM_BYTES + output.byteLength);
        payload.set(checksumBytes, 0);
        payload.set(output, CHECKSUM_BYTES);
        resolve(encode(payload));
      } else {
        resolve(encode(output));
      }
    });
  });
}
