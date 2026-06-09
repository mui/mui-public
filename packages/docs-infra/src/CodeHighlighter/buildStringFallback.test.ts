import { describe, it, expect } from 'vitest';
import type { Element } from 'hast';
import type { SourceEnhancer } from './types';
import {
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
} from '../pipeline/enhanceCodeEmphasis';
import { parseImportsAndComments } from '../pipeline/loaderUtils';
import { isFrameSpan } from '../pipeline/parseSource/isFrameSpan';
import { fallbackToHast } from './fallbackFormat';
import { buildStringFallback } from './buildStringFallback';

/**
 * `buildStringFallback` is the inline analog of the loader's deferred fallback: it
 * runs the live render's `sourceEnhancers` over a cheap line-guttered HAST so a
 * plain-string source paints the *windowed* fallback (focus/highlight window +
 * hidden overflow) before hydration, instead of one un-windowed focus frame. It
 * also surfaces the `root.data` counts the compact fallback can't preserve.
 */
describe('buildStringFallback', () => {
  it('windows an oversized source into a focus window + hidden overflow with matching counts', () => {
    const source = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join(
      '\n',
    );

    const result = buildStringFallback(source, undefined, 'test.ts', [
      createEnhanceCodeEmphasis({ focusFramesMaxSize: 12 }),
    ]);

    expect(result).toBeDefined();
    expect(result!.totalLines).toBe(30);
    expect(result!.focusedLines).toBe(12);
    expect(result!.collapsible).toBe(true);

    // The fallback carries the same frame shape the live render would: a truncated
    // focus window plus a hidden (normal) overflow — not one giant focus frame.
    const frames = fallbackToHast(result!.fallback).children.filter(
      (child): child is Element => child.type === 'element' && isFrameSpan(child),
    );
    const focus = frames.find((frame) => frame.properties?.dataFrameType === 'focus');
    const overflow = frames.find((frame) => frame.properties?.dataFrameType === undefined);
    expect(focus?.properties?.dataFrameTruncated).toBe('visible');
    expect(overflow).toBeDefined();
  });

  it('emits a single non-collapsible frame (focusedLines === totalLines) for a small source with no directives', () => {
    const result = buildStringFallback('const a = 1;\nconst b = 2;', undefined, 'test.ts', [
      createEnhanceCodeEmphasis({}),
    ]);

    expect(result).toBeDefined();
    expect(result!.totalLines).toBe(2);
    // Nothing is hidden, so the whole source is the focused window — not collapsible.
    expect(result!.focusedLines).toBe(2);
    expect(result!.collapsible).toBe(false);
  });

  it('windows a source with @highlight directives (no focusFramesMaxSize) — the demo flow', async () => {
    // Mirrors the inline collapsible demo: a raw string with `@highlight` comments,
    // extracted via `parseImportsAndComments`, then enhanced with only
    // `paddingFrameMaxSize` (no `focusFramesMaxSize`). The highlighted region becomes
    // the visible window, and the enhancer marks the block collapsible.
    const rawSource = `function Component() {
  const a = 1;
  const b = 2;
  const c = 3;
  // @highlight-start
  const target = a + b + c;
  // @highlight-end
  const d = 4;
  const e = 5;
  const f = 6;
  return target;
}`;
    const { code, comments } = await parseImportsAndComments(rawSource, '/demo.tsx', {
      removeCommentsWithPrefix: [EMPHASIS_COMMENT_PREFIX],
      notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX],
    });

    // `parseImportsAndComments` already emits 1-indexed comments (the `Code` convention),
    // which `buildStringFallback` passes straight to the enhancer — just like the demo.
    const result = buildStringFallback(code!, comments, 'test.tsx', [
      createEnhanceCodeEmphasis({ paddingFrameMaxSize: 2 }),
    ]);

    expect(result).toBeDefined();
    expect(result!.focusedLines).toBeGreaterThan(0);
    expect(result!.focusedLines).toBeLessThan(result!.totalLines);
    expect(result!.collapsible).toBe(true);
  });

  it('passes Code comments to enhancers without shifting their line numbers', () => {
    const seenComments: Array<Parameters<SourceEnhancer>[1]> = [];
    const commentAwareEnhancer: SourceEnhancer = (root, comments) => {
      seenComments.push(comments);
      root.data = {
        ...root.data,
        focusedLines: comments?.[2]?.includes('@focus') ? 1 : 0,
      };
      return root;
    };

    const result = buildStringFallback(
      'const a = 1;\nconst b = 2;\nconst c = 3;',
      {
        2: ['@focus'],
      },
      'test.ts',
      [commentAwareEnhancer],
    );

    expect(seenComments[0]?.[2]).toEqual(['@focus']);
    expect(seenComments[0]?.[3]).toBeUndefined();
    expect(result).toMatchObject({ totalLines: 3, focusedLines: 1, collapsible: false });
  });

  it('bails to undefined when an enhancer is async (cannot resolve synchronously at prep time)', () => {
    const asyncEnhancer: SourceEnhancer = async (root) => root;

    const result = buildStringFallback('const a = 1;', undefined, 'test.ts', [asyncEnhancer]);

    expect(result).toBeUndefined();
  });
});
