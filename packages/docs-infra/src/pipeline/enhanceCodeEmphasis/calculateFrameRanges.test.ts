import { describe, it, expect } from 'vitest';
import type { EmphasisMeta, FrameRange } from './calculateFrameRanges';
// eslint-disable-next-line import/extensions
import { calculateFrameRanges } from './calculateFrameRanges';

describe('calculateFrameRanges', () => {
  describe('basic reframing', () => {
    it('should split a single highlighted line in the middle', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[10, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 9, type: 'normal' },
        { startLine: 10, endLine: 10, type: 'highlighted' },
        { startLine: 11, endLine: 20, type: 'normal' },
      ]);
    });

    it('should handle highlight at line 1', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[1, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 5);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 1, type: 'highlighted' },
        { startLine: 2, endLine: 5, type: 'normal' },
      ]);
    });

    it('should handle highlight at last line', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[5, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 5);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'highlighted' },
      ]);
    });

    it('should handle entire code highlighted', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [1, { position: 'start' }],
        [2, {}],
        [3, { position: 'end' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 3);

      expect(result).toEqual<FrameRange[]>([{ startLine: 1, endLine: 3, type: 'highlighted' }]);
    });

    it('should handle a multiline highlight region', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'start' }],
        [6, {}],
        [7, { position: 'end' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 7, type: 'highlighted' },
        { startLine: 8, endLine: 10, type: 'normal' },
      ]);
    });

    it('should handle multiple disjoint highlight regions', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single' }],
        [8, { position: 'start' }],
        [9, { position: 'end' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 3, type: 'highlighted' },
        { startLine: 4, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 9, type: 'highlighted-unfocused' },
        { startLine: 10, endLine: 12, type: 'normal' },
      ]);
    });

    it('should handle adjacent highlight regions', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single' }],
        [4, { position: 'single' }],
      ]);

      // These are consecutive lines, so they form one region
      const result = calculateFrameRanges(emphasizedLines, 6);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'highlighted' },
        { startLine: 5, endLine: 6, type: 'normal' },
      ]);
    });
  });

  describe('padding frames', () => {
    it('should add padding around the focused region', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[10, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted' },
        { startLine: 11, endLine: 15, type: 'padding-bottom' },
        { startLine: 16, endLine: 20, type: 'normal' },
      ]);
    });

    it('should clamp padding to available lines before the highlight', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[3, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
      });

      // Only 2 lines before highlight (1,2), so padding-top is 2 lines, no normal before
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted' },
        { startLine: 4, endLine: 8, type: 'padding-bottom' },
        { startLine: 9, endLine: 20, type: 'normal' },
      ]);
    });

    it('should clamp padding to available lines after the highlight', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[18, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
      });

      // Only 2 lines after highlight (19,20), so padding-bottom is 2 lines, no normal after
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 12, type: 'normal' },
        { startLine: 13, endLine: 17, type: 'padding-top' },
        { startLine: 18, endLine: 18, type: 'highlighted' },
        { startLine: 19, endLine: 20, type: 'padding-bottom' },
      ]);
    });

    it('should only add padding to the first (focused) region', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single' }],
        [15, { position: 'single' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 2,
      });

      // First region gets padding, second does not
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted' },
        { startLine: 4, endLine: 5, type: 'padding-bottom' },
        { startLine: 6, endLine: 14, type: 'normal' },
        { startLine: 15, endLine: 15, type: 'highlighted-unfocused' },
        { startLine: 16, endLine: 20, type: 'normal' },
      ]);
    });
  });

  describe('focusFramesMaxLength', () => {
    it('should constrain focus area to focusFramesMaxLength', () => {
      // Line 10 highlighted, paddingFrameMaxSize=5, focusFramesMaxLength=8
      // remaining = 8 - 1 = 7, paddingTop = floor(7/2) = 3, paddingBottom = ceil(7/2) = 4
      // Both capped by paddingFrameMaxSize=5, so: paddingTop=3, paddingBottom=4
      const emphasizedLines = new Map<number, EmphasisMeta>([[10, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
        focusFramesMaxLength: 8,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 6, type: 'normal' },
        { startLine: 7, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted' },
        { startLine: 11, endLine: 14, type: 'padding-bottom' },
        { startLine: 15, endLine: 20, type: 'normal' },
      ]);
    });

    it('should handle when highlight is larger than focusFramesMaxLength', () => {
      // Highlight spans 5 lines but focusFramesMaxLength is 3
      // remaining = 3 - 5 = -2, so no padding
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'start' }],
        [6, {}],
        [7, {}],
        [8, {}],
        [9, { position: 'end' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 15, {
        paddingFrameMaxSize: 5,
        focusFramesMaxLength: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 9, type: 'highlighted' },
        { startLine: 10, endLine: 15, type: 'normal' },
      ]);
    });

    it('should give extra line to padding-bottom when odd remainder', () => {
      // Line 10 highlighted, focusFramesMaxLength=6
      // remaining = 6 - 1 = 5, paddingTop = floor(5/2) = 2, paddingBottom = ceil(5/2) = 3
      const emphasizedLines = new Map<number, EmphasisMeta>([[10, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 5,
        focusFramesMaxLength: 6,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted' },
        { startLine: 11, endLine: 13, type: 'padding-bottom' },
        { startLine: 14, endLine: 20, type: 'normal' },
      ]);
    });

    it('should respect paddingFrameMaxSize even within focusFramesMaxLength', () => {
      // Line 10 highlighted, paddingFrameMaxSize=2, focusFramesMaxLength=20
      // remaining = 20 - 1 = 19, paddingTop = floor(19/2) = 9 → capped at 2
      // paddingBottom = ceil(19/2) = 10 → capped at 2
      const emphasizedLines = new Map<number, EmphasisMeta>([[10, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 2,
        focusFramesMaxLength: 20,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 9, type: 'padding-top' },
        { startLine: 10, endLine: 10, type: 'highlighted' },
        { startLine: 11, endLine: 12, type: 'padding-bottom' },
        { startLine: 13, endLine: 20, type: 'normal' },
      ]);
    });
  });

  describe('@focus directive', () => {
    it('should add padding around the focused region instead of first', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single' }],
        [15, { position: 'single', focus: true }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 3,
      });

      // Second region is focused, so it gets padding
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 3, type: 'highlighted-unfocused' },
        { startLine: 4, endLine: 11, type: 'normal' },
        { startLine: 12, endLine: 14, type: 'padding-top' },
        { startLine: 15, endLine: 15, type: 'highlighted' },
        { startLine: 16, endLine: 18, type: 'padding-bottom' },
        { startLine: 19, endLine: 20, type: 'normal' },
      ]);
    });

    it('should use first region when no @focus specified', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'single' }],
        [15, { position: 'single' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 20, {
        paddingFrameMaxSize: 2,
      });

      // First region gets padding by default
      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 5, type: 'highlighted' },
        { startLine: 6, endLine: 7, type: 'padding-bottom' },
        { startLine: 8, endLine: 14, type: 'normal' },
        { startLine: 15, endLine: 15, type: 'highlighted-unfocused' },
        { startLine: 16, endLine: 20, type: 'normal' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle single line of code that is highlighted', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([[1, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 1);

      expect(result).toEqual<FrameRange[]>([{ startLine: 1, endLine: 1, type: 'highlighted' }]);
    });

    it('should handle empty emphasized lines map', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>();

      const result = calculateFrameRanges(emphasizedLines, 10);

      expect(result).toEqual<FrameRange[]>([{ startLine: 1, endLine: 10, type: 'normal' }]);
    });

    it('should handle text-highlighted lines as highlighted regions', () => {
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [5, { position: 'single', highlightText: 'Button' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10);

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'highlighted' },
        { startLine: 6, endLine: 10, type: 'normal' },
      ]);
    });

    it('should not create empty padding frames when padding is 0', () => {
      // paddingFrameMaxSize=0 means no padding
      const emphasizedLines = new Map<number, EmphasisMeta>([[5, { position: 'single' }]]);

      const result = calculateFrameRanges(emphasizedLines, 10, {
        paddingFrameMaxSize: 0,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 4, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'highlighted' },
        { startLine: 6, endLine: 10, type: 'normal' },
      ]);
    });

    it('should handle padding that would overlap with another region', () => {
      // Lines 3 and 8 highlighted, paddingFrameMaxSize=3
      // First region (3) gets padding: top=max(1,3)=2 lines (1-2), bottom=3 lines (4-6)
      // Second region (8) is normal (no padding for non-focused)
      // But padding-bottom of region 1 (lines 4-6) doesn't overlap with region 2 (line 8)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single' }],
        [8, { position: 'single' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 12, {
        paddingFrameMaxSize: 3,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted' },
        { startLine: 4, endLine: 6, type: 'padding-bottom' },
        { startLine: 7, endLine: 7, type: 'normal' },
        { startLine: 8, endLine: 8, type: 'highlighted-unfocused' },
        { startLine: 9, endLine: 12, type: 'normal' },
      ]);
    });

    it('should clamp padding when it would overlap another highlight region', () => {
      // Lines 3 and 6 highlighted, paddingFrameMaxSize=5
      // First region (3) gets padding: top=min(2,5)=2, bottom=min(2,5)=2 (only 2 lines between regions)
      const emphasizedLines = new Map<number, EmphasisMeta>([
        [3, { position: 'single' }],
        [6, { position: 'single' }],
      ]);

      const result = calculateFrameRanges(emphasizedLines, 10, {
        paddingFrameMaxSize: 5,
      });

      expect(result).toEqual<FrameRange[]>([
        { startLine: 1, endLine: 2, type: 'padding-top' },
        { startLine: 3, endLine: 3, type: 'highlighted' },
        { startLine: 4, endLine: 5, type: 'padding-bottom' },
        { startLine: 6, endLine: 6, type: 'highlighted-unfocused' },
        { startLine: 7, endLine: 10, type: 'normal' },
      ]);
    });
  });
});
