import { encode, decode } from 'uint8-to-base64';

/**
 * Encode a numeric vector as base64 of its little-endian float32 byte
 * representation. Each value takes a fixed 4 bytes regardless of magnitude,
 * which is significantly more compact than JSON for typical embedding
 * vectors (~40% smaller for 384-dim vectors).
 */
export function encodeEmbeddingsBase64(values: number[]): string {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new Float32Array(buffer);
  for (let i = 0; i < values.length; i += 1) {
    view[i] = values[i];
  }
  return encode(new Uint8Array(buffer));
}

/**
 * Decode a base64-encoded float32 vector. Returns plain numbers (not a
 * typed array) for compatibility with existing PageMetadata shapes and
 * downstream consumers like Orama.
 */
export function decodeEmbeddingsBase64(base64: string): number[] {
  const bytes = decode(base64);
  // Float32Array needs a buffer aligned to 4 bytes; copy if the decoded
  // buffer's byteOffset is not aligned (Uint8Array from `decode` is fresh,
  // so byteOffset is 0, but be defensive).
  const view =
    bytes.byteOffset % 4 === 0
      ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : new Float32Array(bytes.slice().buffer);
  return Array.from(view);
}
