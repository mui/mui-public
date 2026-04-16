import { describe, it, expect } from 'vitest';
import type { EmphasisMeta, FrameRange } from './calculateFrameRanges';
import { calculateFrameRanges, DEFAULT_FOCUS_FRAMES_MAX_SIZE } from './calculateFrameRanges';

describe('calculateFrameRanges', () => {
  describe('basic reframing', () => {
    it('should split a single highlighted line in the middle', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [10, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 9, type: 'normal' },
        { startLine: 10, endLine: 10, type: 'highlighted', regionIndex: 0 },
        { startLine: 11, endLine: 20, type: 'normal' },
      ]);
    });

    it('should handle highlight at line 1', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [1, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 5);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 1, type: 'highlighted', regionIndex: 0 },
        { startLine: 2, endLine: 5, type: 'normal' },
      ]);
    });

    it('should handle highlight at last line', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 5);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'highlighted', regionIndex: 0 },
      ]);
    });

    it('should handle entire code highlighted', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [1, { position: 'start', lineHighlight: true }],
        [2, { lineHighlight: true }],
        [3, { position: 'end', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 3);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 3, type: 'highlighted', regionIndex: 0 },
      ]);
    });

    it('should handle a multiline highlight region', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'start', lineHighlight: true }],
        [6, { lineHighlight: true }],
        [7, { position: 'end', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 7, type: 'highlighted', regionIndex: 0 },
        { startLine: 8, endLine: 10, type: 'normal' },
      ]);
    });

    it('should handle multiple disjoint highlight regions', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
        [8, { position: 'start', lineHighlight: true }],
        [9, { position: 'end', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 3, type: 'highlighted', regionIndex: 0 },
        { startLine: 4, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 9, type: 'highlighted-unfocused', regionIndex: 1 },
        { startLine: 10, endLine: 12, type: 'normal' },
      ]);
    });

    it('should handle adjacent highlight regions', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
        [4, { position: 'single', lineHighlight: true }],
      ]);

      // These are consecutive lines, so they form one region
      const result = calculateFrameRanges(emphasizedLines, 6);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'highlighted', regionIndex: 0 },
        { startLine: 5, endLine: 6, type: 'normal' },
      ]);
    });
  });

  describe('padding frames', () => {
    it('should add padding around the focused region', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [10, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted', regionIndex: 0 },
        { startLine: 11, endLine: 15, type: 'padding-bottom' },
        { startLine: 16, endLine: 20, type: 'normal' },
      ]);
    });

    it('should clamp padding to available lines before the highlight', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
      });

      // Only 2 lines before highlight (1,2), so padding-top is 2 lines, no normal before
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted', regionIndex: 0 },
        { startLine: 4, endLine: 8, type: 'padding-bottom' },
        { startLine: 9, endLine: 20, type: 'normal' },
      ]);
    });

    it('should clamp padding to available lines after the highlight', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [18, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
      });

      // Only 2 lines after highlight (19,20), so padding-bottom is 2 lines, no normal after
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 12, type: 'normal' },
        { startLine: 13, endLine: 17, type: 'padding-top' },
        { startLine: 18, endLine: 18, type: 'highlighted', regionIndex: 0 },
        { startLine: 19, endLine: 20, type: 'padding-bottom' },
      ]);
    });

    it('should only add padding to the first (focused) region', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
        [15, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 2,
      });

      // First region gets padding, second does not
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted', regionIndex: 0 },
        { startLine: 4, endLine: 5, type: 'padding-bottom' },
        { startLine: 6, endLine: 14, type: 'normal' },
        { startLine: 15, endLine: 15, type: 'highlighted-unfocused', regionIndex: 1 },
        { startLine: 16, endLine: 20, type: 'normal' },
      ]);
    });
  });

  describe('focusFramesMaxSize', () => {
    it('should constrain focus area to focusFramesMaxSize', () => {
      // Line 10 highlighted, paddingFrameMaxSize=5, focusFramesMaxSize=8
      // remaining = 8 - 1 = 7, paddingTop = floor(7/2) = 3, paddingBottom = ceil(7/2) = 4
      // Both capped by paddingFrameMaxSize=5, so: paddingTop=3, paddingBottom=4
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [10, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
        focusFramesMaxSize: 8,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 6, type: 'normal' },
        { startLine: 7, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted', regionIndex: 0 },
        { startLine: 11, endLine: 14, type: 'padding-bottom' },
        { startLine: 15, endLine: 20, type: 'normal' },
      ]);
    });

    it('should split oversized focused region from the start', () => {
      // Highlight spans 5 lines (5-9) but focusFramesMaxSize is 3
      // focusStart = 5, focusEnd = 5 + 3 - 1 = 7
      // unfocused-bottom: 8-9 (2 lines)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'start', lineHighlight: true }],
        [6, { lineHighlight: true }],
        [7, { lineHighlight: true }],
        [8, { lineHighlight: true }],
        [9, { position: 'end', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 15, {
        paddingFrameMaxSize: 5,
        focusFramesMaxSize: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 7, type: 'highlighted', regionIndex: 0, truncated: 'visible' },
        {
          startLine: 8,
          endLine: 9,
          type: 'highlighted-unfocused',
          regionIndex: 0,
          truncated: 'hidden',
        },
        { startLine: 10, endLine: 15, type: 'normal' },
      ]);
    });

    it('should give extra line to padding-bottom when odd remainder', () => {
      // Line 10 highlighted, focusFramesMaxSize=6
      // remaining = 6 - 1 = 5, paddingTop = floor(5/2) = 2, paddingBottom = ceil(5/2) = 3
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [10, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
        focusFramesMaxSize: 6,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted', regionIndex: 0 },
        { startLine: 11, endLine: 13, type: 'padding-bottom' },
        { startLine: 14, endLine: 20, type: 'normal' },
      ]);
    });

    it('should put all overflow at the bottom', () => {
      // Highlight spans 6 lines (5-10), focusFramesMaxSize=3
      // focusStart = 5, focusEnd = 5 + 3 - 1 = 7
      // unfocused-bottom: 8-10 (3 lines)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'start', lineHighlight: true }],
        [6, { lineHighlight: true }],
        [7, { lineHighlight: true }],
        [8, { lineHighlight: true }],
        [9, { lineHighlight: true }],
        [10, { position: 'end', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 15, {
        focusFramesMaxSize: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 7, type: 'highlighted', regionIndex: 0, truncated: 'visible' },
        {
          startLine: 8,
          endLine: 10,
          type: 'highlighted-unfocused',
          regionIndex: 0,
          truncated: 'hidden',
        },
        { startLine: 11, endLine: 15, type: 'normal' },
      ]);
    });

    it('should split oversized focus-only region from the start', () => {
      // Focus-only region (lineHighlight: false) spans 7 lines (3-9), focusFramesMaxSize=3
      // focusStart = 3, focusEnd = 3 + 3 - 1 = 5
      // unfocused-bottom: 6-9 (4 lines)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { lineHighlight: false }],
        [4, { lineHighlight: false }],
        [5, { lineHighlight: false }],
        [6, { lineHighlight: false }],
        [7, { lineHighlight: false }],
        [8, { lineHighlight: false }],
        [9, { lineHighlight: false }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        focusFramesMaxSize: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 5, type: 'focus', regionIndex: 0, truncated: 'visible' },
        { startLine: 6, endLine: 9, type: 'focus-unfocused', regionIndex: 0, truncated: 'hidden' },
        { startLine: 10, endLine: 12, type: 'normal' },
      ]);
    });

    it('should not split when region equals focusFramesMaxSize', () => {
      // Region is exactly 3 lines, focusFramesMaxSize=3 → no split
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'start', lineHighlight: true }],
        [6, { lineHighlight: true }],
        [7, { position: 'end', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10, {
        focusFramesMaxSize: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 7, type: 'highlighted', regionIndex: 0 },
        { startLine: 8, endLine: 10, type: 'normal' },
      ]);
    });

    it('should respect paddingFrameMaxSize even within focusFramesMaxSize', () => {
      // Line 10 highlighted, paddingFrameMaxSize=2, focusFramesMaxSize=20
      // remaining = 20 - 1 = 19, paddingTop = floor(19/2) = 9 → capped at 2
      // paddingBottom = ceil(19/2) = 10 → capped at 2
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [10, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 2,
        focusFramesMaxSize: 20,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted', regionIndex: 0 },
        { startLine: 11, endLine: 12, type: 'padding-bottom' },
        { startLine: 13, endLine: 20, type: 'normal' },
      ]);
    });

    it('should prefer per-region focusFramesMaxSize over global option', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { lineHighlight: true, focus: true, focusFramesMaxSize: 2 }],
        [6, { lineHighlight: true, focus: true, focusFramesMaxSize: 2 }],
        [7, { lineHighlight: true, focus: true, focusFramesMaxSize: 2 }],
        [8, { lineHighlight: true, focus: true, focusFramesMaxSize: 2 }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10, {
        focusFramesMaxSize: 6,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 6, type: 'highlighted', regionIndex: 0, truncated: 'visible' },
        {
          startLine: 7,
          endLine: 8,
          type: 'highlighted-unfocused',
          regionIndex: 0,
          truncated: 'hidden',
        },
        { startLine: 9, endLine: 10, type: 'normal' },
      ]);
    });

    it('should use focus directive padding when earlier highlight has conflicting padding', () => {
      // Line 5: highlight with padding 1, line 6: focus with padding 4
      // Focus directive's padding should win for the region
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { lineHighlight: true, paddingFrameMaxSize: 1 }],
        [6, { lineHighlight: true, focus: true, paddingFrameMaxSize: 4 }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 15, {
        paddingFrameMaxSize: 2,
      });

      // Region spans lines 5-6, focused. Focus directive says padding 4.
      // padding-top: lines 1-4 (4 lines), padding-bottom: lines 7-10 (4 lines)
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 6, type: 'highlighted', regionIndex: 0 },
        { startLine: 7, endLine: 10, type: 'padding-bottom' },
        { startLine: 11, endLine: 15, type: 'normal' },
      ]);
    });

    it('should use focus directive focusFramesMaxSize when earlier highlight has conflicting override', () => {
      // Line 5: highlight with @min 10, line 6: focus with @min 2
      // Focus directive's @min should win for the region
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { lineHighlight: true, focusFramesMaxSize: 10 }],
        [6, { lineHighlight: true, focus: true, focusFramesMaxSize: 2 }],
        [7, { lineHighlight: true, focus: true }],
        [8, { lineHighlight: true, focus: true }],
        [9, { lineHighlight: true, focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        focusFramesMaxSize: 6,
      });

      // Region spans lines 5-9 (5 lines). Focus @min 2 applies, so
      // visible window = 2 lines (5-6), hidden overflow = 3 lines (7-9)
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 6, type: 'highlighted', regionIndex: 0, truncated: 'visible' },
        {
          startLine: 7,
          endLine: 9,
          type: 'highlighted-unfocused',
          regionIndex: 0,
          truncated: 'hidden',
        },
        { startLine: 10, endLine: 12, type: 'normal' },
      ]);
    });

    it('should keep first focus-line padding when later propagated-focus lines carry different overrides', () => {
      // All lines have focus=true (propagated from @focus-start) but carry
      // different paddingFrameMaxSize values (e.g. an inner @highlight).
      // The first override in the focus channel should be kept.
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { lineHighlight: false, focus: true, paddingFrameMaxSize: 4 }],
        [6, { lineHighlight: true, focus: true, paddingFrameMaxSize: 1 }],
        [7, { lineHighlight: false, focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 15, {
        paddingFrameMaxSize: 2,
      });

      // padding 4 from line 5 (first focus override) should win
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 7, type: 'focus', regionIndex: 0 },
        { startLine: 8, endLine: 11, type: 'padding-bottom' },
        { startLine: 12, endLine: 15, type: 'normal' },
      ]);
    });

    it('should keep first focus-line focusMaxSize when later propagated-focus lines carry different overrides', () => {
      // Similar to above but for focusFramesMaxSize
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { lineHighlight: true, focus: true, focusFramesMaxSize: 3 }],
        [6, { lineHighlight: true, focus: true, focusFramesMaxSize: 10 }],
        [7, { lineHighlight: true, focus: true }],
        [8, { lineHighlight: true, focus: true }],
        [9, { lineHighlight: true, focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        focusFramesMaxSize: 6,
      });

      // focusMaxSize 3 from line 5 (first focus override) should win,
      // splitting the 5-line region into visible 5-7 and hidden 8-9
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 7, type: 'highlighted', regionIndex: 0, truncated: 'visible' },
        {
          startLine: 8,
          endLine: 9,
          type: 'highlighted-unfocused',
          regionIndex: 0,
          truncated: 'hidden',
        },
        { startLine: 10, endLine: 12, type: 'normal' },
      ]);
    });

    it('should prefer non-focus override when no focus line carries an override', () => {
      // Mixed region: highlight lines without focus carry an override,
      // focus lines have no override. The non-focus override should be used.
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { lineHighlight: true, paddingFrameMaxSize: 3 }],
        [6, { lineHighlight: false, focus: true }],
        [7, { lineHighlight: false, focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        paddingFrameMaxSize: 1,
      });

      // padding 3 from the non-focus highlight on line 5
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 1, type: 'normal' },
        { startLine: 2, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 7, type: 'focus', regionIndex: 0 },
        { startLine: 8, endLine: 10, type: 'padding-bottom' },
        { startLine: 11, endLine: 12, type: 'normal' },
      ]);
    });

    it('should use inner explicit focus padding over propagated focus-start padding', () => {
      // Simulates @focus-start @padding 4 wrapping @focus @padding 2.
      // All lines carry focus=true; lines 5 and 7 are propagated from the
      // range while line 6 is an explicit per-line directive.
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [
          5,
          { lineHighlight: false, focus: true, paddingFrameMaxSize: 4, propagatedOverride: true },
        ],
        [6, { lineHighlight: false, focus: true, paddingFrameMaxSize: 2 }],
        [
          7,
          { lineHighlight: false, focus: true, paddingFrameMaxSize: 4, propagatedOverride: true },
        ],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 15, {
        paddingFrameMaxSize: 1,
      });

      // Explicit @focus @padding 2 on line 6 should override propagated padding 4
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 7, type: 'focus', regionIndex: 0 },
        { startLine: 8, endLine: 9, type: 'padding-bottom' },
        { startLine: 10, endLine: 15, type: 'normal' },
      ]);
    });
  });

  describe('auto-focus (no directives)', () => {
    it('should auto-focus from line 1 when focusFramesMaxSize is set and code exceeds it', () => {
      const result = calculateFrameRanges(new Map(), 10, {
        focusFramesMaxSize: 4,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'focus', regionIndex: 0, truncated: 'visible' },
        { startLine: 5, endLine: 10, type: 'normal' },
      ]);
    });

    it('should create focus frame without truncation when code fits within focusFramesMaxSize', () => {
      const result = calculateFrameRanges(new Map(), 5, {
        focusFramesMaxSize: 8,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 5, type: 'focus', regionIndex: 0 },
      ]);
    });

    it('should create focus frame without truncation when code equals focusFramesMaxSize', () => {
      const result = calculateFrameRanges(new Map(), 8, {
        focusFramesMaxSize: 8,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 8, type: 'focus', regionIndex: 0 },
      ]);
    });

    it('should use the default focusFramesMaxSize when it is not set', () => {
      const result = calculateFrameRanges(new Map(), DEFAULT_FOCUS_FRAMES_MAX_SIZE + 3, {});

      expect(result).toEqual<FrameRange[]>([
        {
          startLine: 1,
          endLine: DEFAULT_FOCUS_FRAMES_MAX_SIZE,
          type: 'focus',
          regionIndex: 0,
          truncated: 'visible',
        },
        {
          startLine: DEFAULT_FOCUS_FRAMES_MAX_SIZE + 1,
          endLine: DEFAULT_FOCUS_FRAMES_MAX_SIZE + 3,
          type: 'normal',
        },
      ]);
    });
  });

  describe('input validation', () => {
    const emphasizedLines = new Map<number, EmphasisMeta>([
      [3, { position: 'single', lineHighlight: true }],
    ]);

    it('should throw for focusFramesMaxSize = 0', () => {
      expect(() => calculateFrameRanges(emphasizedLines, 10, { focusFramesMaxSize: 0 })).toThrow(
        'focusFramesMaxSize must be a finite number >= 1, got 0',
      );
    });

    it('should throw for negative focusFramesMaxSize', () => {
      expect(() => calculateFrameRanges(emphasizedLines, 10, { focusFramesMaxSize: -5 })).toThrow(
        'focusFramesMaxSize must be a finite number >= 1, got -5',
      );
    });

    it('should throw for NaN focusFramesMaxSize', () => {
      expect(() => calculateFrameRanges(emphasizedLines, 10, { focusFramesMaxSize: NaN })).toThrow(
        'focusFramesMaxSize must be a finite number >= 1, got NaN',
      );
    });

    it('should throw for Infinity focusFramesMaxSize', () => {
      expect(() =>
        calculateFrameRanges(emphasizedLines, 10, { focusFramesMaxSize: Infinity }),
      ).toThrow('focusFramesMaxSize must be a finite number >= 1, got Infinity');
    });

    it('should throw for negative paddingFrameMaxSize', () => {
      expect(() => calculateFrameRanges(emphasizedLines, 10, { paddingFrameMaxSize: -1 })).toThrow(
        'paddingFrameMaxSize must be a finite number >= 0, got -1',
      );
    });

    it('should throw for NaN paddingFrameMaxSize', () => {
      expect(() => calculateFrameRanges(emphasizedLines, 10, { paddingFrameMaxSize: NaN })).toThrow(
        'paddingFrameMaxSize must be a finite number >= 0, got NaN',
      );
    });
  });

  describe('@focus directive', () => {
    it('should add padding around the focused region instead of first', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
        [15, { position: 'single', lineHighlight: true, focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 3,
      });

      // Second region is focused, so it gets padding.
      // It has both focus and lineHighlight, and since all lines are highlighted,
      // the frame type is "highlighted" (not "focus").
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 3, type: 'highlighted-unfocused', regionIndex: 0 },
        { startLine: 4, endLine: 11, type: 'normal' },
        { startLine: 12, endLine: 14, type: 'padding-top' },
        { startLine: 15, endLine: 15, type: 'highlighted', regionIndex: 1 },
        { startLine: 16, endLine: 18, type: 'padding-bottom' },
        { startLine: 19, endLine: 20, type: 'normal' },
      ]);
    });

    it('should use first region when no @focus specified', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'single', lineHighlight: true }],
        [15, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 2,
      });

      // First region gets padding by default
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 5, type: 'highlighted', regionIndex: 0 },
        { startLine: 6, endLine: 7, type: 'padding-bottom' },
        { startLine: 8, endLine: 14, type: 'normal' },
        { startLine: 15, endLine: 15, type: 'highlighted-unfocused', regionIndex: 1 },
        { startLine: 16, endLine: 20, type: 'normal' },
      ]);
    });

    it('should use focus frame type when focus region has only some lines highlighted', () => {
      // @focus region spanning lines 3-8, with @highlight on line 5
      // The frame type should be "focus" (not "highlighted") because not all lines are highlighted.
      // The highlight on line 5 is handled at the line level (data-hl).
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { lineHighlight: false, focus: true }],
        [4, { lineHighlight: false, focus: true }],
        [5, { lineHighlight: true, focus: true }],
        [6, { lineHighlight: false, focus: true }],
        [7, { lineHighlight: false, focus: true }],
        [8, { lineHighlight: false, focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        paddingFrameMaxSize: 2,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 8, type: 'focus', regionIndex: 0 },
        { startLine: 9, endLine: 10, type: 'padding-bottom' },
        { startLine: 11, endLine: 12, type: 'normal' },
      ]);
    });

    it('should use highlighted frame type when @highlight-start @focus marks all lines', () => {
      // @highlight on line 1 (unfocused), @highlight-start @focus on lines 3-5
      // Since all lines in the focused region have lineHighlight: true,
      // the frame should be "highlighted" (not "focus").
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [1, { position: 'single', lineHighlight: true }],
        [3, { lineHighlight: true, focus: true, position: 'start' }],
        [4, { lineHighlight: true, focus: true }],
        [5, { lineHighlight: true, focus: true, position: 'end' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 8, {
        paddingFrameMaxSize: 1,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 1, type: 'highlighted-unfocused', regionIndex: 0 },
        { startLine: 2, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 5, type: 'highlighted', regionIndex: 1 },
        { startLine: 6, endLine: 6, type: 'padding-bottom' },
        { startLine: 7, endLine: 8, type: 'normal' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should return empty array when totalLines is 0', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>();

      const result = calculateFrameRanges(emphasizedLines, 0);

      expect(result).toEqual<FrameRange[]>([]);
    });

    it('should handle single line of code that is highlighted', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [1, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 1);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 1, type: 'highlighted', regionIndex: 0 },
      ]);
    });

    it('should handle empty emphasized lines map', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>();

      const result = calculateFrameRanges(emphasizedLines, 10);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 10, type: 'focus', regionIndex: 0 },
      ]);
    });

    it('should handle text-highlighted lines as highlighted regions', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'single', lineHighlight: true, highlightTexts: ['Button'] }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'highlighted', regionIndex: 0 },
        { startLine: 6, endLine: 10, type: 'normal' },
      ]);
    });

    it('should not create empty padding frames when padding is 0', () => {
      // paddingFrameMaxSize=0 means no padding
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10, {
        paddingFrameMaxSize: 0,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'highlighted', regionIndex: 0 },
        { startLine: 6, endLine: 10, type: 'normal' },
      ]);
    });

    it('should handle padding that would overlap with another region', () => {
      // Lines 3 and 8 highlighted, paddingFrameMaxSize=3
      // First region (3) gets padding: top=max(1,3)=2 lines (1-2), bottom=3 lines (4-6)
      // Second region (8) is normal (no padding for non-focused)
      // But padding-bottom of region 1 (lines 4-6) doesn't overlap with region 2 (line 8)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
        [8, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        paddingFrameMaxSize: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted', regionIndex: 0 },
        { startLine: 4, endLine: 6, type: 'padding-bottom' },
        { startLine: 7, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 8, type: 'highlighted-unfocused', regionIndex: 1 },
        { startLine: 9, endLine: 12, type: 'normal' },
      ]);
    });

    it('should clamp padding when it would overlap another highlight region', () => {
      // Lines 3 and 6 highlighted, paddingFrameMaxSize=5
      // First region (3) gets padding: top=min(2,5)=2, bottom=min(2,5)=2 (only 2 lines between regions)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single', lineHighlight: true }],
        [6, { position: 'single', lineHighlight: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10, {
        paddingFrameMaxSize: 5,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted', regionIndex: 0 },
        { startLine: 4, endLine: 5, type: 'padding-bottom' },
        { startLine: 6, endLine: 6, type: 'highlighted-unfocused', regionIndex: 1 },
        { startLine: 7, endLine: 10, type: 'normal' },
      ]);
    });
  });
});
