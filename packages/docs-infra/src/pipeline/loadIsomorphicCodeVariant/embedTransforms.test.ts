import { describe, it, expect } from 'vitest';
import type { Delta } from 'jsondiffpatch';
import type { HastRoot, Transforms } from '../../CodeHighlighter/types';
import { embedTransformsInRoot, splitTransformsForEmbed } from './embedTransforms';

// A minimal "insert" delta in the jsondiffpatch wire format: a
// single-element tuple wrapping the inserted value. Typed once here
// so the tests can read naturally without per-call casts.
const insertedFoo: Delta = { foo: ['bar'] };

describe('splitTransformsForEmbed', () => {
  it('returns undefined when no entry has a delta or rename', () => {
    const transforms: Transforms = {
      noop: {},
    };
    expect(splitTransformsForEmbed(transforms)).toBeUndefined();
  });

  it('puts entries with a meaningful delta in both manifest and embedded', () => {
    const delta = insertedFoo;
    const transforms: Transforms = {
      jsx: { delta },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result).toBeDefined();
    expect(result!.embedded.jsx).toEqual({ delta });
    expect(result!.manifest.jsx).toEqual({ hasDelta: true });
    // The manifest entry must not carry the delta payload.
    expect(result!.manifest.jsx?.delta).toBeUndefined();
  });

  it('preserves comments on the manifest entry', () => {
    const transforms: Transforms = {
      jsx: {
        delta: insertedFoo,
        comments: { 1: ['// note'] },
      },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result!.manifest.jsx?.comments).toEqual({ 1: ['// note'] });
    // The embedded entry keeps the full transformValue, including comments.
    expect(result!.embedded.jsx?.comments).toEqual({ 1: ['// note'] });
  });

  it('treats a delta with no keys as not meaningful', () => {
    const transforms: Transforms = {
      jsx: { delta: {} },
    };
    expect(splitTransformsForEmbed(transforms)).toBeUndefined();
  });

  it('keeps rename-only entries in the manifest only, with hasDelta=false', () => {
    const transforms: Transforms = {
      rename: { fileName: 'new.tsx' },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result!.embedded).toEqual({});
    expect(result!.manifest.rename).toEqual({ fileName: 'new.tsx', hasDelta: false });
  });

  it('drops rename-only delta and resets hasDelta from the input', () => {
    const transforms: Transforms = {
      rename: {
        fileName: 'new.tsx',
        // Empty delta — falsy "hasMeaningfulDelta" — should still go through
        // the rename branch and the rename branch drops these fields.
        delta: {},
        hasDelta: true,
      },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result!.manifest.rename).toEqual({ fileName: 'new.tsx', hasDelta: false });
  });

  it('drops entries with neither a delta nor a rename', () => {
    const transforms: Transforms = {
      keep: { delta: insertedFoo },
      drop: { comments: { 1: ['// orphan'] } },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(Object.keys(result!.manifest)).toEqual(['keep']);
    expect(Object.keys(result!.embedded)).toEqual(['keep']);
  });
});

describe('embedTransformsInRoot', () => {
  it('writes embedded transforms into root.data.transforms', () => {
    const root: HastRoot = { type: 'root', children: [] };
    const embedded: Transforms = { jsx: { delta: insertedFoo } };
    embedTransformsInRoot(root, embedded);
    expect(root.data?.transforms).toEqual(embedded);
  });

  it('preserves existing root.data fields', () => {
    const root: HastRoot = {
      type: 'root',
      children: [],
      data: { totalLines: 5 },
    };
    const embedded: Transforms = { jsx: { delta: insertedFoo } };
    embedTransformsInRoot(root, embedded);
    expect(root.data?.totalLines).toBe(5);
    expect(root.data?.transforms).toEqual(embedded);
  });
});
