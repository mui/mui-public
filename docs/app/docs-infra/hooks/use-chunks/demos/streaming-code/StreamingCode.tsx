'use client';
import * as React from 'react';
import { useChunks } from '@mui/internal-docs-infra/useChunks';
import type { ChunkSource } from '@mui/internal-docs-infra/useChunks';

const LINES = [
  'export function greet(name) {',
  "  const message = 'Hello, ' + name;",
  '  console.log(message);',
  '  return message;',
  '}',
];

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// Streams the source one line at a time, accumulating into the rendered block.
const source: ChunkSource<string, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    for (const line of LINES) {
      // eslint-disable-next-line no-await-in-loop -- sequential reveal is the point of the demo
      await delay(350, signal);
      if (signal.aborted) {
        return;
      }
      chunks.push(line);
      yield;
    }
  },
};

export function StreamingCode() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useChunks<string, void>({ source });

  // Build the text as a single node. A leading newline inside `<pre>` is
  // stripped by the HTML parser, so the cursor's newline is only added when
  // there is preceding content — otherwise SSR and hydration would disagree.
  const body = chunks.join('\n');
  const cursor = loading ? `${body ? '\n' : ''}▍` : '';

  return (
    <Controller>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          minHeight: 96,
          border: '1px solid #d0cdd7',
          borderRadius: 8,
          background: '#faf9fc',
          font: '13px monospace',
          whiteSpace: 'pre-wrap',
        }}
      >
        {body + cursor}
      </pre>
    </Controller>
  );
  // @focus-end
}
