import { describe, it, expect } from 'vitest';
import type { Delta } from 'jsondiffpatch';
import type { HastRoot, Transforms } from '../../CodeHighlighter/types';
import {
  deltaContainsCollapse,
  embedTransformsInRoot,
  splitTransformsForEmbed,
} from './embedTransforms';

// A minimal "insert" delta in the jsondiffpatch wire format: a
// single-element tuple wrapping the inserted value. Typed once here
// so the tests can read naturally without per-call casts.
const insertedFoo: Delta = { foo: ['bar'] };

describe('deltaContainsCollapse', () => {
  it('returns false for primitives, null, and undefined', () => {
    expect(deltaContainsCollapse(null)).toBe(false);
    expect(deltaContainsCollapse(undefined)).toBe(false);
    expect(deltaContainsCollapse(42)).toBe(false);
    expect(deltaContainsCollapse('collapse')).toBe(false);
  });

  it('returns true for a hast element with className "collapse"', () => {
    const delta = { type: 'element', properties: { className: 'collapse' } };
    expect(deltaContainsCollapse(delta)).toBe(true);
  });

  it('returns true when className is an array that includes "collapse"', () => {
    const delta = { type: 'element', properties: { className: ['line', 'collapse'] } };
    expect(deltaContainsCollapse(delta)).toBe(true);
  });

  it('returns false for an element without a collapse className', () => {
    const delta = { type: 'element', properties: { className: 'line' } };
    expect(deltaContainsCollapse(delta)).toBe(false);
  });

  it('walks into arrays (jsondiffpatch insert opcode)', () => {
    const delta = [{ type: 'element', properties: { className: 'collapse' } }];
    expect(deltaContainsCollapse(delta)).toBe(true);
  });

  it('walks into nested object values', () => {
    const delta = {
      children: {
        '0': [{ type: 'element', properties: { className: 'collapse' } }],
        _t: 'a',
      },
    };
    expect(deltaContainsCollapse(delta)).toBe(true);
  });

  it('returns false for a delta tree that contains no collapse marker', () => {
    const delta = {
      children: {
        '0': [{ type: 'element', properties: { className: 'highlighted' } }],
        _t: 'a',
      },
    };
    expect(deltaContainsCollapse(delta)).toBe(false);
  });
});

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
    expect(result!.manifest.jsx).toEqual({
      hasDelta: true,
      hasCollapse: false,
      hasCollapseInFocus: false,
    });
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

  it('detects collapse markers in the delta and sets hasCollapse', () => {
    const transforms: Transforms = {
      jsx: {
        delta: {
          children: [{ type: 'element', properties: { className: 'collapse' } }],
        },
      },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result!.manifest.jsx?.hasCollapse).toBe(true);
    expect(result!.manifest.jsx?.hasCollapseInFocus).toBe(true);
  });

  it('respects an explicit hasCollapse / hasCollapseInFocus from the input', () => {
    const transforms: Transforms = {
      jsx: {
        delta: insertedFoo,
        hasCollapse: true,
        hasCollapseInFocus: false,
      },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result!.manifest.jsx?.hasCollapse).toBe(true);
    expect(result!.manifest.jsx?.hasCollapseInFocus).toBe(false);
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
    expect(result!.manifest.rename).toEqual({
      fileName: 'new.tsx',
      hasDelta: false,
      hasCollapse: false,
      hasCollapseInFocus: false,
    });
  });

  it('drops rename-only fields delta/hasDelta/hasCollapse coming from the input', () => {
    const transforms: Transforms = {
      rename: {
        fileName: 'new.tsx',
        // Empty delta — falsy "hasMeaningfulDelta" — should still go through
        // the rename branch and the rename branch drops these fields.
        delta: {},
        hasDelta: true,
        hasCollapse: true,
        hasCollapseInFocus: true,
      },
    };
    const result = splitTransformsForEmbed(transforms);
    expect(result!.manifest.rename).toEqual({
      fileName: 'new.tsx',
      hasDelta: false,
      hasCollapse: false,
      hasCollapseInFocus: false,
    });
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
