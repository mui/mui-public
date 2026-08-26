import { describe, expect, it } from 'vitest';
import {
  extractQuotedCommentStrings,
  getUnquotedCommentTokens,
  hasFocusDirective,
  maskQuotedContent,
} from './emphasisCommentUtils';

describe('emphasisCommentUtils', () => {
  describe('maskQuotedContent', () => {
    it('should preserve offsets and expose tokens after escaped quoted content', () => {
      const comment = '@highlight "a \\" b" @focus';
      const masked = maskQuotedContent(comment);

      expect(masked).toHaveLength(comment.length);
      expect(masked.indexOf('@focus')).toBe(comment.indexOf('@focus'));
    });
  });

  describe('extractQuotedCommentStrings', () => {
    it('should keep escaped quotes inside the extracted string', () => {
      expect(extractQuotedCommentStrings('@highlight "a \\" b" "second"')).toEqual([
        'a \\" b',
        'second',
      ]);
    });

    it('should ignore empty quoted strings', () => {
      expect(extractQuotedCommentStrings('@highlight-text "" "value"')).toEqual(['value']);
    });
  });

  describe('getUnquotedCommentTokens', () => {
    it('should ignore quoted tokens and respect escaped quotes', () => {
      expect(getUnquotedCommentTokens('@highlight "a \\" @focus b" @focus')).toEqual([
        '@highlight',
        '@focus',
      ]);
    });
  });

  describe('hasFocusDirective', () => {
    it('should recognize focus directives and highlight focus modifiers', () => {
      expect(hasFocusDirective('@focus-start')).toBe(true);
      expect(hasFocusDirective('@highlight "description" @focus')).toBe(true);
    });

    it('should ignore prose and quoted focus tokens', () => {
      expect(hasFocusDirective('This example uses @focus')).toBe(false);
      expect(hasFocusDirective('@highlight "Use @focus here"')).toBe(false);
    });
  });
});
