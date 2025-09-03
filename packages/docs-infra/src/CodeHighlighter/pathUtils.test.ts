/**
 * Tests for path utilities
 */

import { describe, it, expect } from 'vitest';
import { resolveRelativePath, countConsecutiveBackNavigation } from './pathUtils';

describe('pathUtils', () => {
  describe('resolveRelativePath', () => {
    it('should resolve simple relative paths', () => {
      expect(resolveRelativePath('foo/bar.js')).toEqual({
        resolvedPath: 'foo/bar.js',
        backSteps: 0,
      });
    });

    it('should handle consecutive back navigation at start', () => {
      expect(resolveRelativePath('../../config.js')).toEqual({
        resolvedPath: 'config.js',
        backSteps: 2,
      });
    });

    it('should handle complex mixed navigation patterns', () => {
      expect(resolveRelativePath('../foo/../../bar/utils.js')).toEqual({
        resolvedPath: 'bar/utils.js',
        backSteps: 2,
      });
    });

    it('should handle paths with forward and backward navigation', () => {
      expect(resolveRelativePath('../../forward/../back/config.js')).toEqual({
        resolvedPath: 'back/config.js',
        backSteps: 2,
      });
    });

    it('should handle complex navigation with multiple segments', () => {
      expect(resolveRelativePath('../../../start/forward/../../../back.js')).toEqual({
        resolvedPath: 'back.js',
        backSteps: 4,
      });
    });

    it('should skip empty and current directory segments', () => {
      expect(resolveRelativePath('./foo/./bar/../baz.js')).toEqual({
        resolvedPath: 'foo/baz.js',
        backSteps: 0,
      });
    });
  });

  describe('countConsecutiveBackNavigation', () => {
    it('should count consecutive back navigation at start', () => {
      expect(countConsecutiveBackNavigation('../utils.js')).toBe(1);
      expect(countConsecutiveBackNavigation('../../config.js')).toBe(2);
      expect(countConsecutiveBackNavigation('../../../deep.js')).toBe(3);
    });

    it('should only count consecutive patterns at start', () => {
      expect(countConsecutiveBackNavigation('../foo/../bar.js')).toBe(1);
      expect(countConsecutiveBackNavigation('../../foo/../bar.js')).toBe(2);
    });

    it('should return 0 for paths without back navigation at start', () => {
      expect(countConsecutiveBackNavigation('foo/bar.js')).toBe(0);
      expect(countConsecutiveBackNavigation('./foo/bar.js')).toBe(0);
      expect(countConsecutiveBackNavigation('foo/../bar.js')).toBe(0);
    });
  });
});
