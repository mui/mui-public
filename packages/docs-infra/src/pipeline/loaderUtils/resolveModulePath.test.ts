import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  resolveModulePath,
  resolveModulePaths,
  isJavaScriptModule,
  resolveImportResult,
  resolveVariantPaths,
  type DirectoryEntry,
  type DirectoryReader,
} from './resolveModulePath.js';

describe('resolveModulePath', () => {
  const createMockDirectoryReader = (
    directoryStructure: Record<string, DirectoryEntry[]>,
  ): DirectoryReader => {
    return vi.fn(async (fileUrl: string) => {
      const path = fileURLToPath(fileUrl);
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

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      expect(result).toBe('file:///project/src/Component.ts');
    });

    it('should resolve a direct file match with .tsx extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.tsx', isFile: true, isDirectory: false },
          { name: 'Component.ts', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      // Should find the first match based on extension order
      expect(result).toBe('file:///project/src/Component.ts');
    });

    it('should resolve a direct file match with .js extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component.js', isFile: true, isDirectory: false }],
      });

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      expect(result).toBe('file:///project/src/Component.js');
    });

    it('should resolve a direct file match with .jsx extension', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component.jsx', isFile: true, isDirectory: false }],
      });

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      expect(result).toBe('file:///project/src/Component.jsx');
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

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      expect(result).toBe('file:///project/src/Component/index.ts');
    });

    it('should prefer direct file over directory with index', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'Component', isFile: false, isDirectory: true },
        ],
        '/project/src/Component': [{ name: 'index.ts', isFile: true, isDirectory: false }],
      });

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      expect(result).toBe('file:///project/src/Component.ts');
    });

    it('should respect custom extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.vue', isFile: true, isDirectory: false },
          { name: 'Component.ts', isFile: true, isDirectory: false },
        ],
      });

      const result = await resolveModulePath('file:///project/src/Component', mockReader, {
        extensions: ['.vue', '.ts'],
      });
      expect(result).toBe('file:///project/src/Component.vue');
    });

    it('should throw error when module not found', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Other.ts', isFile: true, isDirectory: false }],
      });

      await expect(resolveModulePath('file:///project/src/Component', mockReader)).rejects.toThrow(
        'Could not resolve module at path "/project/src/Component". Tried extensions: .ts, .tsx, .js, .jsx',
      );
    });

    it('should throw error when directory cannot be read', async () => {
      const mockReader = createMockDirectoryReader({});

      await expect(resolveModulePath('file:///project/src/Component', mockReader)).rejects.toThrow(
        'Could not resolve module at path "/project/src/Component". Tried extensions: .ts, .tsx, .js, .jsx',
      );
    });

    it('should handle directory read error gracefully', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component', isFile: false, isDirectory: true }],
        // Missing '/project/src/Component' entry to simulate read error
      });

      await expect(resolveModulePath('file:///project/src/Component', mockReader)).rejects.toThrow(
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

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      expect(result).toBe('file:///project/src/Component/index.jsx');
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

      const result = await resolveModulePath('file:///project/src/Component', mockReader);
      // Our implementation follows the extensions array order: .ts comes first
      expect(result).toBe('file:///project/src/Component.ts');
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

      const result = await resolveModulePath('file:///project/src/utils', mockReader);
      expect(result).toBe('file:///project/src/utils/index.js');
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
        'file:///project/src/Component1',
        'file:///project/src/Component2',
        'file:///project/src/Component3',
      ];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(3);
      expect(result.get('file:///project/src/Component1')).toBe(
        'file:///project/src/Component1.ts',
      );
      expect(result.get('file:///project/src/Component2')).toBe(
        'file:///project/src/Component2.tsx',
      );
      expect(result.get('file:///project/src/Component3')).toBe(
        'file:///project/src/Component3/index.js',
      );

      // Verify directory was only read once
      expect(mockReader).toHaveBeenCalledWith('file:///project/src');
      expect(mockReader).toHaveBeenCalledWith('file:///project/src/Component3');
      expect(mockReader).toHaveBeenCalledTimes(2);
    });

    it('should resolve paths across different directories', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component1.ts', isFile: true, isDirectory: false }],
        '/project/utils': [{ name: 'helper.js', isFile: true, isDirectory: false }],
      });

      const paths = ['file:///project/src/Component1', 'file:///project/utils/helper'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('file:///project/src/Component1')).toBe(
        'file:///project/src/Component1.ts',
      );
      expect(result.get('file:///project/utils/helper')).toBe('file:///project/utils/helper.js');

      // Verify both directories were read
      expect(mockReader).toHaveBeenCalledWith('file:///project/src');
      expect(mockReader).toHaveBeenCalledWith('file:///project/utils');
      expect(mockReader).toHaveBeenCalledTimes(2);
    });

    it('should return empty results for unresolvable paths', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component1.ts', isFile: true, isDirectory: false }],
      });

      const paths = ['file:///project/src/Component1', 'file:///project/src/NonExistent'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(1);
      expect(result.get('file:///project/src/Component1')).toBe(
        'file:///project/src/Component1.ts',
      );
      expect(result.has('file:///project/src/NonExistent')).toBe(false);
    });

    it('should handle directory read errors gracefully', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component1.ts', isFile: true, isDirectory: false }],
        // Missing '/project/missing' entry to simulate read error
      });

      const paths = ['file:///project/src/Component1', 'file:///project/missing/Component2'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(1);
      expect(result.get('file:///project/src/Component1')).toBe(
        'file:///project/src/Component1.ts',
      );
      expect(result.has('file:///project/missing/Component2')).toBe(false);
    });

    it('should work with custom extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component1.vue', isFile: true, isDirectory: false },
          { name: 'Component2.svelte', isFile: true, isDirectory: false },
        ],
      });

      const paths = ['file:///project/src/Component1', 'file:///project/src/Component2'];

      const result = await resolveModulePaths(paths, mockReader, {
        extensions: ['.vue', '.svelte'],
      });

      expect(result.size).toBe(2);
      expect(result.get('file:///project/src/Component1')).toBe(
        'file:///project/src/Component1.vue',
      );
      expect(result.get('file:///project/src/Component2')).toBe(
        'file:///project/src/Component2.svelte',
      );
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

      const paths = ['file:///project/src/Component1', 'file:///project/src/Component2'];

      const result = await resolveModulePaths(paths, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('file:///project/src/Component1')).toBe(
        'file:///project/src/Component1/index.ts',
      );
      expect(result.get('file:///project/src/Component2')).toBe(
        'file:///project/src/Component2/index.jsx',
      );

      // Should read parent directory once, then each component directory once
      expect(mockReader).toHaveBeenCalledWith('file:///project/src');
      expect(mockReader).toHaveBeenCalledWith('file:///project/src/Component1');
      expect(mockReader).toHaveBeenCalledWith('file:///project/src/Component2');
      expect(mockReader).toHaveBeenCalledTimes(3);
    });
  });

  describe('isJavaScriptModule', () => {
    it('should return true for .ts files', () => {
      expect(isJavaScriptModule('./component.ts')).toBe(true);
    });

    it('should return true for .tsx files', () => {
      expect(isJavaScriptModule('../component.tsx')).toBe(true);
    });

    it('should return true for .js files', () => {
      expect(isJavaScriptModule('./utils.js')).toBe(true);
    });

    it('should return true for .jsx files', () => {
      expect(isJavaScriptModule('../Button.jsx')).toBe(true);
    });

    it('should return true for extensionless imports (assumed to be JS modules)', () => {
      expect(isJavaScriptModule('./Component')).toBe(true);
      expect(isJavaScriptModule('../utils/helper')).toBe(true);
    });

    it('should return false for .css files', () => {
      expect(isJavaScriptModule('./styles.css')).toBe(false);
    });

    it('should return false for .json files', () => {
      expect(isJavaScriptModule('./data.json')).toBe(false);
    });

    it('should return false for .scss files', () => {
      expect(isJavaScriptModule('./styles.scss')).toBe(false);
    });

    it('should return false for .png files', () => {
      expect(isJavaScriptModule('./image.png')).toBe(false);
    });

    it('should return false for .svg files', () => {
      expect(isJavaScriptModule('./icon.svg')).toBe(false);
    });

    it('should return false for other file extensions', () => {
      expect(isJavaScriptModule('./config.yaml')).toBe(false);
      expect(isJavaScriptModule('./README.md')).toBe(false);
    });
  });

  describe('resolveImportResult', () => {
    it('should resolve JS/TS modules and preserve static assets', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'styles.css', isFile: true, isDirectory: false },
        ],
      });

      const importResult = {
        './Component': { url: 'file:///project/src/Component', names: ['Component'] },
        './styles.css': { url: 'file:///project/src/styles.css', names: [] },
      };

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('file:///project/src/Component')).toBe('file:///project/src/Component.ts');
      expect(result.get('file:///project/src/styles.css')).toBe('file:///project/src/styles.css');
    });

    it('should handle mixed imports with different extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Button.tsx', isFile: true, isDirectory: false },
          { name: 'utils.js', isFile: true, isDirectory: false },
        ],
      });

      const importResult = {
        './Button': { url: 'file:///project/src/Button', names: ['Button'] },
        './utils.js': { url: 'file:///project/src/utils.js', names: ['helper'] },
        './data.json': { url: 'file:///project/src/data.json', names: ['default'] },
        './component.css': { url: 'file:///project/src/component.css', names: [] },
      };

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(4);
      expect(result.get('file:///project/src/Button')).toBe('file:///project/src/Button.tsx');
      expect(result.get('file:///project/src/utils.js')).toBe('file:///project/src/utils.js');
      expect(result.get('file:///project/src/data.json')).toBe('file:///project/src/data.json');
      expect(result.get('file:///project/src/component.css')).toBe(
        'file:///project/src/component.css',
      );
    });

    it('should only call resolveModulePaths for JS/TS imports', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component.ts', isFile: true, isDirectory: false }],
      });

      const importResult = {
        './Component': { url: 'file:///project/src/Component', names: ['Component'] },
        './styles.css': { url: 'file:///project/src/styles.css', names: [] },
        './data.json': { url: 'file:///project/src/data.json', names: ['default'] },
      };

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(3);
      expect(result.get('file:///project/src/Component')).toBe('file:///project/src/Component.ts');
      expect(result.get('file:///project/src/styles.css')).toBe('file:///project/src/styles.css');
      expect(result.get('file:///project/src/data.json')).toBe('file:///project/src/data.json');

      // Should only read directory for JS/TS resolution, not for static assets
      expect(mockReader).toHaveBeenCalledWith('file:///project/src');
      expect(mockReader).toHaveBeenCalledTimes(1);
    });

    it('should handle empty import result', async () => {
      const mockReader = createMockDirectoryReader({});

      const importResult = {};

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(0);
      expect(mockReader).not.toHaveBeenCalled();
    });

    it('should handle only static assets', async () => {
      const mockReader = createMockDirectoryReader({});

      const importResult = {
        './styles.css': { url: 'file:///project/src/styles.css', names: [] },
        './data.json': { url: 'file:///project/src/data.json', names: ['default'] },
        './image.png': { url: 'file:///project/src/image.png', names: [] },
      };

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(3);
      expect(result.get('file:///project/src/styles.css')).toBe('file:///project/src/styles.css');
      expect(result.get('file:///project/src/data.json')).toBe('file:///project/src/data.json');
      expect(result.get('file:///project/src/image.png')).toBe('file:///project/src/image.png');

      // Should not read any directories since no JS/TS modules to resolve
      expect(mockReader).not.toHaveBeenCalled();
    });

    it('should handle only JS/TS modules', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'utils.js', isFile: true, isDirectory: false },
        ],
        '/project/lib': [{ name: 'helper', isFile: false, isDirectory: true }],
        '/project/lib/helper': [{ name: 'index.tsx', isFile: true, isDirectory: false }],
      });

      const importResult = {
        './Component': { url: 'file:///project/src/Component', names: ['Component'] },
        './utils': { url: 'file:///project/src/utils', names: ['helper'] },
        '../lib/helper': { url: 'file:///project/lib/helper', names: ['default'] },
      };

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(3);
      expect(result.get('file:///project/src/Component')).toBe('file:///project/src/Component.ts');
      expect(result.get('file:///project/src/utils')).toBe('file:///project/src/utils.js');
      expect(result.get('file:///project/lib/helper')).toBe('file:///project/lib/helper/index.tsx');
    });

    it('should pass custom extensions to resolveModulePaths', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Component.vue', isFile: true, isDirectory: false }],
      });

      const importResult = {
        './Component': { url: 'file:///project/src/Component', names: ['Component'] },
        './styles.css': { url: 'file:///project/src/styles.css', names: [] },
      };

      const result = await resolveImportResult(importResult, mockReader, {
        extensions: ['.vue', '.ts'],
      });

      expect(result.size).toBe(2);
      expect(result.get('file:///project/src/Component')).toBe('file:///project/src/Component.vue');
      expect(result.get('file:///project/src/styles.css')).toBe('file:///project/src/styles.css');
    });

    it('should handle unresolvable JS/TS modules gracefully', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/src': [{ name: 'Other.ts', isFile: true, isDirectory: false }],
      });

      const importResult = {
        './Component': { url: 'file:///project/src/Component', names: ['Component'] },
        './styles.css': { url: 'file:///project/src/styles.css', names: [] },
      };

      const result = await resolveImportResult(importResult, mockReader);

      expect(result.size).toBe(1);
      expect(result.has('file:///project/src/Component')).toBe(false); // Unresolvable JS module
      expect(result.get('file:///project/src/styles.css')).toBe('file:///project/src/styles.css'); // Static asset preserved
    });
  });

  describe('resolveVariantPaths', () => {
    it('should resolve variant paths and return file URLs', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos': [
          { name: 'Basic.tsx', isFile: true, isDirectory: false },
          { name: 'Advanced.ts', isFile: true, isDirectory: false },
        ],
      });

      const variants = {
        basic: 'file:///project/demos/Basic',
        advanced: 'file:///project/demos/Advanced',
      };

      const result = await resolveVariantPaths(variants, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('basic')).toBe('file:///project/demos/Basic.tsx');
      expect(result.get('advanced')).toBe('file:///project/demos/Advanced.ts');
    });

    it('should handle variants with directory index files', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos': [
          { name: 'Basic', isFile: false, isDirectory: true },
          { name: 'Advanced.ts', isFile: true, isDirectory: false },
        ],
        '/project/demos/Basic': [
          { name: 'index.tsx', isFile: true, isDirectory: false },
          { name: 'helper.ts', isFile: true, isDirectory: false },
        ],
      });

      const variants = {
        basic: 'file:///project/demos/Basic',
        advanced: 'file:///project/demos/Advanced',
      };

      const result = await resolveVariantPaths(variants, mockReader);

      expect(result.size).toBe(2);
      expect(result.get('basic')).toBe('file:///project/demos/Basic/index.tsx');
      expect(result.get('advanced')).toBe('file:///project/demos/Advanced.ts');
    });

    it('should skip unresolvable variants', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos': [
          { name: 'Basic.tsx', isFile: true, isDirectory: false },
          // Missing Advanced.ts file
        ],
      });

      const variants = {
        basic: 'file:///project/demos/Basic',
        advanced: 'file:///project/demos/Advanced', // This won't resolve
        missing: 'file:///project/demos/Missing', // This won't resolve
      };

      const result = await resolveVariantPaths(variants, mockReader);

      expect(result.size).toBe(1);
      expect(result.get('basic')).toBe('file:///project/demos/Basic.tsx');
      expect(result.has('advanced')).toBe(false);
      expect(result.has('missing')).toBe(false);
    });

    it('should respect custom extensions', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos': [
          { name: 'Basic.vue', isFile: true, isDirectory: false },
          { name: 'Advanced.svelte', isFile: true, isDirectory: false },
        ],
      });

      const variants = {
        basic: 'file:///project/demos/Basic',
        advanced: 'file:///project/demos/Advanced',
      };

      const result = await resolveVariantPaths(variants, mockReader, {
        extensions: ['.vue', '.svelte'],
      });

      expect(result.size).toBe(2);
      expect(result.get('basic')).toBe('file:///project/demos/Basic.vue');
      expect(result.get('advanced')).toBe('file:///project/demos/Advanced.svelte');
    });

    it('should handle empty variants object', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos': [],
      });

      const variants = {};

      const result = await resolveVariantPaths(variants, mockReader);

      expect(result.size).toBe(0);
    });

    it('should handle variants in different directories', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos/basic': [{ name: 'Component.tsx', isFile: true, isDirectory: false }],
        '/project/demos/advanced': [{ name: 'Component.ts', isFile: true, isDirectory: false }],
        '/project/examples': [{ name: 'Example.js', isFile: true, isDirectory: false }],
      });

      const variants = {
        basic: 'file:///project/demos/basic/Component',
        advanced: 'file:///project/demos/advanced/Component',
        example: 'file:///project/examples/Example',
      };

      const result = await resolveVariantPaths(variants, mockReader);

      expect(result.size).toBe(3);
      expect(result.get('basic')).toBe('file:///project/demos/basic/Component.tsx');
      expect(result.get('advanced')).toBe('file:///project/demos/advanced/Component.ts');
      expect(result.get('example')).toBe('file:///project/examples/Example.js');
    });

    it('should follow extension priority order', async () => {
      const mockReader = createMockDirectoryReader({
        '/project/demos': [
          { name: 'Component.js', isFile: true, isDirectory: false },
          { name: 'Component.ts', isFile: true, isDirectory: false },
          { name: 'Component.tsx', isFile: true, isDirectory: false },
          { name: 'Component.jsx', isFile: true, isDirectory: false },
        ],
      });

      const variants = {
        component: 'file:///project/demos/Component',
      };

      const result = await resolveVariantPaths(variants, mockReader);

      expect(result.size).toBe(1);
      // Should prefer .ts over other extensions based on default priority
      expect(result.get('component')).toBe('file:///project/demos/Component.ts');
    });
  });
});
