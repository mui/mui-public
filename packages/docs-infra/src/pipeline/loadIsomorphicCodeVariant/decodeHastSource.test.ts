import { describe, it, expect } from 'vitest';
import { compressHast } from '../hastUtils';
import type { HastRoot } from '../../CodeHighlighter/types';
import { decodeHastSource } from './decodeHastSource';

const sampleRoot: HastRoot = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'text', value: 'hello' }],
    },
  ],
};

describe('decodeHastSource', () => {
  it('returns null for null or undefined', () => {
    expect(decodeHastSource(null)).toBeNull();
    expect(decodeHastSource(undefined)).toBeNull();
  });

  it('returns null for string sources', () => {
    expect(decodeHastSource('<pre>hello</pre>')).toBeNull();
  });

  it('parses a hastJson payload', () => {
    const source = { hastJson: JSON.stringify(sampleRoot) };
    const decoded = decodeHastSource(source);
    expect(decoded).toEqual(sampleRoot);
  });

  it('decompresses and parses a hastCompressed payload', () => {
    const source = { hastCompressed: compressHast(JSON.stringify(sampleRoot)) };
    const decoded = decodeHastSource(source);
    expect(decoded).toEqual(sampleRoot);
  });

  it('returns a live HastRoot unchanged', () => {
    const decoded = decodeHastSource(sampleRoot);
    expect(decoded).toBe(sampleRoot);
  });

  it('returns null for unrecognized object shapes', () => {
    const source = { somethingElse: 'value' } as unknown as { hastJson: string };
    expect(decodeHastSource(source)).toBeNull();
  });

  it('returns null when hastJson is malformed', () => {
    const source = { hastJson: '{not-valid-json' };
    expect(decodeHastSource(source)).toBeNull();
  });

  it('caches the decoded result by source identity (WeakMap)', () => {
    const source = { hastJson: JSON.stringify(sampleRoot) };
    const first = decodeHastSource(source);
    const second = decodeHastSource(source);
    expect(first).not.toBeNull();
    // Same identity on second call: WeakMap cache hit.
    expect(second).toBe(first);
  });

  it('does not share cache between distinct source objects with equal contents', () => {
    const sourceA = { hastJson: JSON.stringify(sampleRoot) };
    const sourceB = { hastJson: JSON.stringify(sampleRoot) };
    const decodedA = decodeHastSource(sourceA);
    const decodedB = decodeHastSource(sourceB);
    expect(decodedA).toEqual(decodedB);
    expect(decodedA).not.toBe(decodedB);
  });
});
