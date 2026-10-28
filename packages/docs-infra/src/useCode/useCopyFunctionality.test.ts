import { describe, it, expect } from 'vitest';
import type { Nodes as HastNodes } from 'hast';
import { collectVariantFiles } from './useCopyFunctionality';
import { compressHast } from '../pipeline/hastUtils/hastCompression';
import { fallbackToText } from '../CodeHighlighter/fallbackFormat';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import type { VariantCode } from '../CodeHighlighter/types';

const buttonRoot: HastNodes = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [{ type: 'text', value: 'const Button = 1;\nconst Checkbox = 2;' }],
    },
  ],
};

// The DEFLATE dictionary for a compressed source is the file's fallback text.
const buttonFallback: FallbackNode[] = ['const Button = 1;\nconst Checkbox = 2;'];

const utilsRoot: HastNodes = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [{ type: 'text', value: 'export const myFunction = () => {};' }],
    },
  ],
};

const utilsFallback: FallbackNode[] = ['export const myFunction = () => {};'];

describe('collectVariantFiles', () => {
  it('decodes a main `hastCompressed` source from the variant `fallback` when no fallbacks map is supplied', () => {
    const selectedVariant: VariantCode = {
      fileName: 'a.js',
      source: {
        hastCompressed: compressHast(JSON.stringify(buttonRoot), fallbackToText(buttonFallback)),
      },
      fallback: buttonFallback,
    };

    // The standalone `useCode`/`useDemo` path renders without a
    // `CodeHighlighterClient`, so `context?.fallbacks` is undefined. The
    // render path still decodes via the variant's own `fallback`; copy must
    // too, instead of throwing on the dictionary-compressed payload.
    const files = collectVariantFiles(selectedVariant, undefined, undefined);

    expect(files).toEqual([{ name: 'a.js', source: 'const Button = 1;\nconst Checkbox = 2;' }]);
  });

  it('decodes an extra-file `hastCompressed` source from its `extraFiles` fallback when not hoisted', () => {
    const selectedVariant: VariantCode = {
      fileName: 'a.js',
      source: {
        hastCompressed: compressHast(JSON.stringify(buttonRoot), fallbackToText(buttonFallback)),
      },
      fallback: buttonFallback,
      extraFiles: {
        'b.js': {
          source: {
            hastCompressed: compressHast(JSON.stringify(utilsRoot), fallbackToText(utilsFallback)),
          },
          fallback: utilsFallback,
        },
      },
    };

    const files = collectVariantFiles(selectedVariant, undefined, undefined);

    expect(files).toEqual([
      { name: 'a.js', source: 'const Button = 1;\nconst Checkbox = 2;' },
      { name: 'b.js', source: 'export const myFunction = () => {};' },
    ]);
  });

  it('still resolves dictionaries from the passed fallbacks map (hoisted path)', () => {
    const selectedVariant: VariantCode = {
      fileName: 'a.js',
      source: {
        hastCompressed: compressHast(JSON.stringify(buttonRoot), fallbackToText(buttonFallback)),
      },
    };

    const files = collectVariantFiles(selectedVariant, undefined, { 'a.js': buttonFallback });

    expect(files).toEqual([{ name: 'a.js', source: 'const Button = 1;\nconst Checkbox = 2;' }]);
  });

  it('decodes a transformed file the transform left untouched (still hastCompressed) from its `originalName` fallback', () => {
    // A transform that only rewrote `a.js` passes `b.js` through as its original
    // `hastCompressed` source. Copy must still resolve `b.js`'s dictionary by
    // `originalName` instead of throwing on the un-decoded payload.
    const selectedVariant: VariantCode = {
      fileName: 'a.js',
      source: 'const Button = 1;\nconst Checkbox = 2;',
      extraFiles: {
        'b.js': {
          source: {
            hastCompressed: compressHast(JSON.stringify(utilsRoot), fallbackToText(utilsFallback)),
          },
          fallback: utilsFallback,
        },
      },
    };

    const transformedFiles = {
      files: [
        { name: 'a.js', originalName: 'a.js', source: 'const Button = 1;\nconst Checkbox = 2;' },
        {
          name: 'b.js',
          originalName: 'b.js',
          source: {
            hastCompressed: compressHast(JSON.stringify(utilsRoot), fallbackToText(utilsFallback)),
          },
        },
      ],
      filenameMap: { 'a.js': 'a.js', 'b.js': 'b.js' },
    };

    const files = collectVariantFiles(selectedVariant, transformedFiles, undefined);

    expect(files).toEqual([
      { name: 'a.js', source: 'const Button = 1;\nconst Checkbox = 2;' },
      { name: 'b.js', source: 'export const myFunction = () => {};' },
    ]);
  });
});
