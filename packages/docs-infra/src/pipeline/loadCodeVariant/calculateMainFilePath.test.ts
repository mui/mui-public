/**
 * Tests for calculateMainFilePath functionality
 */

import { describe, it, expect } from 'vitest';
import { calculateMainFilePath } from './calculateMainFilePath';

describe('calculateMainFilePath', () => {
  describe('basic functionality', () => {
    it('should handle simple URL with no back navigation', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        0, // maxBackNav
      );

      expect(result).toBe('file:///index.tsx');
    });

    it('should handle URL with filename extraction', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/Demo.tsx',
        1, // maxBackNav
      );

      expect(result).toBe('file:///Button/Demo.tsx');
    });

    it('should handle empty URL gracefully', () => {
      const result = calculateMainFilePath(
        '',
        0, // maxBackNav
      );

      expect(result).toBe('');
    });

    it('should handle URL with only filename', () => {
      const result = calculateMainFilePath(
        'Demo.tsx',
        0, // maxBackNav
      );

      expect(result).toBe('file:///Demo.tsx');
    });
  });

  describe('source path extraction', () => {
    it('should extract sourcePath from end of URL', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/subdir/index.tsx',
        2, // maxBackNav
      );

      // With maxSourceBackNav=2 (defaults to maxBackNav), should take ['Button', 'subdir'] from end
      // With maxBackNav=2 and maxSourceBackNav=2, no additional metadata path needed
      // Result should be: sourcePath + filename = 'Button/subdir/index.tsx'
      expect(result).toBe('file:///Button/subdir/index.tsx');
    });

    it('should handle maxSourceBackNav larger than available segments', () => {
      const result = calculateMainFilePath(
        'file:///lib/index.tsx',
        5, // maxBackNav (more than available)
      );

      expect(result).toBe('file:///a/b/c/d/lib/index.tsx');
    });

    it('should handle zero maxSourceBackNav', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
        0, // maxSourceBackNav
      );

      // With maxSourceBackNav=0, sourcePath is empty
      // With maxBackNav=2, should take 2 segments from URL for metadataPath: ['components', 'Button']
      // Result should be: components/Button/index.tsx
      expect(result).toBe('file:///components/Button/index.tsx');
    });
  });

  describe('metadata prefix handling', () => {
    it('should include metadataPrefix in path', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src/', // metadataPrefix
      );

      expect(result).toBe('file:///components/src/Button/index.tsx');
    });

    it('should handle metadataPrefix with multiple segments', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        4, // maxBackNav
        1, // maxSourceBackNav
        'src/app/', // metadataPrefix
      );

      expect(result).toBe('file:///components/src/app/Button/index.tsx');
    });

    it('should handle empty metadataPrefix', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      expect(result).toBe('file:///components/Button/index.tsx');
    });

    it('should handle metadataPrefix with trailing slash', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src/', // metadataPrefix with trailing slash
      );

      expect(result).toBe('file:///components/src/Button/index.tsx');
    });
  });

  describe('metadata path extraction', () => {
    it('should extract metadataPath from remaining URL segments', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/deep/nested/Button/index.tsx',
        4, // maxBackNav
        1, // maxSourceBackNav (Button)
        'src/', // metadataPrefix (1 segment)
      );

      // maxBackNav(4) - maxSourceBackNav(1) - metadataPrefix(1) = 2 segments needed
      // Should take 2 segments from remaining: deep/nested
      expect(result).toBe('file:///deep/nested/src/Button/index.tsx');
    });

    it('should handle insufficient URL segments for metadataPath', () => {
      const result = calculateMainFilePath(
        'file:///lib/Button/index.tsx',
        5, // maxBackNav
        1, // maxSourceBackNav (Button)
        'src/app/', // metadataPrefix (2 segments)
      );

      // maxBackNav(5) - maxSourceBackNav(1) - metadataPrefix(2) = 2 segments needed
      // Only 1 segment available (lib), so need 1 synthetic
      expect(result).toBe('file:///a/lib/src/app/Button/index.tsx');
    });

    it('should handle zero metadata segments needed', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        1, // maxBackNav
        1, // maxSourceBackNav
        '', // metadataPrefix
      );

      // maxBackNav(1) - maxSourceBackNav(1) - metadataPrefix(0) = 0 segments needed
      expect(result).toBe('file:///Button/index.tsx');
    });
  });

  describe('synthetic directories', () => {
    it('should create synthetic directories when needed', () => {
      const result = calculateMainFilePath(
        'file:///Button/index.tsx',
        5, // maxBackNav
        1, // maxSourceBackNav
        'src/app/', // metadataPrefix (2 segments)
      );

      // maxBackNav(5) - maxSourceBackNav(1) - metadataPrefix(2) = 2 segments needed
      // No URL segments available, so need 2 synthetic
      expect(result).toBe('file:///a/b/src/app/Button/index.tsx');
    });

    it('should create multiple synthetic directories', () => {
      const result = calculateMainFilePath(
        'index.tsx',
        6, // maxBackNav
        0, // maxSourceBackNav
        '', // metadataPrefix
      );

      // All 6 segments need to be synthetic
      expect(result).toBe('file:///a/b/c/d/e/f/index.tsx');
    });

    it('should use alphabetic naming for synthetic directories', () => {
      const result = calculateMainFilePath(
        'Demo.tsx',
        3, // maxBackNav
        0, // maxSourceBackNav
        '', // metadataPrefix
      );

      expect(result).toBe('file:///a/b/c/Demo.tsx');
    });

    it('should not create synthetic directories when not needed', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/deep/nested/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src/', // metadataPrefix
      );

      // maxBackNav(3) - maxSourceBackNav(1) - metadataPrefix(1) = 1 segment needed
      // 4 segments available (lib, components, deep, nested), so no synthetic needed
      expect(result).toBe('file:///nested/src/Button/index.tsx');
    });
  });

  describe('complex scenarios', () => {
    it('should handle deep nesting with metadata prefix', () => {
      const result = calculateMainFilePath(
        'file:///monorepo/packages/ui/lib/components/Button/Demo.tsx',
        8, // maxBackNav
        2, // maxSourceBackNav (Button, Demo.tsx)
        'src/stories/', // metadataPrefix (2 segments)
      );

      // maxBackNav(8) - maxSourceBackNav(2) - metadataPrefix(2) = 4 segments needed
      // 4 segments available (monorepo, packages, ui, lib), so exact match
      expect(result).toBe(
        'file:///monorepo/packages/ui/lib/src/stories/components/Button/Demo.tsx',
      );
    });

    it('should handle edge case with exact segment match', () => {
      const result = calculateMainFilePath(
        'file:///a/b/c/index.tsx',
        4, // maxBackNav (changed from 5 to 4)
        1, // maxSourceBackNav
        'src/', // metadataPrefix
      );

      // maxBackNav(4) - maxSourceBackNav(1) - metadataPrefix(1) = 2 segments needed
      // 2 segments available (a, b) after taking sourcePath (c), so exact match
      expect(result).toBe('file:///a/b/src/c/index.tsx');
    });

    it('should handle large maxBackNav with small URL', () => {
      const result = calculateMainFilePath(
        'file:///Demo.tsx',
        10, // maxBackNav
        0, // maxSourceBackNav
        'src/app/components/', // metadataPrefix (3 segments)
      );

      // maxBackNav(10) - maxSourceBackNav(0) - metadataPrefix(3) = 7 segments needed
      // No URL segments available, so need 7 synthetic
      expect(result).toBe('file:///a/b/c/d/e/f/g/src/app/components/Demo.tsx');
    });

    it('should handle zero maxBackNav', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        0, // maxBackNav
      );

      expect(result).toBe('file:///index.tsx');
    });

    it('should handle maxBackNav equal to maxSourceBackNav', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
      );

      // When maxBackNav equals maxSourceBackNav, we take sourcePath but no metadataPath
      // sourcePath=[components, Button] from end of URL
      // Result should be: sourcePath + filename = components/Button/index.tsx
      expect(result).toBe('file:///components/Button/index.tsx');
    });
  });

  describe('URL format variations', () => {
    it('should handle file:// protocol URLs', () => {
      const result = calculateMainFilePath(
        'file://localhost/lib/components/Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      expect(result).toBe('file:///components/Button/index.tsx');
    });

    it('should handle URLs with query parameters', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx?version=1',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      expect(result).toBe('file:///components/Button/index.tsx?version=1');
    });

    it('should handle URLs with fragments', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx#main',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      expect(result).toBe('file:///components/Button/index.tsx#main');
    });

    it('should handle relative URLs', () => {
      const result = calculateMainFilePath(
        'lib/components/Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      expect(result).toBe('file:///components/Button/index.tsx');
    });

    it('should handle URLs with double slashes', () => {
      const result = calculateMainFilePath(
        'file:///lib//components//Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      // Should filter out empty segments
      expect(result).toBe('file:///components/Button/index.tsx');
    });
  });

  describe('edge cases', () => {
    it('should handle URL with no filename', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/',
        2, // maxBackNav
        1, // maxSourceBackNav
      );

      // With trailing slash, filename is empty and should be preserved
      // Should take 2 segments total: 1 for sourcePath (Button), 1 for metadataPath (components)
      expect(result).toBe('file:///components/Button/');
    });

    it('should handle single character segments', () => {
      const result = calculateMainFilePath(
        'file:///a/b/c/d/e.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'x/', // metadataPrefix
      );

      expect(result).toBe('file:///c/x/d/e.tsx');
    });

    it('should handle numeric segments', () => {
      const result = calculateMainFilePath(
        'file:///v1/v2/components/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src/', // metadataPrefix
      );

      // maxBackNav(3) - maxSourceBackNav(1) - metadataPrefix(1) = 1 segment for metadataPath
      // Should take 1 segment from end: components, leaving v1/v2 unused
      // But we take from the end: components for metadataPath
      expect(result).toBe('file:///components/src/Button/index.tsx');
    });

    it('should handle special characters in segments', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/@mui/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src/', // metadataPrefix
      );

      expect(result).toBe('file:///@mui/src/Button/index.tsx');
    });

    it('should handle very long synthetic directory sequences', () => {
      const result = calculateMainFilePath(
        'index.tsx',
        30, // maxBackNav (more than 26 letters)
        0, // maxSourceBackNav
      );

      // Should create 30 synthetic directories (a-z, then aa, ab, ac, ad)
      const expected =
        'file:///a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/aa/ab/ac/ad/index.tsx';
      expect(result).toBe(expected);
    });
  });

  describe('metadata prefix edge cases', () => {
    it('should handle metadataPrefix with leading slash', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        '/src/', // metadataPrefix with leading slash
      );

      expect(result).toBe('file:///components/src/Button/index.tsx');
    });

    it('should handle metadataPrefix with multiple slashes', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src//app/', // metadataPrefix with double slash
      );

      // The double slash should be filtered out, resulting in 'src/app/' (2 segments)
      // maxBackNav(3) - maxSourceBackNav(1) - metadataPrefix(2) = 0 segments for metadataPath
      // Should be: metadataPrefix + sourcePath + filename
      expect(result).toBe('file:///src/app/Button/index.tsx');
    });

    it('should handle metadataPrefix that is just slashes', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
        '///', // metadataPrefix that is just slashes
      );

      expect(result).toBe('file:///components/Button/index.tsx');
    });
  });

  describe('optional parameters', () => {
    it('should default maxSourceBackNav to maxBackNav when not provided', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
      );

      // maxSourceBackNav defaults to 2 (same as maxBackNav)
      // Should take 2 segments from end: ['components', 'Button']
      expect(result).toBe('file:///components/Button/index.tsx');
    });

    it('should default metadataPrefix to empty string when not provided', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
      );

      // metadataPrefix defaults to empty string
      // Should take 1 segment for sourcePath (Button) and 2 for metadataPath (lib, components)
      expect(result).toBe('file:///lib/components/Button/index.tsx');
    });

    it('should work with just maxBackNav parameter', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        1, // maxBackNav (maxSourceBackNav defaults to 1, metadataPrefix defaults to '')
      );

      // Should take 1 segment from end: Button
      expect(result).toBe('file:///Button/index.tsx');
    });
  });

  describe('fileName override', () => {
    it('should use provided fileName instead of URL filename', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
        '', // metadataPrefix
        'App.tsx', // fileName override
      );

      expect(result).toBe('file:///components/Button/App.tsx');
    });

    it('should preserve URL structure but override filename', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/deep/nested/Button/index.tsx',
        3, // maxBackNav
        1, // maxSourceBackNav
        'src/', // metadataPrefix
        'Demo.tsx', // fileName override
      );

      expect(result).toBe('file:///nested/src/Button/Demo.tsx');
    });

    it('should ignore URL query/hash when fileName is provided', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx?version=1#main',
        2, // maxBackNav
        1, // maxSourceBackNav
        '', // metadataPrefix
        'App.tsx', // fileName override
      );

      // Query and hash should be ignored when fileName is explicitly provided
      expect(result).toBe('file:///components/Button/App.tsx');
    });

    it('should work with fileName override and no URL filename', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/',
        2, // maxBackNav
        1, // maxSourceBackNav
        '', // metadataPrefix
        'index.tsx', // fileName override
      );

      expect(result).toBe('file:///components/Button/index.tsx');
    });

    it('should work with fileName override and relative URL', () => {
      const result = calculateMainFilePath(
        'lib/components/Button/demo.js',
        2, // maxBackNav
        1, // maxSourceBackNav
        '', // metadataPrefix
        'App.tsx', // fileName override
      );

      expect(result).toBe('file:///components/Button/App.tsx');
    });

    it('should work with empty fileName override', () => {
      const result = calculateMainFilePath(
        'file:///lib/components/Button/index.tsx',
        2, // maxBackNav
        1, // maxSourceBackNav
        '', // metadataPrefix
        '', // empty fileName override
      );

      expect(result).toBe('file:///components/Button');
    });
  });
});
