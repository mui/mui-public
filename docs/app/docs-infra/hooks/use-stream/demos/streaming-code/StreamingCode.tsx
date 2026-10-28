'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import { DemoButton } from '@/components/DemoButton/DemoButton';

const SNIPPETS = [
  [
    'export function greet(name) {',
    "  const message = 'Hello, ' + name;",
    '  console.log(message);',
    '  return message;',
    '}',
  ],
  [
    'export function total(items) {',
    '  return items.reduce(',
    '    (sum, item) => sum + item.price,',
    '    0,',
    '  );',
    '}',
  ],
];

// Alternate the snippet on each stream run, so a refresh streams in new source.
let streamRun = 0;

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// Streams the source one line at a time, accumulating into the rendered block.
const source: StreamSource<string, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    const lines = SNIPPETS[streamRun % SNIPPETS.length];
    streamRun += 1;
    for (const line of lines) {
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
  const { chunks, Controller, loading, revalidating, refresh } = useStream<string, void>({
    source,
  });

  // Build the text as a single node. A leading newline inside `<pre>` is stripped
  // by the HTML parser, so the cursor's newline is only added when there is
  // preceding content — otherwise SSR and hydration would disagree.
  const body = chunks.join('\n');
  const cursor = loading ? `${body ? '\n' : ''}▍` : '';

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <pre
          style={{
            margin: 0,
            width: 320,
            boxSizing: 'border-box',
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
        {/* `refresh()` re-streams in the background (stale-while-revalidate): the
            current source stays up and swaps once the next snippet finishes. */}
        <DemoButton onClick={() => refresh()}>
          {revalidating ? 'Revalidating…' : 'Refresh'}
        </DemoButton>
      </div>
    </Controller>
  );
  // @focus-end
}
