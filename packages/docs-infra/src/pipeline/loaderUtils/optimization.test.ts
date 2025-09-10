import { describe, it, expect, vi } from 'vitest';
import { resolveModulePath, type DirectoryEntry } from './resolveModulePath';

describe('Filesystem Optimization Tests', () => {
  it('should make only one directory read when includeTypeDefs is true', async () => {
    const mockDirectoryReader = vi.fn();

    // Mock filesystem with both .ts and .d.ts files
    const mockDirectoryContents: DirectoryEntry[] = [
      { name: 'Component.ts', isDirectory: false, isFile: true },
      { name: 'Component.d.ts', isDirectory: false, isFile: true },
    ];

    mockDirectoryReader.mockResolvedValue(mockDirectoryContents);

    // Call with includeTypeDefs = true
    const result = await resolveModulePath(
      '/src/Component',
      mockDirectoryReader,
      {},
      true, // includeTypeDefs
    );

    // Should have made only ONE directory read call
    expect(mockDirectoryReader).toHaveBeenCalledTimes(1);
    expect(mockDirectoryReader).toHaveBeenCalledWith('/src');

    // Should return both import and typeImport paths
    expect(result).toEqual({
      import: '/src/Component.ts',
      typeImport: '/src/Component.d.ts',
    });
  });

  it('should prioritize .d.ts for type imports and .ts for value imports in single pass', async () => {
    const mockDirectoryReader = vi.fn();

    // Mock filesystem with .ts, .tsx, .d.ts files
    const mockDirectoryContents: DirectoryEntry[] = [
      { name: 'Component.tsx', isDirectory: false, isFile: true },
      { name: 'Component.ts', isDirectory: false, isFile: true },
      { name: 'Component.d.ts', isDirectory: false, isFile: true },
    ];

    mockDirectoryReader.mockResolvedValue(mockDirectoryContents);

    // Call with includeTypeDefs = true
    const result = await resolveModulePath(
      '/src/Component',
      mockDirectoryReader,
      {},
      true, // includeTypeDefs
    );

    // Should have made only ONE directory read call
    expect(mockDirectoryReader).toHaveBeenCalledTimes(1);

    // Should prioritize .ts for value imports (VALUE_IMPORT_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.d.ts'])
    // Should prioritize .d.ts for type imports (TYPE_IMPORT_EXTENSIONS: ['.d.ts', '.ts', '.tsx', '.js', '.jsx'])
    expect(result).toEqual({
      import: '/src/Component.ts', // .ts comes first in VALUE_IMPORT_EXTENSIONS
      typeImport: '/src/Component.d.ts', // .d.ts comes first in TYPE_IMPORT_EXTENSIONS
    });
  });

  it('should handle index files with single directory read', async () => {
    const mockDirectoryReader = vi.fn();

    // Mock parent directory
    const parentContents: DirectoryEntry[] = [
      { name: 'Component', isDirectory: true, isFile: false },
    ];

    // Mock Component directory contents
    const componentDirContents: DirectoryEntry[] = [
      { name: 'index.ts', isDirectory: false, isFile: true },
      { name: 'index.d.ts', isDirectory: false, isFile: true },
    ];

    mockDirectoryReader
      .mockResolvedValueOnce(parentContents) // First call for parent directory
      .mockResolvedValueOnce(componentDirContents); // Second call for Component directory

    // Call with includeTypeDefs = true
    const result = await resolveModulePath(
      '/src/Component',
      mockDirectoryReader,
      {},
      true, // includeTypeDefs
    );

    // Should have made TWO directory read calls (parent + Component directory)
    expect(mockDirectoryReader).toHaveBeenCalledTimes(2);
    expect(mockDirectoryReader).toHaveBeenNthCalledWith(1, '/src');
    expect(mockDirectoryReader).toHaveBeenNthCalledWith(2, '/src/Component');

    // Should return both index paths with correct priorities
    expect(result).toEqual({
      import: '/src/Component/index.ts',
      typeImport: '/src/Component/index.d.ts',
    });
  });

  it('should return single path when no type difference exists', async () => {
    const mockDirectoryReader = vi.fn();

    // Mock filesystem with only .ts file
    const mockDirectoryContents: DirectoryEntry[] = [
      { name: 'Component.ts', isDirectory: false, isFile: true },
    ];

    mockDirectoryReader.mockResolvedValue(mockDirectoryContents);

    // Call with includeTypeDefs = true
    const result = await resolveModulePath(
      '/src/Component',
      mockDirectoryReader,
      {},
      true, // includeTypeDefs
    );

    // Should have made only ONE directory read call
    expect(mockDirectoryReader).toHaveBeenCalledTimes(1);

    // Should return only import path when both resolve to the same file
    expect(result).toEqual({
      import: '/src/Component.ts',
    });
  });
});
