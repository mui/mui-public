import { describe, it, expect } from 'vitest';
import type { Code, VariantCode } from '../../CodeHighlighter/types';
import { getAvailableTransforms } from './getAvailableTransforms';

const createVariantCode = (overrides: Partial<VariantCode> = {}): VariantCode => ({
  fileName: 'test.js',
  url: '/demo',
  ...overrides,
});

describe('getAvailableTransforms', () => {
  it('should return transform keys from a variant', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: {
          transform1: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' },
          transform2: { delta: { 1: ['old2', 'new2'] }, fileName: 'test2.js' },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['transform1', 'transform2']);
  });

  it('should return empty array for variant without transforms', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        // No transforms
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual([]);
  });

  it('should return empty array for non-existent variant', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: { transform1: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'NonExistent');

    expect(transforms).toEqual([]);
  });

  it('should return empty array for undefined parsedCode', () => {
    const transforms = getAvailableTransforms(undefined, 'Default');

    expect(transforms).toEqual([]);
  });

  it('returns only keys whose manifest entry produced a meaningful delta', () => {
    // `getAvailableTransforms` controls toggle visibility in the UI: it
    // must skip rename-only manifest entries (`hasDelta: false`, no
    // inline `delta`) so the toggle stays hidden when nothing about
    // the source actually changes. Entries that still carry an inline
    // `delta` (legacy / pre-split callers) and entries with the explicit
    // `hasDelta: true` flag are both surfaced.
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: {
          transformWithDelta: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' },
          manifestWithHasDelta: { fileName: 'test.js', hasDelta: true },
          renameOnly: { fileName: 'test.js', hasDelta: false },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['transformWithDelta', 'manifestWithHasDelta']);
  });

  it('skips rename-only manifest entries inside extraFiles', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        extraFiles: {
          'utils.js': {
            source: 'utils code',
            transforms: {
              validTransform: { delta: { 0: ['old', 'new'] }, fileName: 'utils.js' },
              renameOnly: { fileName: 'utils.js', hasDelta: false },
            },
          },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['validTransform']);
  });

  it('surfaces a transform when only an extraFile carries the delta', () => {
    // Mirrors the precomputed wire shape: main file's manifest entry for
    // the transform is rename-only (`hasDelta: false`) because the main
    // file's content didn't change, but an extraFile's manifest entry
    // carries `hasDelta: true`. The toggle must still be visible so the
    // user can apply the transform to the extraFile.
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: {
          js: { fileName: 'test.js', hasDelta: false },
        },
        extraFiles: {
          'utils.ts': {
            source: 'utils code',
            transforms: {
              js: { fileName: 'utils.js', hasDelta: true },
            },
          },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['js']);
  });

  it('surfaces a transform that exists only on an extraFile (not on main)', () => {
    // The main file has no manifest entry at all for `js`; only the
    // extraFile does. The toggle must still appear.
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        extraFiles: {
          'utils.ts': {
            source: 'utils code',
            transforms: {
              js: { fileName: 'utils.js', hasDelta: true },
            },
          },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['js']);
  });
});
