import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { expect, it } from 'vitest';
import { CodeHighlighter, useCodeFallback } from '../CodeHighlighter';
import type { Code, ContentLoadingProps } from '../CodeHighlighter/types';
import { createPrecomputeShell } from '../pipeline/loadPrecomputedCodeHighlighter/loadPrecomputedCodeHighlighter';
import { NativeCodeSource } from './index';

function Loading(props: ContentLoadingProps<{}>) {
  return useCodeFallback(props, { SourceComponent: NativeCodeSource }).selectedFile;
}

function renderShell(code: Code, mode: 'editable' | 'read-only' = 'editable') {
  return ReactDOMServer.renderToString(
    <CodeHighlighter
      precompute={createPrecomputeShell(code)}
      ContentLoading={Loading}
      Content={() => null}
      highlightAfter="init"
      initialDisabled={mode === 'read-only'}
      fallbackCollapsed
      loadPrecompute={async () => code}
    />,
  );
}

it.each(['editable', 'read-only'] as const)(
  'serves %s focused source from a deferred shell',
  (mode) => {
    const code: Code = {
      Default: {
        fileName: 'Demo.tsx',
        source: 'before\n    selected\nafter',
        fallback: [
          ['span', 'frame', 'before\n'],
          ['span', 'frame', { dataFrameType: 'focus' }, '    selected\n'],
          ['span', 'frame', 'after'],
        ],
        sourceProjection: { source: '    selected', indentation: '    ', start: 7, end: 19 },
        totalLines: 3,
        focusedLines: 1,
        collapsible: true,
      },
    };

    const shell = createPrecomputeShell(code);
    expect(JSON.stringify(shell)).not.toContain('"source":"    selected"');
    const view = renderShell(code, mode);

    if (mode === 'read-only') {
      expect(view).not.toContain('<textarea');
      expect(view).toContain('selected');
    } else {
      expect(view).toMatch(/<textarea[^>]*readonly[^>]*>selected<\/textarea>/i);
    }
  },
);

it('preserves a CRLF window when fallback lines were normalized', () => {
  const source = '  first\r\n  second';

  const code: Code = {
    Default: {
      fileName: 'Demo.tsx',
      fallback: [['span', 'frame', { dataFrameType: 'focus' }, '  first\n  second\n']],
      sourceProjection: { source, indentation: '  ', start: 0, end: source.length },
      focusedLines: 2,
      totalLines: 2,
    },
  };

  expect(renderShell(code)).toMatch(/<textarea[^>]*>first\r\nsecond<\/textarea>/i);
});
