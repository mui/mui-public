'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import {
  CoordinatedLazy,
  useCoordinatedContent,
  useCoordinatedFallback,
} from '@mui/internal-docs-infra/CoordinatedLazy';
import { decompressString } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { Replayable } from '@/components/Replayable/Replayable';
import {
  ChunkRow,
  DOCUMENT,
  Totals,
  byteLength,
  compressLines,
  linesText,
  type Line,
} from '../proseComments';

// Each 5-line chunk carries its own plaintext and a comment payload compressed
// against just that chunk's plaintext — a smaller, per-chunk dictionary.
interface WireChunk {
  index: number;
  plaintext: string;
  compressed: string;
  plaintextBytes: number;
  compressedBytes: number;
  rawBytes: number;
}

const ITEMS: WireChunk[] = DOCUMENT.map((chunk) => {
  const plaintext = linesText(chunk.lines);
  const compressed = compressLines(chunk.lines, plaintext);
  return {
    index: chunk.index,
    plaintext,
    compressed,
    plaintextBytes: byteLength(plaintext),
    compressedBytes: byteLength(compressed),
    rawBytes: byteLength(JSON.stringify(chunk.lines)),
  };
});

// The final total baseline (plaintext + raw comments), so the totals bars grow
// against a fixed scale as chunks stream in.
const TOTAL_REFERENCE = ITEMS.reduce((sum, item) => sum + item.plaintextBytes + item.rawBytes, 0);

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

const source: StreamSource<WireChunk, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    for (const item of ITEMS) {
      // eslint-disable-next-line no-await-in-loop -- one chunk per beat is the point of the demo
      await delay(800, signal);
      if (signal.aborted) {
        return;
      }
      chunks.push(item);
      yield;
    }
  },
};

function ChunkFallback({ chunk }: { chunk: WireChunk }) {
  // Paint the plain five lines and hoist them as the per-chunk dictionary.
  useCoordinatedFallback(React.useMemo(() => ({ plaintext: chunk.plaintext }), [chunk.plaintext]));
  return (
    <ChunkRow
      lines={chunk.plaintext.split('\n').map((text) => ({ text }))}
      plaintextBytes={chunk.plaintextBytes}
      compressedBytes={chunk.compressedBytes}
      rawBytes={chunk.rawBytes}
      richLoaded={false}
      blackBox
    />
  );
}

function ChunkContent({ chunk }: { chunk: WireChunk }) {
  // Decode the comment payload against the plaintext the fallback hoisted.
  const { plaintext } = useCoordinatedContent() as { plaintext: string };
  const lines = React.useMemo<Line[]>(
    () => JSON.parse(decompressString(chunk.compressed, plaintext)),
    [chunk.compressed, plaintext],
  );
  return (
    <ChunkRow
      lines={lines}
      plaintextBytes={chunk.plaintextBytes}
      compressedBytes={chunk.compressedBytes}
      rawBytes={chunk.rawBytes}
      richLoaded
      blackBox
    />
  );
}

// A chunk expands its height in as it streams (via the grid 0fr→1fr trick, which
// transitions to an auto height), then swaps from plain to commented a beat later.
function ChunkPiece({ chunk }: { chunk: WireChunk }) {
  const [ready, setReady] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setExpanded(true));
    const id = setTimeout(() => setReady(true), 450);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(id);
    };
  }, []);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        transition: 'grid-template-rows 0.3s ease',
      }}
    >
      <div style={{ overflow: 'hidden' }}>
        <CoordinatedLazy
          ready={ready}
          requireHoist
          fallback={<ChunkFallback chunk={chunk} />}
          content={<ChunkContent chunk={chunk} />}
        />
      </div>
    </div>
  );
}

function ProgressiveProseView() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useStream<WireChunk, void>({ source });

  const plaintextBytes = chunks.reduce((sum, chunk) => sum + chunk.plaintextBytes, 0);
  const compressedBytes = chunks.reduce((sum, chunk) => sum + chunk.compressedBytes, 0);
  const rawBytes = chunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0);

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* A fixed-height viewport (~2.5 chunk cards tall). New chunks append below
            the fold; the scroll position stays put so reading isn't interrupted. */}
        <div
          style={{
            boxSizing: 'border-box',
            width: 620,
            height: 400,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 8,
            borderRadius: 8,
            border: '1px solid #e0dde8',
            background: '#fff',
          }}
        >
          {chunks.map((chunk) => (
            <ChunkPiece key={chunk.index} chunk={chunk} />
          ))}
        </div>
        {/* Totals accumulate live as chunks stream in (fixed scale, so the bars
            grow); shown throughout so nothing shifts. */}
        <Totals
          plaintextBytes={plaintextBytes}
          compressedBytes={compressedBytes}
          rawBytes={rawBytes}
          referenceBytes={TOTAL_REFERENCE}
        />
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading
            ? `streaming · ${chunks.length}/${ITEMS.length} chunks`
            : 'commented — full document'}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}

export function ProgressiveProse() {
  return (
    <Replayable>
      <ProgressiveProseView />
    </Replayable>
  );
}
