import { describe, it, expect } from 'vitest';
import { getFileNameFromUrl } from './getFileNameFromUrl';

describe('getFileNameFromUrl', () => {
  describe('with valid URLs', () => {
    it('should extract filename and extension from file:// URLs', () => {
      const result = getFileNameFromUrl('file:///src/components/Button.tsx');
      expect(result).toEqual({
        fileName: 'Button.tsx',
        extension: '.tsx',
      });
    });

    it('should extract filename and extension from https URLs', () => {
      const result = getFileNameFromUrl('https://example.com/src/utils/helper.js');
      expect(result).toEqual({
        fileName: 'helper.js',
        extension: '.js',
      });
    });

    it('should handle files without extensions', () => {
      const result = getFileNameFromUrl('file:///path/to/README');
      expect(result).toEqual({
        fileName: 'README',
        extension: '',
      });
    });

    it('should handle files with multiple dots', () => {
      const result = getFileNameFromUrl('file:///src/component.test.tsx');
      expect(result).toEqual({
        fileName: 'component.test.tsx',
        extension: '.tsx',
      });
    });

    it('should handle files with dot at the beginning', () => {
      const result = getFileNameFromUrl('file:///src/.gitignore');
      expect(result).toEqual({
        fileName: '.gitignore',
        extension: '',
      });
    });
  });

  describe('with relative and absolute paths', () => {
    it('should handle absolute file paths', () => {
      const result = getFileNameFromUrl('/absolute/path/to/file.jsx');
      expect(result).toEqual({
        fileName: 'file.jsx',
        extension: '.jsx',
      });
    });

    it('should handle relative paths', () => {
      const result = getFileNameFromUrl('../relative/path/to/file.ts');
      expect(result).toEqual({
        fileName: 'file.ts',
        extension: '.ts',
      });
    });

    it('should handle current directory paths', () => {
      const result = getFileNameFromUrl('./current/directory/file.js');
      expect(result).toEqual({
        fileName: 'file.js',
        extension: '.js',
      });
    });
  });

  describe('with edge cases', () => {
    it('should handle malformed URLs gracefully', () => {
      const result = getFileNameFromUrl('not-a-valid-url');
      expect(result).toEqual({
        fileName: 'not-a-valid-url',
        extension: '',
      });
    });

    it('should handle URLs ending with slash', () => {
      const result = getFileNameFromUrl('https://example.com/path/');
      expect(result).toEqual({
        fileName: '',
        extension: '',
      });
    });

    it('should handle empty strings', () => {
      const result = getFileNameFromUrl('');
      expect(result).toEqual({
        fileName: '',
        extension: '',
      });
    });

    it('should handle URLs with query parameters', () => {
      const result = getFileNameFromUrl('https://example.com/file.js?version=1.0');
      expect(result).toEqual({
        fileName: 'file.js',
        extension: '.js',
      });
    });

    it('should handle URLs with hash fragments', () => {
      const result = getFileNameFromUrl('https://example.com/file.js#section');
      expect(result).toEqual({
        fileName: 'file.js',
        extension: '.js',
      });
    });

    it('should handle simple filenames without paths', () => {
      const result = getFileNameFromUrl('file.txt');
      expect(result).toEqual({
        fileName: 'file.txt',
        extension: '.txt',
      });
    });
  });
});
