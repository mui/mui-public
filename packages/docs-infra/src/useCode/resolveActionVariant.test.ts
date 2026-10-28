import { describe, expect, it } from 'vitest';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import { resolveActionVariant } from './resolveActionVariant';

describe('resolveActionVariant', () => {
  it('restores hoisted fallback dictionaries for original-source actions', () => {
    const mainFallback: FallbackNode[] = ['const value = true;'];
    const extraFallback: FallbackNode[] = ['export const helper = true;'];
    const resolved = resolveActionVariant(
      {
        fileName: 'App.tsx',
        source: { hastCompressed: 'compressed-main' },
        extraFiles: {
          'helper.ts': { source: { hastCompressed: 'compressed-helper' } },
        },
      },
      null,
      undefined,
      { 'App.tsx': mainFallback, 'helper.ts': extraFallback },
    );

    expect(resolved).toMatchObject({
      variant: {
        fallback: mainFallback,
        extraFiles: { 'helper.ts': { fallback: extraFallback } },
      },
    });
  });
});
