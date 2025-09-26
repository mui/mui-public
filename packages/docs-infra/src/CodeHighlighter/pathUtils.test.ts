/**
 * Tests for path utilities
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRelativePath,
  getUrlParts,
  removeTrailingSlash,
  removeBackNavigationPrefix,
  calculateMaxBackNavigation,
  calculateMaxSourceBackNavigation,
  buildPath,
  createSyntheticDirectories,
  calculateMetadataBackNavigation,
} from './pathUtils';

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

  describe('getUrlParts', () => {
    it('should extract path parts from URL', () => {
      expect(getUrlParts('https://example.com/foo/bar/file.js')).toEqual(['foo', 'bar', 'file.js']);
      expect(getUrlParts('https://example.com/single')).toEqual(['single']);
      expect(getUrlParts('https://example.com/deep/nested/path')).toEqual([
        'deep',
        'nested',
        'path',
      ]);
    });

    it('should handle URLs with trailing slash', () => {
      expect(getUrlParts('https://example.com/foo/bar/')).toEqual(['foo', 'bar']);
    });

    it('should handle root path', () => {
      expect(getUrlParts('https://example.com/')).toEqual([]);
      expect(getUrlParts('https://example.com')).toEqual([]);
    });

    it('should filter out empty segments', () => {
      expect(getUrlParts('https://example.com//foo//bar//')).toEqual(['foo', 'bar']);
    });
  });

  describe('removeTrailingSlash', () => {
    it('should remove trailing slash', () => {
      expect(removeTrailingSlash('path/')).toBe('path');
      expect(removeTrailingSlash('deep/path/')).toBe('deep/path');
    });

    it('should not modify paths without trailing slash', () => {
      expect(removeTrailingSlash('path')).toBe('path');
      expect(removeTrailingSlash('deep/path')).toBe('deep/path');
    });

    it('should handle empty string', () => {
      expect(removeTrailingSlash('')).toBe('');
    });

    it('should handle single slash', () => {
      expect(removeTrailingSlash('/')).toBe('');
    });
  });

  describe('removeBackNavigationPrefix', () => {
    it('should remove specified number of back navigation prefixes', () => {
      expect(removeBackNavigationPrefix('../file.js', 1)).toBe('file.js');
      expect(removeBackNavigationPrefix('../../file.js', 2)).toBe('file.js');
      expect(removeBackNavigationPrefix('../../../file.js', 2)).toBe('../file.js');
    });

    it('should handle count larger than available prefixes', () => {
      expect(removeBackNavigationPrefix('../file.js', 5)).toBe('file.js');
      expect(removeBackNavigationPrefix('../../file.js', 10)).toBe('file.js');
    });

    it('should not modify paths without back navigation prefixes', () => {
      expect(removeBackNavigationPrefix('file.js', 2)).toBe('file.js');
      expect(removeBackNavigationPrefix('foo/bar.js', 1)).toBe('foo/bar.js');
    });

    it('should handle zero count', () => {
      expect(removeBackNavigationPrefix('../file.js', 0)).toBe('../file.js');
    });

    it('should handle mixed patterns', () => {
      expect(removeBackNavigationPrefix('../foo/../bar.js', 1)).toBe('foo/../bar.js');
    });
  });

  describe('calculateMaxSourceBackNavigation', () => {
    it('should calculate max back navigation from non-metadata files', () => {
      const files = {
        'file1.js': 'https://example.com/file1.js',
        '../file2.js': 'https://example.com/file2.js',
        '../../file3.js': 'https://example.com/file3.js',
      };
      expect(calculateMaxSourceBackNavigation(files)).toBe(2);
    });

    it('should ignore metadata files', () => {
      const files = {
        'file1.js': 'https://example.com/file1.js',
        '../file2.js': 'https://example.com/file2.js',
        '../../../metadata.json': { metadata: true },
      };
      expect(calculateMaxSourceBackNavigation(files)).toBe(1);
    });

    it('should return 0 for files without back navigation', () => {
      const files = {
        'file1.js': 'https://example.com/file1.js',
        'dir/file2.js': 'https://example.com/file2.js',
      };
      expect(calculateMaxSourceBackNavigation(files)).toBe(0);
    });

    it('should handle empty files object', () => {
      expect(calculateMaxSourceBackNavigation({})).toBe(0);
    });

    it('should handle only metadata files', () => {
      const files = {
        '../metadata1.json': { metadata: true },
        '../../metadata2.json': { metadata: true },
      };
      expect(calculateMaxSourceBackNavigation(files)).toBe(0);
    });

    it('should use resolved path back steps', () => {
      const files = {
        '../foo/../../bar.js': 'https://example.com/bar.js', // resolves to bar.js with 1 back step
        '../../simple.js': 'https://example.com/simple.js', // resolves to simple.js with 2 back steps
      };
      expect(calculateMaxSourceBackNavigation(files)).toBe(2);
    });
  });

  describe('calculateMaxBackNavigation', () => {
    it('should calculate max back navigation for all files including metadata', () => {
      const files = {
        'file1.js': 'https://example.com/file1.js',
        '../file2.js': 'https://example.com/file2.js',
        '../../file3.js': 'https://example.com/file3.js',
        '../../../metadata.json': { metadata: true },
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(3);
      expect(result.maxSourceBackNavigation).toBe(2);
    });

    it('should handle files with no back navigation', () => {
      const files = {
        'file1.js': 'https://example.com/file1.js',
        'dir/file2.js': 'https://example.com/file2.js',
        'deep/nested/file3.js': {},
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(0);
      expect(result.maxSourceBackNavigation).toBe(0);
    });

    it('should handle empty files object', () => {
      const result = calculateMaxBackNavigation({});
      expect(result.maxBackNavigation).toBe(0);
      expect(result.maxSourceBackNavigation).toBe(0);
    });

    it('should handle only metadata files', () => {
      const files = {
        '../metadata1.json': { metadata: true },
        '../../metadata2.json': { metadata: true },
        '../../../metadata3.json': { metadata: true },
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(3);
      expect(result.maxSourceBackNavigation).toBe(0);
    });

    it('should handle mixed file types correctly', () => {
      const files = {
        'local.js': 'https://example.com/local.js',
        '../parent.js': 'https://example.com/parent.js',
        '../../grandparent.js': {},
        '../../../metadata.json': { metadata: true },
        '../../../../deep-metadata.json': { metadata: true },
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(4); // deepest is ../../../../deep-metadata.json
      expect(result.maxSourceBackNavigation).toBe(2); // deepest non-metadata is ../../grandparent.js
    });

    it('should use resolved path back steps for complex paths', () => {
      const files = {
        '../foo/../../bar.js': 'https://example.com/bar.js', // resolves to bar.js with 1 back step
        '../../simple.js': 'https://example.com/simple.js', // resolves to simple.js with 2 back steps
        '../../../complex/../metadata.json': { metadata: true }, // resolves to metadata.json with 3 back steps
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(3);
      expect(result.maxSourceBackNavigation).toBe(2);
    });

    it('should handle object files without metadata property as non-metadata', () => {
      const files = {
        'file1.js': 'https://example.com/file1.js',
        '../file2.js': {},
        '../../file3.js': {}, // object without metadata property
        '../../../metadata.json': { metadata: true },
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(3);
      expect(result.maxSourceBackNavigation).toBe(2); // ../file2.js and ../../file3.js are non-metadata
    });

    it('should handle the example from JSDoc', () => {
      const files = {
        'component.tsx': 'url',
        '../shared/utils.ts': 'url',
        '../../docs/readme.md': { metadata: true },
      };
      const result = calculateMaxBackNavigation(files);
      expect(result.maxBackNavigation).toBe(2);
      expect(result.maxSourceBackNavigation).toBe(1);
    });
  });

  describe('buildPath', () => {
    it('should build path from string arguments', () => {
      expect(buildPath('foo', 'bar', 'file.js')).toBe('foo/bar/file.js');
      expect(buildPath('single')).toBe('single');
    });

    it('should build path from array arguments', () => {
      expect(buildPath(['foo', 'bar'], 'file.js')).toBe('foo/bar/file.js');
      expect(buildPath('prefix', ['foo', 'bar'])).toBe('prefix/foo/bar');
    });

    it('should handle mixed string and array arguments', () => {
      expect(buildPath('prefix', ['foo', 'bar'], 'file.js')).toBe('prefix/foo/bar/file.js');
      expect(buildPath(['deep', 'path'], 'middle', ['end', 'file.js'])).toBe(
        'deep/path/middle/end/file.js',
      );
    });

    it('should filter out undefined values', () => {
      expect(buildPath('foo', undefined, 'bar')).toBe('foo/bar');
      expect(buildPath(undefined, 'foo', 'bar')).toBe('foo/bar');
    });

    it('should filter out empty strings', () => {
      expect(buildPath('', 'foo', '', 'bar')).toBe('foo/bar');
      expect(buildPath(['', 'foo'], '', 'bar')).toBe('foo/bar');
    });

    it('should remove trailing slashes from components', () => {
      expect(buildPath('foo/', 'bar/', 'file.js')).toBe('foo/bar/file.js');
      expect(buildPath(['path/', 'to/'], 'file.js')).toBe('path/to/file.js');
    });

    it('should handle empty input', () => {
      expect(buildPath()).toBe('');
      expect(buildPath(undefined)).toBe('');
      expect(buildPath('')).toBe('');
    });
  });

  describe('createSyntheticDirectories', () => {
    it('should create alphabetic directory names', () => {
      expect(createSyntheticDirectories(3)).toEqual(['a', 'b', 'c']);
      expect(createSyntheticDirectories(5)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should handle zero count', () => {
      expect(createSyntheticDirectories(0)).toEqual([]);
    });

    it('should handle single count', () => {
      expect(createSyntheticDirectories(1)).toEqual(['a']);
    });

    it('should handle large counts', () => {
      const result = createSyntheticDirectories(26);
      expect(result.length).toBe(26);
      expect(result[0]).toBe('a');
      expect(result[25]).toBe('z');
    });

    it('should create consistent output', () => {
      const result1 = createSyntheticDirectories(4);
      const result2 = createSyntheticDirectories(4);
      expect(result1).toEqual(result2);
      expect(result1).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('calculateMetadataBackNavigation', () => {
    it('should return empty string for undefined files', () => {
      expect(calculateMetadataBackNavigation(undefined)).toBe('');
    });

    it('should return empty string for empty files object', () => {
      expect(calculateMetadataBackNavigation({})).toBe('');
    });

    it('should calculate back navigation from source files only', () => {
      const files = {
        'file1.js': 'url',
        '../file2.js': 'url',
        '../../file3.js': 'url',
        '../../../metadata.json': { metadata: true }, // Should be ignored
      };
      expect(calculateMetadataBackNavigation(files)).toBe('../../'); // maxSourceBackNavigation = 2
    });

    it('should handle files without back navigation', () => {
      const files = {
        'file1.js': 'url',
        'dir/file2.js': 'url',
        'deep/nested/file3.js': {},
      };
      expect(calculateMetadataBackNavigation(files)).toBe(''); // maxSourceBackNavigation = 0
    });

    it('should ignore metadata files when calculating source back navigation', () => {
      const files = {
        'file1.js': 'url',
        '../file2.js': 'url',
        '../../../deep-metadata.json': { metadata: true },
        '../../../../deeper-metadata.json': { metadata: true },
      };
      expect(calculateMetadataBackNavigation(files)).toBe('../'); // maxSourceBackNavigation = 1 (ignores metadata)
    });

    it('should handle only metadata files', () => {
      const files = {
        '../metadata1.json': { metadata: true },
        '../../metadata2.json': { metadata: true },
      };
      expect(calculateMetadataBackNavigation(files)).toBe(''); // maxSourceBackNavigation = 0
    });

    it('should add metadataPrefix levels to back navigation', () => {
      const files = {
        '../file1.js': 'url',
        '../../file2.js': 'url',
      };

      // maxSourceBackNavigation = 2, metadataPrefix adds 1 level
      expect(calculateMetadataBackNavigation(files, 'src/')).toBe('../../../');

      // maxSourceBackNavigation = 2, metadataPrefix adds 2 levels
      expect(calculateMetadataBackNavigation(files, 'src/app/')).toBe('../../../../');
    });

    it('should handle metadataPrefix with multiple segments', () => {
      const files = {
        '../utils.js': 'url',
      };

      expect(calculateMetadataBackNavigation(files, 'src/components/ui/')).toBe('../../../../');
      expect(calculateMetadataBackNavigation(files, 'deep/nested/path/structure/')).toBe(
        '../../../../../',
      );
    });

    it('should handle metadataPrefix with trailing slashes', () => {
      const files = {
        '../file.js': 'url',
      };

      expect(calculateMetadataBackNavigation(files, 'src/')).toBe('../../');
      expect(calculateMetadataBackNavigation(files, 'src')).toBe('../../'); // Should be same as with trailing slash
    });

    it('should handle metadataPrefix with leading slashes', () => {
      const files = {
        '../file.js': 'url',
      };

      expect(calculateMetadataBackNavigation(files, '/src/')).toBe('../../');
      expect(calculateMetadataBackNavigation(files, '/src/app/')).toBe('../../../');
    });

    it('should handle metadataPrefix with empty segments', () => {
      const files = {
        '../file.js': 'url',
      };

      expect(calculateMetadataBackNavigation(files, 'src//app//')).toBe('../../../'); // Should filter empty segments
      expect(calculateMetadataBackNavigation(files, '//src//')).toBe('../../');
    });

    it('should handle empty metadataPrefix', () => {
      const files = {
        '../../file.js': 'url',
      };

      expect(calculateMetadataBackNavigation(files, '')).toBe('../../');
      expect(calculateMetadataBackNavigation(files, undefined)).toBe('../../');
    });

    it('should use resolved path back steps for complex navigation', () => {
      const files = {
        '../foo/../../bar.js': 'url', // resolves to bar.js with 1 back step
        '../../simple.js': 'url', // resolves to simple.js with 2 back steps
      };

      expect(calculateMetadataBackNavigation(files)).toBe('../../'); // maxSourceBackNavigation = 2
      expect(calculateMetadataBackNavigation(files, 'src/')).toBe('../../../'); // 2 + 1
    });

    it('should match the example from JSDoc', () => {
      const files = {
        '../utils.ts': 'url',
        '../../shared.ts': 'url',
      };
      const result = calculateMetadataBackNavigation(files, 'src/');
      expect(result).toBe('../../../'); // maxSourceBackNavigation=2 + metadataPrefix=1
    });

    it('should handle complex real-world scenario', () => {
      const files = {
        'component.tsx': 'url',
        '../shared/utils.ts': 'url', // 1 back step
        '../../hooks/useData.ts': 'url', // 2 back steps
        '../../../config/settings.js': 'url', // 3 back steps
        '../../../../docs/readme.md': { metadata: true }, // Should be ignored
      };

      // maxSourceBackNavigation = 3 (from ../../../config/settings.js)
      expect(calculateMetadataBackNavigation(files)).toBe('../../../');
      expect(calculateMetadataBackNavigation(files, 'src/')).toBe('../../../../');
      expect(calculateMetadataBackNavigation(files, 'src/app/')).toBe('../../../../../');
    });

    it('should handle edge case with zero back navigation and metadataPrefix', () => {
      const files = {
        'local.js': 'url',
        'dir/nested.js': 'url',
      };

      expect(calculateMetadataBackNavigation(files, 'src/app/')).toBe('../../'); // 0 + 2
    });

    it('should be consistent with different file object types', () => {
      const stringFiles = {
        '../file1.js': 'https://example.com/file1.js',
        '../../file2.js': 'https://example.com/file2.js',
      };

      const objectFiles = {
        '../file1.js': {},
        '../../file2.js': { metadata: false },
      };

      expect(calculateMetadataBackNavigation(stringFiles, 'src/')).toBe('../../../');
      expect(calculateMetadataBackNavigation(objectFiles, 'src/')).toBe('../../../');
    });
  });
});
