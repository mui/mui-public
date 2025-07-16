import { describe, it, expect, vi } from 'vitest';
import {
  resolveModulePath,
  resolveModulePaths,
  type DirectoryEntry,
  type DirectoryReader,
} from './resolveModulePath.js';

describe('resolveModulePath', () => {
  const createMockDirectoryReader = (
    directoryStructure: Record<string, DirectoryEntry[]>,
  ): DirectoryReader => {
    return vi.fn(async (path: string) => {
      if (directoryStructure[path]) {
        return directoryStructure[path];
      }
      throw new Error(`Directory not found: ${path}`);
    });
  };

  describe('resolveModulePath', () => {
    it('should resolve a direct file match with .ts extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'utils.js', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      expect(result).toBe('/project/src/Component.ts');
    });

    it('should resolve a direct file match with .tsx extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.tsx', isFile: true, isDirectory: false },
          { name: 'Component.ts', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      // Should find the first match based on extension order
      expect(result).toBe('/project/src/Component.ts');
    });

    it('should resolve a direct file match with .js extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component.js', isFile: true, isDirectory: false }],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      expect(result).toBe('/project/src/Component.js');
    });

    it('should resolve a direct file match with .jsx extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component.jsx', isFile: true, isDirectory: false }],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      expect(result).toBe('/project/src/Component.jsx');
    });

    it('should resolve index file in directory', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component', isFile: false, isDirectory: true },
          { name: 'other.ts', isFile: true, isDirectory: false },
        ],
        '/project/src/Component': [
          { name: 'index.ts', isFile: true, isDirectory: false },
          { name: 'helper.ts', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      expect(result).toBe('/project/src/Component/index.ts');
    });

    it('should prefer direct file over directory with index', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'Component', isFile: false, isDirectory: true },
        ],
        '/project/src/Component': [{ name: 'index.ts', isFile: true, isDirectory: false }],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      expect(result).toBe('/project/src/Component.ts');
    });

    it('should respect custom extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.vue', isFile: true, isDirectory: false },
          { name: 'Component.ts', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader, {
        extensions: ['.vue', '.ts'],
      });
      expect(result).toBe('/project/src/Component.vue');
    });

    it('should throw error when module not found', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Other.ts', isFile: true, isDirectory: false }],
      });

      await expect(resolveModulePath('/project/src/Component', mockReader)).rejects.toThrow(
        'Could not resolve module at path "/project/src/Component". Tried extensions: .ts, .tsx, .js, .jsx',
      );
    });

    it('should throw error when directory cannot be read', async () => {
      const mockReader = createMockDirectoryReader({});

      await expect(resolveModulePath('/project/src/Component', mockReader)).rejects.toThrow(
        'Could not resolve module at path "/project/src/Component". Tried extensions: .ts, .tsx, .js, .jsx',
      );
    });

    it('should handle directory read error gracefully', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component', isFile: false, isDirectory: true }],
        // Missing '/project/src/Component' entry to simulate read error
      });

      await expect(resolveModulePath('/project/src/Component', mockReader)).rejects.toThrow(
        'Could not resolve module at path "/project/src/Component". Tried extensions: .ts, .tsx, .js, .jsx',
      );
    });

    it('should find index file with different extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component', isFile: false, isDirectory: true }],
        '/project/src/Component': [
          { name: 'index.jsx', isFile: true, isDirectory: false },
          { name: 'other.ts', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      expect(result).toBe('/project/src/Component/index.jsx');
    });

    it('should match Node.js resolution behavior for extension priority', async () => {
      // In Node.js, when both .js and .ts exist, behavior depends on the resolver
      // This test documents our current behavior
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.js', isFile: true, isDirectory: false },
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'Component.tsx', isFile: true, isDirectory: false },
          { name: 'Component.jsx', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/Component', mockReader);
      // Our implementation follows the extensions array order: .ts comes first
      expect(result).toBe('/project/src/Component.ts');
    });

    it('should behave like JS with index file resolution', async () => {
      // This matches Node.js behavior: directory/index.* resolution
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'utils', isFile: false, isDirectory: true }],
        '/project/src/utils': [
          { name: 'index.js', isFile: true, isDirectory: false },
          { name: 'helper.js', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('/project/src/utils', mockReader);
      expect(result).toBe('/project/src/utils/index.js');
    });
  });

  describe('resolveModulePaths', () => {
    it('should resolve multiple paths in the same directory efficiently', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component1.ts', isFile: true, isDirectory: false },
          { name: 'Component2.tsx', isFile: true, isDirectory: false },
          { name: 'Component3', isFile: false, isDirectory: true },
        ],
        '/project/src/Component3': [{ name: 'index.js', isFile: true, isDirectory: false }],
      });

      const paths = [
        '/project/src/Component1',
        '/project/src/Component2',
        '/project/src/Component3',
      ];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(3);
      expect(result.get('/project/src/Component1')).toBe('/project/src/Component1.ts');
      expect(result.get('/project/src/Component2')).toBe('/project/src/Component2.tsx');
      expect(result.get('/project/src/Component3')).toBe('/project/src/Component3/index.js');

      // Verify directory was only read once
      expect(mockReader).toHaveBeenCalledWith('/project/src');
      expect(mockReader).toHaveBeenCalledWith('/project/src/Component3');
      expect(mockReader).toHaveBeenCalledTimes(2);
    });

    it('should resolve paths across different directories', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component1.ts', isFile: true, isDirectory: false }],
        '/project/utils': [{ name: 'helper.js', isFile: true, isDirectory: false }],
      });

      const paths = ['/project/src/Component1', '/project/utils/helper'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('/project/src/Component1')).toBe('/project/src/Component1.ts');
      expect(result.get('/project/utils/helper')).toBe('/project/utils/helper.js');

      // Verify both directories were read
      expect(mockReader).toHaveBeenCalledWith('/project/src');
      expect(mockReader).toHaveBeenCalledWith('/project/utils');
      expect(mockReader).toHaveBeenCalledTimes(2);
    });

    it('should return empty results for unresolvable paths', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component1.ts', isFile: true, isDirectory: false }],
      });

      const paths = ['/project/src/Component1', '/project/src/NonExistent'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(1);
      expect(result.get('/project/src/Component1')).toBe('/project/src/Component1.ts');
      expect(result.has('/project/src/NonExistent')).toBe(false);
    });

    it('should handle directory read errors gracefully', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component1.ts', isFile: true, isDirectory: false }],
        // Missing '/project/missing' entry to simulate read error
      });

      const paths = ['/project/src/Component1', '/project/missing/Component2'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(1);
      expect(result.get('/project/src/Component1')).toBe('/project/src/Component1.ts');
      expect(result.has('/project/missing/Component2')).toBe(false);
    });

    it('should work with custom extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component1.vue', isFile: true, isDirectory: false },
          { name: 'Component2.svelte', isFile: true, isDirectory: false },
        ],
      });

      const paths = ['/project/src/Component1', '/project/src/Component2'];

      const result = await resolveModulePaths(paths, mockReader, {
        extensions: ['.vue', '.svelte'],
      });

      expect(result.size).toBe(2);
      expect(result.get('/project/src/Component1')).toBe('/project/src/Component1.vue');
      expect(result.get('/project/src/Component2')).toBe('/project/src/Component2.svelte');
    });

    it('should handle empty input array', async () => {
      const mockReader = createMockDirectoryReader({});

      const result = await resolveModulePaths([], mockReader);

      expect(result.size).toBe(0);
      expect(mockReader).not.toHaveBeenCalled();
    });

    it('should batch index file lookups correctly', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component1', isFile: false, isDirectory: true },
          { name: 'Component2', isFile: false, isDirectory: true },
        ],
        '/project/src/Component1': [{ name: 'index.ts', isFile: true, isDirectory: false }],
        '/project/src/Component2': [{ name: 'index.jsx', isFile: true, isDirectory: false }],
      });

      const paths = ['/project/src/Component1', '/project/src/Component2'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('/project/src/Component1')).toBe('/project/src/Component1/index.ts');
      expect(result.get('/project/src/Component2')).toBe('/project/src/Component2/index.jsx');

      // Should read parent directory once, then each component directory once
      expect(mockReader).toHaveBeenCalledWith('/project/src');
      expect(mockReader).toHaveBeenCalledWith('/project/src/Component1');
      expect(mockReader).toHaveBeenCalledWith('/project/src/Component2');
      expect(mockReader).toHaveBeenCalledTimes(3);
    });
  });
});
