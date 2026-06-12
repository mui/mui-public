import { describe, it, expect, beforeEach } from 'vitest';
import {
  enhanceCodeEmphasisLazy,
  preloadCodeEmphasis,
  resetCodeEmphasisCache,
} from './enhanceCodeEmphasisLazy';
import { enhanceCodeEmphasis } from './enhanceCodeEmphasis';
import { shouldSkipEnhancer } from '../loadIsomorphicCodeVariant/runSourceEnhancers';
import type { HastRoot } from '../../CodeHighlighter/types';

beforeEach(() => {
  resetCodeEmphasisCache();
});

const makeRoot = (): HastRoot => ({ type: 'root', children: [] });

describe('enhanceCodeEmphasisLazy', () => {
  it('carries the same enhancerName as the eager enhancer (so precomputed HAST skips it)', () => {
    expect(enhanceCodeEmphasisLazy.enhancerName).toBe(enhanceCodeEmphasis.enhancerName);
  });

  it('is skipped when the HAST already recorded the emphasis enhancer (no chunk load)', () => {
    const root = {
      type: 'root',
      children: [],
      data: { appliedEnhancers: ['enhanceCodeEmphasis'] },
    } as HastRoot;
    expect(shouldSkipEnhancer(root, enhanceCodeEmphasisLazy)).toBe(true);
  });

  it('returns a promise on the first (cold) call and resolves to the enhanced root', async () => {
    const result = enhanceCodeEmphasisLazy(makeRoot(), undefined, 'test.tsx');
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual(await enhanceCodeEmphasis(makeRoot(), undefined, 'test.tsx'));
  });

  it('runs synchronously once warm (so live-edit re-enhancement does not flash)', async () => {
    await preloadCodeEmphasis();
    const result = enhanceCodeEmphasisLazy(makeRoot(), undefined, 'test.tsx');
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual(await enhanceCodeEmphasis(makeRoot(), undefined, 'test.tsx'));
  });
});
