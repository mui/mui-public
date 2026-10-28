import { describe, it, expect } from 'vitest';
import type { ElementContent } from 'hast';
import { redistributeFrameFallbacks } from './redistributeFrameFallbacks';
import type { FrameFallback } from './redistributeFrameFallbacks';

/** Concatenate a node array into plain text for concise assertions. */
function text(nodes: ElementContent[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.value : '')).join('');
}

function textNode(value: string): ElementContent {
  return { type: 'text', value };
}

describe('redistributeFrameFallbacks', () => {
  // Three 2-line frames built like `addLineGutters`: every line keeps its
  // trailing newline except the final line of the source.
  const threeFrames: FrameFallback[] = [
    { startLine: 1, endLine: 2, nodes: [textNode('a\nb\n')] },
    { startLine: 3, endLine: 4, nodes: [textNode('c\nd\n')] },
    { startLine: 5, endLine: 6, nodes: [textNode('e\nf')] },
  ];

  it('reuses frame nodes by reference when ranges are unchanged', () => {
    const result = redistributeFrameFallbacks(threeFrames, [
      { startLine: 1, endLine: 2 },
      { startLine: 3, endLine: 4 },
      { startLine: 5, endLine: 6 },
    ]);

    expect(result.map(text)).toEqual(['a\nb\n', 'c\nd\n', 'e\nf']);
    // Whole-frame reuse must not clone the node objects.
    expect(result[0][0]).toBe(threeFrames[0].nodes[0]);
    expect(result[2][0]).toBe(threeFrames[2].nodes[0]);
  });

  it('shifts lines from the bottom of a frame into the next frame', () => {
    // Re-chunk into [1-3, 4-6]: line 3 moves up, line 4 moves down.
    const result = redistributeFrameFallbacks(threeFrames, [
      { startLine: 1, endLine: 3 },
      { startLine: 4, endLine: 6 },
    ]);

    expect(result.map(text)).toEqual(['a\nb\nc\n', 'd\ne\nf']);
  });

  it('shifts lines from the top of a frame into the previous frame', () => {
    // Re-chunk into [1-1, 2-5, 6-6].
    const result = redistributeFrameFallbacks(threeFrames, [
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 5 },
      { startLine: 6, endLine: 6 },
    ]);

    expect(result.map(text)).toEqual(['a\n', 'b\nc\nd\ne\n', 'f']);
  });

  it('merges several frames into one', () => {
    const result = redistributeFrameFallbacks(threeFrames, [{ startLine: 1, endLine: 6 }]);
    expect(result.map(text)).toEqual(['a\nb\nc\nd\ne\nf']);
  });

  it('splits a single frame into multiple frames', () => {
    const result = redistributeFrameFallbacks(threeFrames, [
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 2 },
      { startLine: 3, endLine: 3 },
      { startLine: 4, endLine: 4 },
      { startLine: 5, endLine: 5 },
      { startLine: 6, endLine: 6 },
    ]);
    expect(result.map(text)).toEqual(['a\n', 'b\n', 'c\n', 'd\n', 'e\n', 'f']);
  });

  it('discards text for lines dropped between ranges', () => {
    // Keep 1-2 and 5-6; lines 3-4 (whole middle frame) collapse away.
    const result = redistributeFrameFallbacks(threeFrames, [
      { startLine: 1, endLine: 2 },
      { startLine: 5, endLine: 6 },
    ]);
    expect(result.map(text)).toEqual(['a\nb\n', 'e\nf']);
  });

  it('supports multiple text nodes within a single frame fallback', () => {
    const frames: FrameFallback[] = [
      { startLine: 1, endLine: 3, nodes: [textNode('a\nb'), textNode('\nc\n')] },
    ];
    const result = redistributeFrameFallbacks(frames, [
      { startLine: 1, endLine: 2 },
      { startLine: 3, endLine: 3 },
    ]);
    expect(result.map(text)).toEqual(['a\nb\n', 'c\n']);
  });

  it('preserves the final line that has no trailing newline', () => {
    const result = redistributeFrameFallbacks(threeFrames, [
      { startLine: 1, endLine: 5 },
      { startLine: 6, endLine: 6 },
    ]);
    expect(result.map(text)).toEqual(['a\nb\nc\nd\ne\n', 'f']);
  });
});
