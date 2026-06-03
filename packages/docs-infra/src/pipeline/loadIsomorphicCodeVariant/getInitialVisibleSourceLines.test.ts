import { describe, it, expect } from 'vitest';
import type { Root, Element } from 'hast';
import { getInitialVisibleSourceLines } from './getInitialVisibleSourceLines';

function makeLine(): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: 'line' },
    children: [],
  };
}

function makeFrame(frameType: string | undefined, lineCount: number): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: {
      className: 'frame',
      ...(frameType !== undefined ? { dataFrameType: frameType } : {}),
    },
    children: Array.from({ length: lineCount }, () => makeLine()),
  };
}

function makeRoot(frames: Element[], data?: { focusedLines?: number }): Root {
  // `focusedLines` is an augmented field on the docs-infra HastRoot data, not
  // part of the base hast `RootData` — cast so the test can set it.
  return { type: 'root', children: frames, ...(data ? { data: data as Root['data'] } : {}) };
}

describe('getInitialVisibleSourceLines', () => {
  it('returns an empty set for a non-root node', () => {
    const text = { type: 'text', value: 'hi' } as const;
    expect(getInitialVisibleSourceLines(text)).toEqual(new Set());
  });

  it('returns an empty set for a root with no frame children', () => {
    const tree = makeRoot([]);
    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set());
  });

  it('collects lines from emphasis frames (highlighted, focus, padding-top, padding-bottom)', () => {
    const tree = makeRoot([
      makeFrame('context', 2), // lines 1,2 — hidden
      makeFrame('highlighted', 1), // line 3
      makeFrame('context', 1), // line 4 — hidden
      makeFrame('focus', 2), // lines 5,6
      makeFrame('padding-top', 1), // line 7
      makeFrame('padding-bottom', 1), // line 8
      makeFrame('context', 1), // line 9 — hidden
    ]);

    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set([3, 5, 6, 7, 8]));
  });

  it('falls back to the first frame when no emphasis frame is present', () => {
    const tree = makeRoot([
      makeFrame('context', 3), // lines 1,2,3 — fallback visible
      makeFrame('context', 2), // lines 4,5 — hidden
    ]);

    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set([1, 2, 3]));
  });

  it('falls back to the first frame when no frame has a data-frame-type at all', () => {
    const tree = makeRoot([makeFrame(undefined, 2), makeFrame(undefined, 2)]);

    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set([1, 2]));
  });

  it('returns an empty set when the block collapses to nothing (focusedLines === 0)', () => {
    // disableOversizedFocus path: every frame is hidden and the source records
    // focusedLines === 0. The first-frame fallback must NOT kick in — the
    // collapsed state is genuinely empty.
    const tree = makeRoot([makeFrame('highlighted-unfocused', 3), makeFrame('normal', 2)], {
      focusedLines: 0,
    });

    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set());
  });

  it('still falls back to the first frame when focusedLines is undefined', () => {
    // Trees produced before this field existed must keep the old behavior.
    const tree = makeRoot([makeFrame('normal', 2), makeFrame('normal', 2)]);

    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set([1, 2]));
  });

  it('ignores non-frame children and non-line grandchildren when counting lines', () => {
    const tree = makeRoot([
      // Non-frame: must not advance the line counter.
      {
        type: 'element',
        tagName: 'div',
        properties: { className: 'not-a-frame' },
        children: [makeLine()],
      },
      {
        type: 'element',
        tagName: 'div',
        properties: { className: 'frame', dataFrameType: 'highlighted' },
        children: [
          { type: 'text', value: 'noise' },
          makeLine(), // line 1
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'not-a-line' },
            children: [],
          },
          makeLine(), // line 2
        ],
      },
    ]);

    expect(getInitialVisibleSourceLines(tree)).toEqual(new Set([1, 2]));
  });
});
