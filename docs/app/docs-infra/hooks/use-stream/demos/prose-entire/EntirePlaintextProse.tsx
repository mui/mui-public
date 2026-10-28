'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import { decompressString } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { Replayable } from '@/components/Replayable/Replayable';
import {
  BYTE_SCALE,
  ChunkRow,
  DOCUMENT,
  Totals,
  byteLength,
  compressLines,
  linesText,
} from '../proseComments';
import type { Line } from '../proseComments';

const ALL_LINES = DOCUMENT.flatMap((chunk) => chunk.lines);
const FULL_PLAINTEXT = linesText(ALL_LINES);
const PLAINTEXT_BYTES = byteLength(FULL_PLAINTEXT);
const RAW_TOTAL = DOCUMENT.reduce((sum, chunk) => sum + byteLength(JSON.stringify(chunk.lines)), 0);
// Final total baseline, so the totals bars grow against a fixed scale.
const TOTAL_REFERENCE = PLAINTEXT_BYTES + RAW_TOTAL;

// Each comment chunk is compressed against the WHOLE document's plaintext — the
// big shared dictionary the upfront plaintext block already paid for.
interface CommentChunk {
  index: number;
  compressed: string;
  plaintextBytes: number;
  compressedBytes: number;
  rawBytes: number;
}

const ITEMS: CommentChunk[] = DOCUMENT.map((chunk) => {
  const compressed = compressLines(chunk.lines, FULL_PLAINTEXT);
  return {
    index: chunk.index,
    compressed,
    plaintextBytes: byteLength(linesText(chunk.lines)),
    compressedBytes: byteLength(compressed),
    rawBytes: byteLength(JSON.stringify(chunk.lines)),
  };
});

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

const source: StreamSource<CommentChunk, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    for (const item of ITEMS) {
      // eslint-disable-next-line no-await-in-loop -- staggered reveal is the point of the demo
      await delay(700, signal);
      if (signal.aborted) {
        return;
      }
      chunks.push(item);
      yield;
    }
  },
};

function EntirePlaintextProseView() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useStream<CommentChunk, void>({ source });

  // The plaintext is on screen instantly; each comment chunk decodes against the
  // whole-document dictionary as it arrives, lighting up that chunk's purple outline.
  const decodedByChunk = React.useMemo(() => {
    const decoded = new Map<number, Line[]>();
    for (const chunk of chunks) {
      decoded.set(
        chunk.index,
        JSON.parse(decompressString(chunk.compressed, FULL_PLAINTEXT)) as Line[],
      );
    }
    return decoded;
  }, [chunks]);

  const compressedTotal = chunks.reduce((sum, chunk) => sum + chunk.compressedBytes, 0);
  const rawTotal = chunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0);

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'fit-content' }}>
        {/* The whole plaintext is one payload sent up front for hydration — shown
            centered above the black box that outlines it. */}
        <div
          style={{
            alignSelf: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            font: '11px monospace',
            color: '#2c2838',
          }}
        >
          <div>plaintext {PLAINTEXT_BYTES} B — sent up front for hydration</div>
          <div
            style={{
              width: PLAINTEXT_BYTES * BYTE_SCALE,
              height: 11,
              borderRadius: 3,
              background: '#2c2838',
            }}
          />
        </div>
        {/* The entire plaintext arrived as one payload, so the whole box gets a
            single black outline; comments light up each chunk's purple outline. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: 'fit-content',
            padding: 8,
            borderRadius: 10,
            border: '2px solid #2c2838',
          }}
        >
          {ITEMS.map((item) => {
            const decoded = decodedByChunk.get(item.index);
            const lines =
              decoded ?? DOCUMENT[item.index].lines.map((line) => ({ text: line.text }));
            return (
              <ChunkRow
                key={item.index}
                lines={lines}
                plaintextBytes={item.plaintextBytes}
                compressedBytes={item.compressedBytes}
                rawBytes={item.rawBytes}
                richLoaded={Boolean(decoded)}
                blackBox={false}
              />
            );
          })}
        </div>
        {/* Totals accumulate live (fixed scale, so the bars grow) and stay put. */}
        <Totals
          plaintextBytes={PLAINTEXT_BYTES}
          compressedBytes={compressedTotal}
          rawBytes={rawTotal}
          referenceBytes={TOTAL_REFERENCE}
        />
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading
            ? `plaintext ready · comments ${chunks.length}/${ITEMS.length}`
            : 'commented — full document'}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}

export function EntirePlaintextProse() {
  return (
    <Replayable>
      <EntirePlaintextProseView />
    </Replayable>
  );
}
