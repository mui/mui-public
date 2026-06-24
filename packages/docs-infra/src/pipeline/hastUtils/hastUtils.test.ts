import { describe, it, expect } from 'vitest';
import type { Nodes as HastNodes } from 'hast';
import { stringOrHastToString } from './hastUtils';
import { compressHast } from './hastCompression';
import { fallbackToText } from './fallbackFormat';
import type { FallbackNode } from './fallbackFormat';

const sampleRoot: HastNodes = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [{ type: 'text', value: 'const a = 1;\nconst b = 2;' }],
    },
  ],
};

// The DEFLATE dictionary for a compressed source is the file's fallback text.
const fallback: FallbackNode[] = ['const a = 1;\nconst b = 2;'];

describe('stringOrHastToString', () => {
  it('returns a string source unchanged', () => {
    expect(stringOrHastToString('const a = 1;')).toBe('const a = 1;');
  });

  it('extracts text from a hastJson source', () => {
    expect(stringOrHastToString({ hastJson: JSON.stringify(sampleRoot) })).toBe(
      'const a = 1;\nconst b = 2;',
    );
  });

  it('decodes a dictionary-compressed source when given the fallback', () => {
    const source = {
      hastCompressed: compressHast(JSON.stringify(sampleRoot), fallbackToText(fallback)),
    };
    // The fallback supplies the DEFLATE dictionary the source was compressed with.
    expect(stringOrHastToString(source, fallback)).toBe('const a = 1;\nconst b = 2;');
  });

  it('throws on a dictionary-compressed source without the fallback', () => {
    const source = {
      hastCompressed: compressHast(JSON.stringify(sampleRoot), fallbackToText(fallback)),
    };
    // No dictionary → decompression fails its checksum. This is the gap that
    // made copy/edit/flatten throw on dictionary-compressed sources.
    expect(() => stringOrHastToString(source)).toThrow();
  });
});
