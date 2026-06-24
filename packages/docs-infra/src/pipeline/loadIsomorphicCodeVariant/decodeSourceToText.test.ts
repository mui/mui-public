import { describe, it, expect } from 'vitest';
import { compressHast } from '../hastUtils';
import { fallbackToText } from '../../CodeHighlighter/fallbackFormat';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import type { HastRoot } from '../../CodeHighlighter/types';
import { decodeSourceToText } from './decodeSourceToText';

const sampleRoot: HastRoot = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'text', value: ':root {\n  color: red;\n}\n' }],
    },
  ],
};

// The DEFLATE dictionary for a compressed source is the file's fallback text.
const sampleFallback: FallbackNode[] = [':root {\n  color: red;\n}\n'];
const sampleText = ':root {\n  color: red;\n}\n';

describe('decodeSourceToText', () => {
  it('returns a string source unchanged without needing a fallback', () => {
    expect(decodeSourceToText('export const value = 1;\n')).toBe('export const value = 1;\n');
  });

  it('resolves null / undefined sources to an empty string', () => {
    expect(decodeSourceToText(null)).toBe('');
    expect(decodeSourceToText(undefined)).toBe('');
  });

  it('decodes a hastJson source to its text', () => {
    expect(decodeSourceToText({ hastJson: JSON.stringify(sampleRoot) })).toBe(sampleText);
  });

  it('decodes a hastCompressed source using its co-located fallback dictionary', () => {
    const source = {
      hastCompressed: compressHast(JSON.stringify(sampleRoot), fallbackToText(sampleFallback)),
    };
    expect(decodeSourceToText(source, sampleFallback)).toBe(sampleText);
  });

  it('returns the text of a live HastRoot', () => {
    expect(decodeSourceToText(sampleRoot)).toBe(sampleText);
  });

  it('throws a descriptive dictionary error when a hastCompressed source is decoded without its fallback', () => {
    const source = {
      hastCompressed: compressHast(JSON.stringify(sampleRoot), fallbackToText(sampleFallback)),
    };
    // No `{"code":0}` — the message names the missing dictionary as the cause.
    expect(() => decodeSourceToText(source)).toThrow(/fallback dictionary/i);
  });

  it('reuses the shared decode cache for repeated calls on the same payload object', () => {
    const source = { hastJson: JSON.stringify(sampleRoot) };
    expect(decodeSourceToText(source)).toBe(sampleText);
    // A second call hits the WeakMap in `decodeHastSource` and yields the same text.
    expect(decodeSourceToText(source)).toBe(sampleText);
  });
});
