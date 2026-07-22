import { describe, expect, it } from 'vitest';
import type { Code } from '../../CodeHighlighter/types';
import { fallbackToText } from '../../CodeHighlighter/fallbackFormat';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import { createPrecomputeShell } from './loadPrecomputedCodeHighlighter';

describe('createPrecomputeShell', () => {
  it('keeps the fallback source but removes highlighted and editing metadata', () => {
    const fallback: FallbackNode[] = [['span', 'frame', 'const value = 1;\n']];
    const code = {
      Default: {
        fileName: 'Demo.tsx',
        source: { hastCompressed: 'compressed' },
        sourceProjection: { source: 'value', start: 6, end: 11 },
        fallback,
        totalLines: 1,
        focusedLines: 1,
        transforms: { js: { fileName: 'Demo.jsx' } },
      },
    } as Code;

    const shell = createPrecomputeShell(code);
    const variant = shell.Default;
    expect(JSON.stringify(shell)).not.toContain('hastCompressed');
    expect(variant && typeof variant === 'object' ? variant.transforms : undefined).toBeUndefined();
    expect(
      variant && typeof variant === 'object' && variant.fallback
        ? fallbackToText(variant.fallback)
        : '',
    ).toBe('const value = 1;\n');
  });
});
