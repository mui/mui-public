import { describe, it, expect } from 'vitest';
import { compressHast } from '../hastUtils';
import { fallbackToText, type FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import type { HastRoot } from '../../CodeHighlighter/types';
import { decodeHastSource } from './decodeHastSource';
import { decodeSource } from './decodeSource';

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

describe('decodeSource', () => {
  it('returns a string source unchanged without needing a fallback', () => {
    expect(decodeSource('export const value = 1;\n')).toBe('export const value = 1;\n');
  });

  it('decodes a hastJson source to a live HastRoot (not a serialized payload)', () => {
    const decoded = decodeSource({ hastJson: JSON.stringify(sampleRoot) });
    expect(decoded).toMatchObject({ type: 'root' });
    expect(decoded).not.toHaveProperty('hastJson');
    expect(decoded).toEqual(sampleRoot);
  });

  it('decodes a hastCompressed source to a live HastRoot using its fallback dictionary', () => {
    const source = {
      hastCompressed: compressHast(JSON.stringify(sampleRoot), fallbackToText(sampleFallback)),
    };
    const decoded = decodeSource(source, sampleFallback);
    expect(decoded).toMatchObject({ type: 'root' });
    expect(decoded).not.toHaveProperty('hastCompressed');
    expect(decoded).toEqual(sampleRoot);
  });

  it('throws a descriptive dictionary error when a hastCompressed source is decoded without its fallback', () => {
    const source = {
      hastCompressed: compressHast(JSON.stringify(sampleRoot), fallbackToText(sampleFallback)),
    };
    expect(() => decodeSource(source)).toThrow(/fallback dictionary/i);
  });

  it('returns an owned clone, not the shared read-only cache tree', () => {
    const source = { hastJson: JSON.stringify(sampleRoot) };
    const shared = decodeHastSource(source);
    const owned = decodeSource(source);
    // Same content, but a distinct object the caller can safely mutate.
    expect(owned).toEqual(shared);
    expect(owned).not.toBe(shared);

    if (owned && typeof owned === 'object' && 'children' in owned) {
      owned.children = [];
    }
    // Mutating the clone leaves the shared cache tree intact.
    expect(decodeHastSource(source)).toBe(shared);
    expect(shared).toEqual(sampleRoot);
  });
});
