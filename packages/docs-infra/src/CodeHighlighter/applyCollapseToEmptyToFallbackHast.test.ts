import { describe, it, expect } from 'vitest';
import type { HastRoot } from './types';
import { applyCollapseToEmptyToFallbackHast } from './useCodeFallback';
import { fallbackToHast } from './fallbackFormat';
import type { FallbackNode } from './fallbackFormat';

function frame(frameType: string | undefined): HastRoot['children'][number] {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['frame'],
      ...(frameType !== undefined ? { dataFrameType: frameType } : {}),
    },
    children: [],
  };
}

function makeRoot(frameTypes: Array<string | undefined>): HastRoot {
  return {
    type: 'root',
    data: { totalLines: frameTypes.length, focusedLines: 3 },
    children: frameTypes.map(frame),
  };
}

describe('applyCollapseToEmptyToFallbackHast', () => {
  it('hides the raw-string fallback focus frame under collapse-to-empty', () => {
    // `sourceToFallback` wraps a raw string in a single focus frame (the
    // collapse-agnostic base). For collapse-to-empty that frame must be demoted
    // to its hidden variant at render time so the loading window is empty — not
    // the full source — exactly the `fallbackToHast` → rewrite path `useCodeFallback`
    // runs for a `collapseToEmpty` block.
    const fallback: FallbackNode[] = [
      ['span', 'frame', { dataFrameType: 'focus' }, 'const a = 1;\nconst b = 2;'],
    ];
    const root = fallbackToHast(fallback) as HastRoot;
    applyCollapseToEmptyToFallbackHast(root);

    const frameEl = root.children[0];
    expect(frameEl.type === 'element' ? frameEl.properties?.dataFrameType : undefined).toBe(
      'focus-unfocused',
    );
    expect(root.data?.focusedLines).toBe(0);
  });

  it('demotes every collapsed-visible frame type to a hidden variant', () => {
    const root = makeRoot(['focus', 'highlighted', 'padding-top', 'padding-bottom']);
    applyCollapseToEmptyToFallbackHast(root);

    const types = root.children.map((child) =>
      child.type === 'element' ? child.properties?.dataFrameType : undefined,
    );
    // focus/highlighted keep a hidden variant; padding becomes plain (no attr).
    expect(types).toEqual(['focus-unfocused', 'highlighted-unfocused', undefined, undefined]);
  });

  it('records focusedLines: 0 so the collapsed window is empty', () => {
    const root = makeRoot(['highlighted']);
    applyCollapseToEmptyToFallbackHast(root);
    expect(root.data?.focusedLines).toBe(0);
  });

  it('leaves already-hidden and normal frames untouched', () => {
    const root = makeRoot(['normal', 'highlighted-unfocused', undefined]);
    applyCollapseToEmptyToFallbackHast(root);

    const types = root.children.map((child) =>
      child.type === 'element' ? child.properties?.dataFrameType : undefined,
    );
    expect(types).toEqual(['normal', 'highlighted-unfocused', undefined]);
  });

  it('never leaves a collapsed-visible frame type behind', () => {
    const root = makeRoot(['focus', 'highlighted', 'padding-top', 'padding-bottom', 'normal']);
    applyCollapseToEmptyToFallbackHast(root);

    for (const child of root.children) {
      const type = child.type === 'element' ? child.properties?.dataFrameType : undefined;
      expect(type === 'focus' || type === 'highlighted').toBe(false);
      expect(type === 'padding-top' || type === 'padding-bottom').toBe(false);
    }
  });
});
