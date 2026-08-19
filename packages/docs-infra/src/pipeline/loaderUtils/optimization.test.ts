import { describe, it, expect, vi } from 'vitest';
import { resolveImportResult, resolveModulePath } from './resolveModulePath';
import type { DirectoryEntry } from './resolveModulePath';

describe('Filesystem Optimization Tests', () => {
  it('should read a shared directory once for multiple imports', async () => {
    const mockDirectoryReader = vi.fn();
    const mockDirectoryContents: DirectoryEntry[] = [
      { name: 'Button.tsx', isDirectory: false, isFile: true },
      { name: 'Checkbox.ts', isDirectory: false, isFile: true },
      { name: 'Checkbox.d.ts', isDirectory: false, isFile: true },
    ];
    mockDirectoryReader.mockResolvedValue(mockDirectoryContents);

    const result = await resolveImportResult(
      {
        './Button': { url: 'file:///src/Button', names: ['Button'] },
        './Checkbox': {
          url: 'file:///src/Checkbox',
          names: ['Checkbox'],
          includeTypeDefs: true,
        },
      },
      mockDirectoryReader,
    );

    expect(result).toEqual(
      new Map([
        ['file:///src/Button', 'file:///src/Button.tsx'],
        ['file:///src/Checkbox', 'file:///src/Checkbox.ts'],
      ]),
    );
    expect(mockDirectoryReader).toHaveBeenCalledExactlyOnceWith('file:///src');
  });

  it('should index a shared directory once for multiple imports', async () => {
    let indexedEntryCount = 0;
    const createEntry = (name: string): DirectoryEntry => ({
      name,
      isDirectory: false,
      get isFile() {
        indexedEntryCount += 1;
        return true;
      },
    });
    const mockDirectoryReader = vi
      .fn()
      .mockResolvedValue([
        createEntry('Button.tsx'),
        createEntry('Checkbox.ts'),
        createEntry('TextField.tsx'),
      ]);

    await resolveImportResult(
      {
        './Button': { url: 'file:///src/Button', names: ['Button'] },
        './Checkbox': { url: 'file:///src/Checkbox', names: ['Checkbox'] },
        './TextField': { url: 'file:///src/TextField', names: ['TextField'] },
      },
      mockDirectoryReader,
    );

    expect(indexedEntryCount).toBe(3);
  });

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
    expect(mockDirectoryReader).toHaveBeenCalledWith('file:///src');

    // Should return both import and typeImport paths
    expect(result).toEqual({
      import: 'file:///src/Component.ts',
      typeImport: 'file:///src/Component.d.ts',
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
      import: 'file:///src/Component.ts', // .ts comes first in VALUE_IMPORT_EXTENSIONS
      typeImport: 'file:///src/Component.d.ts', // .d.ts comes first in TYPE_IMPORT_EXTENSIONS
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
    expect(mockDirectoryReader).toHaveBeenNthCalledWith(1, 'file:///src');
    expect(mockDirectoryReader).toHaveBeenNthCalledWith(2, 'file:///src/Component');

    // Should return both index paths with correct priorities
    expect(result).toEqual({
      import: 'file:///src/Component/index.ts',
      typeImport: 'file:///src/Component/index.d.ts',
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
      import: 'file:///src/Component.ts',
    });
  });
});
