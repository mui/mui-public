import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameDecoder } from './socketFraming';

describe('socketFraming', () => {
  it('round-trips a simple object', () => {
    const decoder = new FrameDecoder();
    const msg = { id: 'req-1', type: 'success', data: { hello: 'world' } };
    const out = decoder.push(encodeFrame(msg));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(msg);
  });

  it('round-trips a structure JSON would reject (Map, BigInt)', () => {
    const decoder = new FrameDecoder();
    const msg = {
      id: 'req-2',
      data: new Map<string, unknown>([
        ['a', 1n],
        ['b', new Uint8Array([1, 2, 3])],
      ]),
    };
    const [out] = decoder.push(encodeFrame(msg)) as [typeof msg];
    expect(out.id).toBe('req-2');
    const map = out.data as Map<string, unknown>;
    expect(map.get('a')).toBe(1n);
    expect(map.get('b')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('handles multiple frames written as one Buffer', () => {
    const decoder = new FrameDecoder();
    const a = encodeFrame({ id: 'a' });
    const b = encodeFrame({ id: 'b' });
    const c = encodeFrame({ id: 'c' });
    const out = decoder.push(Buffer.concat([a, b, c]));
    expect(out.map((m) => (m as { id: string }).id)).toEqual(['a', 'b', 'c']);
  });

  it('handles partial frames split across arbitrary chunk boundaries', () => {
    const decoder = new FrameDecoder();
    const original = { id: 'split', payload: 'x'.repeat(10_000) };
    const frame = encodeFrame(original);

    // Deliver the frame one byte at a time — the absolute worst case.
    const received: unknown[] = [];
    for (let i = 0; i < frame.byteLength; i += 1) {
      received.push(...decoder.push(frame.subarray(i, i + 1)));
    }
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(original);
  });

  it('keeps a trailing partial frame buffered until the rest arrives', () => {
    const decoder = new FrameDecoder();
    const complete = encodeFrame({ id: 'complete' });
    const partial = encodeFrame({ id: 'partial', body: 'hello world' });

    // First push: one complete frame + first half of the next.
    const halfPoint = Math.floor(partial.byteLength / 2);
    const firstChunk = Buffer.concat([complete, partial.subarray(0, halfPoint)]);
    const round1 = decoder.push(firstChunk);
    expect(round1).toHaveLength(1);
    expect((round1[0] as { id: string }).id).toBe('complete');

    // Second push: the tail of the partial frame.
    const round2 = decoder.push(partial.subarray(halfPoint));
    expect(round2).toHaveLength(1);
    expect(round2[0]).toEqual({ id: 'partial', body: 'hello world' });
  });

  it('handles a payload larger than Node\u0027s string-length cap would allow for JSON', () => {
    // ~200 MB of data — well under v8.serialize\u0027s own ceiling but
    // impossible for a JSON string round-trip on most Node versions. Using a
    // Uint8Array keeps the allocation bounded to the raw byte count without
    // materializing a giant JS string.
    const decoder = new FrameDecoder();
    const payload = new Uint8Array(200 * 1024 * 1024);
    // Fill with a non-zero pattern so v8.deserialize can\u0027t shortcut.
    for (let i = 0; i < payload.byteLength; i += 4096) {
      payload[i] = i & 0xff;
    }
    const frame = encodeFrame({ id: 'big', data: payload });
    const out = decoder.push(frame);
    expect(out).toHaveLength(1);
    const decoded = (out[0] as { id: string; data: Uint8Array }).data;
    expect(decoded.byteLength).toBe(payload.byteLength);
    expect(decoded[0]).toBe(0);
    expect(decoded[4096]).toBe(4096 & 0xff);
  });

  it('reset() clears the internal buffer', () => {
    const decoder = new FrameDecoder();
    const partial = encodeFrame({ id: 'will-be-dropped' }).subarray(0, 3);
    decoder.push(partial);
    decoder.reset();
    // Now push a fresh frame — it should decode cleanly.
    const out = decoder.push(encodeFrame({ id: 'fresh' }));
    expect(out).toEqual([{ id: 'fresh' }]);
  });
});
