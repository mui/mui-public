/** @vitest-environment jsdom */
import * as React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createParseSource } from '../pipeline/parseSource/parseSource';
import { createEnhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { transformSource } from '../pipeline/loadIsomorphicCodeVariant/transformSource';
import { computeHastDeltas } from '../pipeline/loadIsomorphicCodeVariant/computeHastDeltas';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { frameFallbackFromSpans } from '../pipeline/hastUtils';
import { createTransformedFiles } from './TransformEngine';
import { useFileNavigation } from './useFileNavigation';
import type { VariantCode } from '../CodeHighlighter/types';

const FILE_NAME = 'Demo.ts';
const VARIANT = 'Default';

const FOCUS_MAX_LINES = 16;
const SOURCE_LINE_COUNT = FOCUS_MAX_LINES * 2;

const TYPESCRIPT = Array.from(
  { length: SOURCE_LINE_COUNT },
  (_, index) => `export const value${index}: number = ${index};`,
).join('\n');

const JAVASCRIPT = TYPESCRIPT.replaceAll(': number', '');

const ENHANCERS = [
  createEnhanceCodeEmphasis({
    emitFrameIndent: true,
    focusFramesMaxSize: FOCUS_MAX_LINES,
    oversizedFocus: 'hide',
  }),
];

it.each(['enhanced', 'stored'])(
  'preserves %s collapsed focus counts for transformed source',
  async (counts) => {
    const parseSource = await createParseSource(['source.ts', 'source.js']);

    const transforms = await transformSource(TYPESCRIPT, FILE_NAME, [
      {
        extensions: ['ts'],
        transformer: async () => ({ js: { source: JAVASCRIPT, fileName: 'Demo.js' } }),
      },
    ]);

    const code = await computeHastDeltas(
      {
        [VARIANT]: {
          fileName: FILE_NAME,
          source: parseSource(TYPESCRIPT, FILE_NAME),
          comments: { 1: ['@focus-start'], [SOURCE_LINE_COUNT]: ['@focus-end'] },
          transforms,
          totalLines: SOURCE_LINE_COUNT,
          focusedLines: 0,
          collapsible: true,
        },
      },
      parseSource,
    );

    const variant = code[VARIANT] as VariantCode;

    const transformedFiles = createTransformedFiles(variant, 'js', {
      decode: decodeHastSource,
      frameFallbackFromSpans,
    });

    const { result, rerender } = renderHook(
      ({ edited }) => {
        const [selectedFileName, setSelectedFileName] = React.useState<string | undefined>(
          FILE_NAME,
        );

        return useFileNavigation({
          selectedVariant: variant,
          hasControlledEdits: edited,
          transformedFiles,
          selectedTransform: 'js',
          selectedVariantKey: VARIANT,
          variantKeys: [VARIANT],
          shouldHighlight: true,
          effectiveCode: code,
          sourceEnhancers: counts === 'enhanced' ? ENHANCERS : undefined,
          selectedFileName,
          setSelectedFileName,
        });
      },
      { initialProps: { edited: false } },
    );

    await waitFor(() => expect(result.current.selectedFileFocusedLines).toBe(0));
    expect(result.current.selectedFileCollapsible).toBe(true);

    if (counts === 'stored') {
      rerender({ edited: true });
      expect(result.current.selectedFileFocusedLines).toBe(SOURCE_LINE_COUNT);

      rerender({ edited: false });
      expect(result.current.selectedFileFocusedLines).toBe(0);
      expect(result.current.selectedFileCollapsible).toBe(true);
    }
  },
);
