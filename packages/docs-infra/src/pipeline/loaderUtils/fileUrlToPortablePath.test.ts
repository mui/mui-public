import { describe, it, expect } from 'vitest';
import { fileUrlToPortablePath, portablePathToFileUrl } from './fileUrlToPortablePath';

describe('fileUrlToPortablePath', () => {
  describe('Unix file:// URLs', () => {
    it('should convert Unix file:// URL to portable path', () => {
      expect(fileUrlToPortablePath('file:///home/user/file.ts')).toBe('/home/user/file.ts');
    });

    it('should handle deeply nested Unix paths', () => {
      expect(fileUrlToPortablePath('file:///var/www/app/src/components/Button.tsx')).toBe(
        '/var/www/app/src/components/Button.tsx',
      );
    });

    it('should handle root-level files', () => {
      expect(fileUrlToPortablePath('file:///file.ts')).toBe('/file.ts');
    });
  });

  describe('Windows file:// URLs', () => {
    it('should convert Windows file:// URL to portable path', () => {
      expect(fileUrlToPortablePath('file:///C:/Users/dev/file.ts')).toBe('/C:/Users/dev/file.ts');
    });

    it('should handle deeply nested Windows paths', () => {
      expect(fileUrlToPortablePath('file:///C:/Users/dev/project/src/components/Button.tsx')).toBe(
        '/C:/Users/dev/project/src/components/Button.tsx',
      );
    });

    it('should handle lowercase drive letters', () => {
      expect(fileUrlToPortablePath('file:///c:/Users/dev/file.ts')).toBe('/c:/Users/dev/file.ts');
    });

    it('should handle other drive letters', () => {
      expect(fileUrlToPortablePath('file:///D:/Projects/app/index.ts')).toBe(
        '/D:/Projects/app/index.ts',
      );
    });
  });

  describe('already portable paths (passthrough)', () => {
    it('should pass through Unix portable paths unchanged', () => {
      expect(fileUrlToPortablePath('/home/user/file.ts')).toBe('/home/user/file.ts');
    });

    it('should pass through Windows portable paths unchanged', () => {
      expect(fileUrlToPortablePath('/C:/Users/dev/file.ts')).toBe('/C:/Users/dev/file.ts');
    });
  });

  describe('Windows paths with backslashes', () => {
    it('should convert Windows backslash path to portable path', () => {
      expect(fileUrlToPortablePath('C:\\Users\\dev\\file.ts')).toBe('/C:/Users/dev/file.ts');
    });

    it('should handle deeply nested backslash paths', () => {
      expect(fileUrlToPortablePath('C:\\Users\\dev\\project\\src\\components\\Button.tsx')).toBe(
        '/C:/Users/dev/project/src/components/Button.tsx',
      );
    });

    it('should handle lowercase drive letters with backslashes', () => {
      expect(fileUrlToPortablePath('c:\\Users\\dev\\file.ts')).toBe('/c:/Users/dev/file.ts');
    });

    it('should handle mixed slashes', () => {
      expect(fileUrlToPortablePath('C:\\Users/dev\\project/file.ts')).toBe(
        '/C:/Users/dev/project/file.ts',
      );
    });
  });

  describe('Windows paths with forward slashes (no leading slash)', () => {
    it('should add leading slash to Windows path with forward slashes', () => {
      expect(fileUrlToPortablePath('C:/Users/dev/file.ts')).toBe('/C:/Users/dev/file.ts');
    });

    it('should handle lowercase drive letter', () => {
      expect(fileUrlToPortablePath('d:/Projects/app/index.ts')).toBe('/d:/Projects/app/index.ts');
    });
  });

  describe('edge cases', () => {
    it('should handle file:// URLs with backslashes (malformed but possible)', () => {
      expect(fileUrlToPortablePath('file:///C:\\Users\\dev\\file.ts')).toBe(
        '/C:/Users/dev/file.ts',
      );
    });

    it('should handle empty path after file://', () => {
      expect(fileUrlToPortablePath('file:///')).toBe('/');
    });

    it('should handle relative paths', () => {
      expect(fileUrlToPortablePath('./src/file.ts')).toBe('./src/file.ts');
    });

    it('should handle relative paths with backslashes', () => {
      expect(fileUrlToPortablePath('.\\src\\file.ts')).toBe('./src/file.ts');
    });
  });
});

describe('portablePathToFileUrl', () => {
  describe('Unix portable paths', () => {
    it('should convert Unix portable path to file:// URL', () => {
      expect(portablePathToFileUrl('/home/user/file.ts')).toBe('file:///home/user/file.ts');
    });

    it('should handle deeply nested paths', () => {
      expect(portablePathToFileUrl('/var/www/app/src/components/Button.tsx')).toBe(
        'file:///var/www/app/src/components/Button.tsx',
      );
    });
  });

  describe('Windows portable paths', () => {
    it('should convert Windows portable path to file:// URL', () => {
      expect(portablePathToFileUrl('/C:/Users/dev/file.ts')).toBe('file:///C:/Users/dev/file.ts');
    });

    it('should handle lowercase drive letters', () => {
      expect(portablePathToFileUrl('/c:/Users/dev/file.ts')).toBe('file:///c:/Users/dev/file.ts');
    });
  });

  describe('already URLs (passthrough)', () => {
    it('should pass through file:// URLs unchanged', () => {
      expect(portablePathToFileUrl('file:///home/user/file.ts')).toBe('file:///home/user/file.ts');
    });

    it('should pass through http:// URLs unchanged', () => {
      expect(portablePathToFileUrl('http://example.com/file.ts')).toBe(
        'http://example.com/file.ts',
      );
    });

    it('should pass through https:// URLs unchanged', () => {
      expect(portablePathToFileUrl('https://example.com/file.ts')).toBe(
        'https://example.com/file.ts',
      );
    });
  });

  describe('roundtrip conversion', () => {
    it('should roundtrip Unix file:// URL', () => {
      const original = 'file:///home/user/file.ts';
      const portable = fileUrlToPortablePath(original);
      const back = portablePathToFileUrl(portable);
      expect(back).toBe(original);
    });

    it('should roundtrip Windows file:// URL', () => {
      const original = 'file:///C:/Users/dev/file.ts';
      const portable = fileUrlToPortablePath(original);
      const back = portablePathToFileUrl(portable);
      expect(back).toBe(original);
    });

    it('should roundtrip Unix portable path', () => {
      const original = '/home/user/file.ts';
      const url = portablePathToFileUrl(original);
      const back = fileUrlToPortablePath(url);
      expect(back).toBe(original);
    });

    it('should roundtrip Windows portable path', () => {
      const original = '/C:/Users/dev/file.ts';
      const url = portablePathToFileUrl(original);
      const back = fileUrlToPortablePath(url);
      expect(back).toBe(original);
    });
  });
});
