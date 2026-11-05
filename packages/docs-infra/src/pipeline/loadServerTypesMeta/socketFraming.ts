/**
 * Length-prefixed binary framing for the SocketServer/SocketClient protocol.
 *
 * The previous protocol used newline-delimited JSON (NDJSON): each message was
 * `JSON.stringify(message) + '\n'`. Two problems:
 *
 * 1. `JSON.stringify` fails with `RangeError: Invalid string length` on
 *    payloads whose UTF-8 size exceeds Node's ~500 MB string cap. Large
 *    consumer projects (e.g. mui-x `DataGridProps`, 131 direct props with a
 *    fully expanded generic chain) hit this and crash the worker pool.
 * 2. The client-side decoder concatenated into a JS string (`this.buffer += chunk`)
 *    which shared the same cap and paid O(n) UTF-8 decoding on every chunk.
 *
 * The new framing layer uses `v8.serialize` / `v8.deserialize` (the same
 * structured-clone algorithm used internally by `worker_threads.postMessage`).
 * It preserves binary structure exactly, has no UTF-8 string limit, and is
 * faster than JSON for deeply nested objects.
 *
 * Wire format:
 *   [ 4-byte big-endian uint32 body length ][ body bytes ]
 *
 * Max message size per frame: 2^32 − 1 bytes (~4 GB), far beyond anything the
 * type extractor currently produces.
 */

// eslint-disable-next-line n/prefer-node-protocol
import v8 from 'v8';

/**
 * Encode a message as a length-prefixed binary frame.
 *
 * Does NOT catch serialization errors — callers that want to recover should
 * wrap their own try/catch. Failures here mean the message contains something
 * structured-clone can't handle (functions, host objects, etc.), which is a
 * programming bug, not a size issue.
 */
export function encodeFrame(message: unknown): Buffer {
  const body = v8.serialize(message);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([header, body], 4 + body.byteLength);
}

/**
 * Stateful decoder that accepts raw socket chunks and yields complete decoded
 * messages. Reuses a single internal buffer to avoid the O(n²) re-concat that
 * the old string-concat decoder suffered from on large payloads.
 */
export class FrameDecoder {
  /** Concatenated pending bytes. Compact — trimmed whenever a message is emitted. */
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Push a new chunk from the socket and return any complete messages it
   * completes. The decoder retains any remaining partial frame for the next
   * call.
   */
  push(chunk: Buffer): unknown[] {
    this.buffer =
      this.buffer.byteLength === 0
        ? chunk
        : Buffer.concat([this.buffer, chunk], this.buffer.byteLength + chunk.byteLength);

    const messages: unknown[] = [];
    let offset = 0;

    while (this.buffer.byteLength - offset >= 4) {
      const bodyLength = this.buffer.readUInt32BE(offset);
      const frameEnd = offset + 4 + bodyLength;
      if (this.buffer.byteLength < frameEnd) {
        break;
      }
      const body = this.buffer.subarray(offset + 4, frameEnd);
      // v8.deserialize copies into its own V8-managed structure, so we can
      // safely discard the source buffer after this call.
      messages.push(v8.deserialize(body));
      offset = frameEnd;
    }

    // Drop fully-consumed bytes from the front of the buffer.
    this.buffer = offset === 0 ? this.buffer : this.buffer.subarray(offset);
    return messages;
  }

  /** Reset state — useful for connection resets. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
