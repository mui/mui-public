import { describe, it, expect } from 'vitest';
import { pathToFileUrl } from './pathToFileUrl';

describe('pathToFileUrl', () => {
  describe('Unix paths', () => {
    it('converts absolute Unix path to file URL', () => {
      expect(pathToFileUrl('/home/user/project/file.ts')).toBe('file:///home/user/project/file.ts');
    });

    it('handles root path', () => {
      expect(pathToFileUrl('/file.ts')).toBe('file:///file.ts');
    });

    it('handles deeply nested paths', () => {
      expect(pathToFileUrl('/a/b/c/d/e/file.ts')).toBe('file:///a/b/c/d/e/file.ts');
    });
  });

  describe('Windows paths', () => {
    it('converts Windows path with forward slashes', () => {
      expect(pathToFileUrl('C:/Users/project/file.ts')).toBe('file:///C:/Users/project/file.ts');
    });

    it('converts Windows path with backslashes to forward slashes', () => {
      expect(pathToFileUrl('C:\\Users\\project\\file.ts')).toBe('file:///C:/Users/project/file.ts');
    });

    it('handles different drive letters', () => {
      expect(pathToFileUrl('D:/Projects/file.ts')).toBe('file:///D:/Projects/file.ts');
      expect(pathToFileUrl('E:/file.ts')).toBe('file:///E:/file.ts');
    });

    it('handles lowercase drive letters', () => {
      expect(pathToFileUrl('c:/Users/file.ts')).toBe('file:///c:/Users/file.ts');
    });

    it('handles mixed slashes', () => {
      expect(pathToFileUrl('C:/Users\\project/file.ts')).toBe('file:///C:/Users/project/file.ts');
    });
  });

  describe('already URLs', () => {
    it('returns file:// URLs unchanged', () => {
      expect(pathToFileUrl('file:///home/user/file.ts')).toBe('file:///home/user/file.ts');
      expect(pathToFileUrl('file:///C:/Users/file.ts')).toBe('file:///C:/Users/file.ts');
    });

    it('returns http:// URLs unchanged', () => {
      expect(pathToFileUrl('http://example.com/file.ts')).toBe('http://example.com/file.ts');
    });

    it('returns https:// URLs unchanged', () => {
      expect(pathToFileUrl('https://example.com/file.ts')).toBe('https://example.com/file.ts');
    });
  });
});
