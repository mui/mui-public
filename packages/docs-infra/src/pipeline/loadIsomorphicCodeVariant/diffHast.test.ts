import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import type { Nodes, Root as HastRoot, Element as HastElement } from 'hast';
import { diffHast } from './diffHast';
import { applyCodeTransform } from './applyCodeTransform';
import type { ParseSource, Transforms } from '../../CodeHighlighter/types';

describe('diffHast', () => {
  let mockParseSource: MockedFunction<ParseSource>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParseSource = vi.fn();
  });

  it('should handle empty transforms', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {};

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('should handle single transform with valid delta', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        fileName: 'test.ts',
      },
    };

    const transformedParsedSource: Nodes = {
      type: 'root',
      children: [],
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith(
      'const x = 1; // highlighted',
      'test.ts',
      undefined,
      undefined,
    );
    expect(result['syntax-highlight']).toBeDefined();
  });

  it('should fallback to main filename when transform fileName not provided', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        // No fileName provided - should fall back to main filename
      },
    };

    const transformedParsedSource: Nodes = {
      type: 'root',
      children: [],
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith(
      'const x = 1; // highlighted',
      'test.ts',
      undefined,
      undefined,
    );
    expect(result['syntax-highlight'].fileName).toBeUndefined();
  });

  it('forwards the transform comments map to parseSource', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transformComments = { 1: ['@focus'] };
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        fileName: 'test.ts',
        comments: transformComments,
      },
    };

    mockParseSource.mockResolvedValue({ type: 'root', children: [] });

    await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith(
      'const x = 1; // highlighted',
      'test.ts',
      undefined,
      transformComments,
    );
  });

  it('should handle parseSource errors', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        fileName: 'test.ts',
      },
    };

    mockParseSource.mockRejectedValue(new Error('Parse error'));

    await expect(
      diffHast(source, parsedSource, filename, transforms, mockParseSource),
    ).rejects.toThrow('Parse error');
  });

  it('passes through entries with no delta (rename-only)', async () => {
    // Manifest entries with no `delta` (e.g. a transformer that only
    // renames the file extension) reach `diffHast` from `transformSource`
    // and must round-trip without invoking `patch` — there's nothing to
    // diff at the HAST level.
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'rename-only': {
        fileName: 'test.js',
      },
    };

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);
    expect(result['rename-only']).toEqual({ fileName: 'test.js' });
    expect(result['rename-only'].delta).toBeUndefined();
    expect(mockParseSource).not.toHaveBeenCalled();
  });

  it('should collapse runs of wiped lines into a single collapse span', async () => {
    // Original has five non-empty lines; the transform wipes lines 2 and 3
    // and leaves the rest intact. The two consecutive wiped lines should
    // collapse into one placeholder span in the patched output.
    const source =
      'const a = 1;\nconst b: number = 2;\nconst c: string = "x";\nconst d = 4;\nconst e = 5;';
    const filename = 'test.ts';

    // addLineGutters convention: every `.line` is followed by a sibling
    // `\n` text node; empty lines are `<span.line></span>` with no children.
    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children:
        value === ''
          ? [{ type: 'text' as const, value: '\n' }]
          : [{ type: 'text' as const, value }],
    });

    const parsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 5 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: source }] } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'const b: number = 2;'),
            { type: 'text', value: '\n' },
            lineSpan(3, 'const c: string = "x";'),
            { type: 'text', value: '\n' },
            lineSpan(4, 'const d = 4;'),
            { type: 'text', value: '\n' },
            lineSpan(5, 'const e = 5;'),
          ],
        },
      ],
    };

    const transformedParsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 5 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: {
            fallback: [{ type: 'text', value: 'const a = 1;\n\n\nconst d = 4;\nconst e = 5;' }],
          } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, ''),
            lineSpan(3, ''),
            lineSpan(4, 'const d = 4;'),
            { type: 'text', value: '\n' },
            lineSpan(5, 'const e = 5;'),
          ],
        },
      ],
    };

    const transforms: Transforms = {
      'strip-types': {
        delta: {
          1: ['const b: number = 2;', ''],
          2: ['const c: string = "x";', ''],
          _t: 'a',
        } as any,
        fileName: 'test.js',
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    const patched = applyCodeTransform(
      parsedSource as any,
      { 'strip-types': { ...transforms['strip-types'], delta: deltas['strip-types'].delta } },
      'strip-types',
    ) as any;

    const frame = patched.children[0];
    // [line1, \n, placeholder, line4, \n, line5]
    expect(frame.children).toHaveLength(6);
    expect(frame.children[0].properties.className).toBe('line');
    expect(frame.children[1]).toEqual({ type: 'text', value: '\n' });
    expect(frame.children[2]).toEqual({
      type: 'element',
      tagName: 'span',
      properties: { className: 'collapse', dataLines: 2 },
      children: [
        { type: 'element', tagName: 'span', properties: {}, children: [] },
        { type: 'element', tagName: 'span', properties: {}, children: [] },
      ],
    });
    expect(frame.children[3].properties.className).toBe('line');
    expect(frame.children[4]).toEqual({ type: 'text', value: '\n' });
    expect(frame.children[5].properties.className).toBe('line');
    // Surviving line spans get renumbered sequentially.
    expect(frame.children[0].properties.dataLn).toBe(1);
    expect(frame.children[3].properties.dataLn).toBe(2);
    expect(frame.children[5].properties.dataLn).toBe(3);
  });

  it('emits a content-less fallback delete for rewritten frames', async () => {
    // The per-frame `data.fallback` text must never leak into the delta —
    // otherwise `patch` applies fallback operations against frames whose
    // fallback was regenerated (a different structure) and crashes with
    // "Cannot read properties of undefined". Instead, when a transform rewrites
    // a frame, the delta carries a *content-less delete* of that frame's
    // fallback; the applier regenerates it from the post-transform spans. This
    // checks both: the delta deletes (without embedding) the fallback, and
    // applying it to a decoded tree regenerates the frame's fallback.
    const source = 'const a = 1;\nconst b = 2;';
    const filename = 'test.ts';

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children: [{ type: 'text' as const, value }],
    });

    const parsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 2 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: source }] } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'const b = 2;'),
          ],
        },
      ],
    };

    const transformedParsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 2 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          // Deliberately different fallback text from the source frame.
          data: {
            fallback: [{ type: 'text', value: 'const a = 1; // changed\nconst b = 2;' }],
          } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1; // changed'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'const b = 2;'),
          ],
        },
      ],
    };

    const transforms: Transforms = {
      annotate: {
        delta: { 1: ['const a = 1;', 'const a = 1; // changed'], _t: 'a' } as any,
        fileName: 'test.ts',
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    // The fallback *text* must never appear in the delta (only a delete op).
    expect(JSON.stringify(deltas.annotate.delta)).not.toContain('const a = 1;\\nconst b = 2;');
    // The frame is rewritten, so the delta deletes its fallback. With
    // `omitRemovedValues`, a jsondiffpatch property delete is `[0, 0, 0]`.
    // The typed `Delta` union doesn't expose per-property indexing, so view the
    // object-delta structurally for the assertion.
    const annotateDelta = deltas.annotate.delta as unknown as {
      children: { [index: number]: { data: { fallback: unknown } } };
    };
    expect(annotateDelta.children[0].data.fallback).toEqual([0, 0, 0]);

    // Applying the delta to a decoded-style tree whose frame carries its
    // per-frame fallback must not crash, and must regenerate the fallback from
    // the post-transform spans.
    const decodedTree: HastRoot = {
      type: 'root',
      data: { totalLines: 2 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: {
            fallback: [{ type: 'text', value: source }],
          } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'const b = 2;'),
          ],
        },
      ],
    };

    const patched = applyCodeTransform(
      decodedTree as any,
      { annotate: { ...transforms.annotate, delta: deltas.annotate.delta } },
      'annotate',
    ) as any;

    const frame = patched.children[0];
    expect(frame.children[0].children[0].value).toBe('const a = 1; // changed');
    // The transform rewrote this frame, so the delta deleted the inherited
    // fallback and the applier regenerated it from the post-transform spans
    // (line text + the inter-line newline).
    expect(frame.data.fallback).toEqual([
      { type: 'text', value: 'const a = 1; // changed\nconst b = 2;' },
    ]);

    // The source tree keeps its fallback through diffing so downstream
    // `buildRootFallback` still sees it.
    expect((parsedSource.children[0] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: source },
    ]);
  });

  it('reconciles fallbacks by document position so a frame structure change cannot alias the wrong source frame', async () => {
    // A frame without a `data.fallback` (e.g. a structure-only frame produced
    // by `restructureFrames`) can sit between two fallback-bearing frames.
    // Reconciliation must pair each transform frame with the source frame at
    // the *same array position* — the identity `differ` matches on — rather
    // than walking a separate counter over only the fallback-bearing frames.
    // The old counter drifted here: it paired the second fallback-bearing
    // transform frame (`gamma`) against the *third* source frame, so it
    // spuriously deleted `gamma`'s fallback and let the middle frame inherit
    // an unrelated source frame's fallback — a stale carry-over.
    const source = 'alpha();\nbeta();\ngamma();';
    const filename = 'a.ts';

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children: [{ type: 'text' as const, value }],
    });

    // Source: middle frame deliberately carries NO `data.fallback`.
    const parsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 3 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: 'alpha();\n' }] } as HastElement['data'],
          children: [lineSpan(1, 'alpha();'), { type: 'text', value: '\n' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [lineSpan(2, 'beta();'), { type: 'text', value: '\n' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: 'gamma();' }] } as HastElement['data'],
          children: [lineSpan(3, 'gamma();')],
        },
      ],
    };

    // Transform leaves every frame's content untouched but the middle frame
    // now carries a fallback too (so the count of fallback-bearing frames
    // differs from the source — exactly what made the positional counter drift).
    const transformedParsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 3 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: 'alpha();\n' }] } as HastElement['data'],
          children: [lineSpan(1, 'alpha();'), { type: 'text', value: '\n' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: 'beta();\n' }] } as HastElement['data'],
          children: [lineSpan(2, 'beta();'), { type: 'text', value: '\n' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: 'gamma();' }] } as HastElement['data'],
          children: [lineSpan(3, 'gamma();')],
        },
      ],
    };

    const transforms: Transforms = {
      noop: { delta: { _t: 'a' } as any, fileName: 'a.ts' },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    // The last frame (`gamma`) is identical to its same-position source frame,
    // so its fallback must be aliased away — no fallback op at index 2. The
    // old positional counter mis-paired it and emitted a spurious delete here.
    const noopDelta = deltas.noop.delta as unknown as {
      children?: { [index: number]: { data?: { fallback?: unknown } } };
    };
    expect(noopDelta.children?.[2]?.data?.fallback).toBeUndefined();

    // No source frame's fallback text may leak into the delta — neither the
    // aliased-away `gamma` text nor the unrelated frame whose fallback the old
    // code carried over.
    expect(JSON.stringify(deltas.noop.delta ?? {})).not.toContain('gamma();');

    // Applying the delta back must leave every frame's fallback matching its
    // own post-transform content (regenerated where deleted, kept where
    // aliased) — never a stale fallback inherited from a different frame.
    const decodedTree: HastRoot = JSON.parse(JSON.stringify(parsedSource));
    const patched = applyCodeTransform(
      decodedTree as any,
      { noop: { ...transforms.noop, delta: deltas.noop.delta } },
      'noop',
    ) as any;

    expect(patched.children[0].data.fallback).toEqual([{ type: 'text', value: 'alpha();\n' }]);
    expect(patched.children[1].data.fallback).toEqual([{ type: 'text', value: 'beta();\n' }]);
    expect(patched.children[2].data.fallback).toEqual([{ type: 'text', value: 'gamma();' }]);
  });

  it('should not collapse lines that were already empty in the original source', async () => {
    const source = 'const a = 1;\n\nconst c = 3;';
    const filename = 'test.ts';
    const transforms: Transforms = {
      noop: {
        delta: { _t: 'a' } as any,
        fileName: 'test.ts',
      },
    };

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children:
        value === ''
          ? [{ type: 'text' as const, value: '\n' }]
          : [{ type: 'text' as const, value }],
    });

    const buildTree = (): any =>
      ({
        type: 'root',
        data: { totalLines: 3 } as any,
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'frame' },
            children: [
              lineSpan(1, 'const a = 1;'),
              { type: 'text', value: '\n' },
              lineSpan(2, ''),
              lineSpan(3, 'const c = 3;'),
            ],
          },
        ],
      }) as any;

    const parsedSource = buildTree();
    mockParseSource.mockResolvedValue(buildTree());

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    // Identical trees produce no diff at all (and therefore no collapse).
    const delta = deltas.noop.delta as any;
    if (delta) {
      const rootChildrenDelta = delta.children;
      if (rootChildrenDelta && typeof rootChildrenDelta === 'object') {
        for (const key of Object.keys(rootChildrenDelta)) {
          if (key === '_t') {
            continue;
          }
          const frameDelta = rootChildrenDelta[key];
          if (frameDelta && typeof frameDelta === 'object' && frameDelta.children) {
            // No frame-children rewrite should have happened.
            // eslint-disable-next-line no-underscore-dangle
            expect(frameDelta.children._t).toBeUndefined();
          }
        }
      }
    }
  });

  it('should preserve the collapsed-lines placeholder when the delta is patched onto the source', async () => {
    // End-to-end: build a real `parsedSource` matching addLineGutters'
    // output, run `diffHast` to produce the delta, then apply the delta
    // back via `applyCodeTransform` and assert the collapsed-lines
    // placeholder span survives the diff/patch round trip and renumbering.
    const source =
      'const a = 1;\nconst b: number = 2;\nconst c: string = "x";\nconst d = 4;\nconst e = 5;';
    const filename = 'test.ts';

    // Build line spans with nested syntax-highlighted tokens (matching what
    // a real highlighter emits) so the diff has to navigate non-trivial
    // children instead of a single text node.
    const tokenize = (text: string): any[] => {
      const tokens: any[] = [];
      const parts = text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) {
          continue;
        }
        if (/^\s+$/.test(part)) {
          tokens.push({ type: 'text', value: part });
        } else if (
          part === 'const' ||
          part === 'let' ||
          part === 'var' ||
          part === 'number' ||
          part === 'string'
        ) {
          tokens.push({
            type: 'element',
            tagName: 'span',
            properties: { className: 'pl-k' },
            children: [{ type: 'text', value: part }],
          });
        } else {
          tokens.push({ type: 'text', value: part });
        }
      }
      return tokens;
    };

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children: value === '\n' ? [{ type: 'text' as const, value: '\n' }] : tokenize(value),
    });

    const parsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 5 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: source }] } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'const b: number = 2;'),
            { type: 'text', value: '\n' },
            lineSpan(3, 'const c: string = "x";'),
            { type: 'text', value: '\n' },
            lineSpan(4, 'const d = 4;'),
            { type: 'text', value: '\n' },
            lineSpan(5, 'const e = 5;'),
          ],
        },
      ],
    };

    const transformedParsedSource: HastRoot = {
      type: 'root',
      data: { totalLines: 5 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: {
            fallback: [{ type: 'text', value: 'const a = 1;\n\n\nconst d = 4;\nconst e = 5;' }],
          } as HastElement['data'],
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, '\n'),
            lineSpan(3, '\n'),
            lineSpan(4, 'const d = 4;'),
            { type: 'text', value: '\n' },
            lineSpan(5, 'const e = 5;'),
          ],
        },
      ],
    };

    const transforms: Transforms = {
      'strip-types': {
        delta: {
          1: ['const b: number = 2;', ''],
          2: ['const c: string = "x";', ''],
          _t: 'a',
        } as any,
        fileName: 'test.js',
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    const patched = applyCodeTransform(
      parsedSource as any,
      { 'strip-types': { ...transforms['strip-types'], delta: deltas['strip-types'].delta } },
      'strip-types',
    ) as any;

    const patchedFrame = patched.children[0];
    const placeholders = patchedFrame.children.filter(
      (child: any) => child.type === 'element' && child.properties?.className === 'collapse',
    );
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].properties.dataLines).toBe(2);

    // Surviving lines were renumbered 1..N (no gaps where the wiped lines used to be).
    const lineNumbers = patchedFrame.children
      .filter((child: any) => child.properties?.className === 'line')
      .map((child: any) => child.properties.dataLn);
    expect(lineNumbers).toEqual([1, 2, 3]);

    // Same round trip through hastJson serialization (production path).
    const sourceWithEmbedded: any = JSON.parse(JSON.stringify(parsedSource));
    sourceWithEmbedded.data = {
      ...(sourceWithEmbedded.data || {}),
      transforms: {
        'strip-types': { delta: deltas['strip-types'].delta, fileName: 'test.js' },
      },
    };
    const hastJson = JSON.stringify(sourceWithEmbedded);
    const patchedFromJson = applyCodeTransform(
      { hastJson },
      { 'strip-types': { fileName: 'test.js' } },
      'strip-types',
    ) as any;
    const reparsedFrame = patchedFromJson.children[0];
    const reparsedPlaceholders = reparsedFrame.children.filter(
      (child: any) => child.type === 'element' && child.properties?.className === 'collapse',
    );
    expect(reparsedPlaceholders).toHaveLength(1);
    expect(reparsedPlaceholders[0].properties.dataLines).toBe(2);
  });

  it('should absorb a trailing empty line into the collapsed-lines placeholder', async () => {
    // Originally lines 2 and 3 are non-empty, line 4 is blank in the
    // source. The transform wipes lines 2 and 3, so the original blank
    // line 4 should be absorbed into the placeholder (count 3) rather
    // than left as a stray empty row.
    const source = 'const a = 1;\nconst b: number = 2;\nconst c: string = "x";\n\nconst e = 5;';
    const filename = 'test.ts';

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children:
        value === ''
          ? [{ type: 'text' as const, value: '\n' }]
          : [{ type: 'text' as const, value }],
    });

    const parsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 5 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'const b: number = 2;'),
            { type: 'text', value: '\n' },
            lineSpan(3, 'const c: string = "x";'),
            { type: 'text', value: '\n' },
            lineSpan(4, ''),
            lineSpan(5, 'const e = 5;'),
          ],
        },
      ],
    };

    const transformedParsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 5 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [
            lineSpan(1, 'const a = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, ''),
            lineSpan(3, ''),
            lineSpan(4, ''),
            lineSpan(5, 'const e = 5;'),
          ],
        },
      ],
    };

    const transforms: Transforms = {
      'strip-types': {
        delta: {
          1: ['const b: number = 2;', ''],
          2: ['const c: string = "x";', ''],
          _t: 'a',
        } as any,
        fileName: 'test.js',
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    const patched = applyCodeTransform(
      parsedSource as any,
      { 'strip-types': { ...transforms['strip-types'], delta: deltas['strip-types'].delta } },
      'strip-types',
    ) as any;

    const frame = patched.children[0];
    const placeholders = frame.children.filter(
      (child: any) => child.type === 'element' && child.properties?.className === 'collapse',
    );
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].properties.dataLines).toBe(3);

    const remainingLineNumbers = frame.children
      .filter((child: any) => child.properties?.className === 'line')
      .map((child: any) => child.properties.dataLn);
    expect(remainingLineNumbers).toEqual([1, 2]);
  });

  it('should preserve content edits on surviving lines in the same frame as a collapsed run', async () => {
    // The transform both edits line 1 (`const x: number = 1;` → `const x = 1;`)
    // AND wipes line 2 (`interface Props { name: string; }` → ``). Both
    // changes live in the same frame. Collapsing the wiped line must not
    // throw away jsondiffpatch's content edit for line 1.
    const source = 'const x: number = 1;\ninterface Props { name: string; }';
    const filename = 'test.ts';

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children:
        value === ''
          ? [{ type: 'text' as const, value: '\n' }]
          : [{ type: 'text' as const, value }],
    });

    const parsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 2 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [
            lineSpan(1, 'const x: number = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'interface Props { name: string; }'),
          ],
        },
      ],
    };

    // Real `addLineGutters` output for the transform string
    // `'const x = 1;\n'`: a single `.line` followed by a sibling `\n`.
    // The trailing blank is elided by the parser (no empty line span).
    const transformedParsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 1 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [lineSpan(1, 'const x = 1;'), { type: 'text', value: '\n' }],
        },
      ],
    };

    const transforms: Transforms = {
      'strip-types': {
        delta: {
          0: ['const x: number = 1;', 'const x = 1;'],
          1: ['interface Props { name: string; }', ''],
          _t: 'a',
        } as any,
        fileName: 'test.js',
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    const patched = applyCodeTransform(
      parsedSource as any,
      { 'strip-types': { ...transforms['strip-types'], delta: deltas['strip-types'].delta } },
      'strip-types',
    ) as any;

    const frame = patched.children[0];
    // Expected: [line1_edited, \n, placeholder]
    expect(frame.children).toHaveLength(3);
    expect(frame.children[0].properties.className).toBe('line');
    // The line 1 content edit must have been applied — `: number` stripped.
    const line1Text = frame.children[0].children
      .map((c: any) => (c.type === 'text' ? c.value : ''))
      .join('');
    expect(line1Text).toBe('const x = 1;');
    expect(frame.children[1]).toEqual({ type: 'text', value: '\n' });
    expect(frame.children[2]).toEqual({
      type: 'element',
      tagName: 'span',
      properties: { className: 'collapse', dataLines: 1 },
      children: [{ type: 'element', tagName: 'span', properties: {}, children: [] }],
    });
  });

  it('should append a placeholder when the transform parser elides a trailing wiped line', async () => {
    // Mirrors the real `addLineGutters` output for a transform like
    // `'const x = 1;\n'`: only one `.line` span is emitted, and the final
    // blank row is represented by the trailing `\n` text alone. The diff
    // must still produce a collapsed-lines placeholder for the wiped
    // source line 2.
    const source = 'const x: number = 1;\ninterface Props { name: string; }';
    const filename = 'test.ts';

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children:
        value === ''
          ? [{ type: 'text' as const, value: '\n' }]
          : [{ type: 'text' as const, value }],
    });

    const parsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 2 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [
            lineSpan(1, 'const x: number = 1;'),
            { type: 'text', value: '\n' },
            lineSpan(2, 'interface Props { name: string; }'),
          ],
        },
      ],
    };

    // Transform tree as `addLineGutters` actually emits it for
    // `'const x = 1;\n'`: a single `.line` followed by a sibling `\n`.
    // No span for the elided trailing blank line.
    const transformedParsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 1 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [lineSpan(1, 'const x = 1;'), { type: 'text', value: '\n' }],
        },
      ],
    };

    const transforms: Transforms = {
      'strip-types': {
        delta: {
          0: ['const x: number = 1;', 'const x = 1;'],
          1: ['interface Props { name: string; }', ''],
          _t: 'a',
        } as any,
        fileName: 'test.js',
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    const patched = applyCodeTransform(
      parsedSource as any,
      { 'strip-types': { ...transforms['strip-types'], delta: deltas['strip-types'].delta } },
      'strip-types',
    ) as any;

    const frame = patched.children[0];
    const placeholders = frame.children.filter(
      (child: any) => child.type === 'element' && child.properties?.className === 'collapse',
    );
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].properties.dataLines).toBe(1);
  });

  it('does not emit collapse placeholders when the transform inserts lines', async () => {
    // Regression: when a transform prepends new lines (e.g. a
    // `const API_KEY = '…';` constant plus a blank separator), the
    // shifted-down original lines no longer align positionally with the
    // patched output. The wiped-line scan must not interpret an
    // inserted blank as a wipe of the originally-non-blank line that
    // happens to share its index — doing so renders a spurious
    // `<span class="collapse" data-lines="1">` placeholder mid-frame.
    const source = "import { ApiClient } from './client';\n\nexport function App() {}";
    const filename = 'test.tsx';

    const lineSpan = (lineNumber: number, value: string) => ({
      type: 'element' as const,
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children:
        value === ''
          ? [{ type: 'text' as const, value: '\n' }]
          : [{ type: 'text' as const, value }],
    });

    const parsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 3 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [
            lineSpan(1, "import { ApiClient } from './client';"),
            { type: 'text', value: '\n' },
            lineSpan(2, ''),
            { type: 'text', value: '\n' },
            lineSpan(3, 'export function App() {}'),
          ],
        },
      ],
    };

    const transformedParsedSource: Nodes = {
      type: 'root',
      data: { totalLines: 5 } as any,
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          children: [
            lineSpan(1, "const API_KEY = 'abc';"),
            { type: 'text', value: '\n' },
            lineSpan(2, ''),
            { type: 'text', value: '\n' },
            lineSpan(3, "import { ApiClient } from './client';"),
            { type: 'text', value: '\n' },
            lineSpan(4, ''),
            { type: 'text', value: '\n' },
            lineSpan(5, 'export function App() {}'),
          ],
        },
      ],
    };

    const transforms: Transforms = {
      'with-key': {
        // Insert two lines at the top: `const API_KEY = 'abc';` and a
        // blank separator. The transformer marks both as expanding-added
        // so the wipe scan ignores them.
        delta: {
          0: ["const API_KEY = 'abc';"],
          1: [''],
          _t: 'a',
        } as any,
        fileName: 'test.tsx',
        comments: {
          1: ['@expanding'],
          2: ['@expanding'],
        },
      },
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const deltas = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    const patched = applyCodeTransform(
      parsedSource as any,
      { 'with-key': { ...transforms['with-key'], delta: deltas['with-key'].delta } },
      'with-key',
    ) as any;

    const frame = patched.children[0];
    const placeholders = frame.children.filter(
      (child: any) => child.type === 'element' && child.properties?.className === 'collapse',
    );
    expect(placeholders).toHaveLength(0);
  });
});
