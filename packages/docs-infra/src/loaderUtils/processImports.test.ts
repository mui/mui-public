import { describe, it, expect } from 'vitest';
import { processImportsWithStoreAt } from './processImports';

describe('processImportsWithStoreAt', () => {
  const mockImportResult = {
    '../Component': { path: '/src/Component', names: ['Component'] },
    './utils': { path: '/src/utils', names: ['helper'] },
  };

  const mockResolvedPathsMap = new Map([
    ['/src/Component', '/src/Component/index.js'],
    ['/src/utils', '/src/utils.ts'],
  ]);

  it('should handle canonical mode without rewriting source', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils';`;

    const result = processImportsWithStoreAt(
      source,
      mockImportResult,
      mockResolvedPathsMap,
      'canonical',
    );

    expect(result.processedSource).toBe(source); // No source rewriting
    expect(result.extraFiles).toEqual({
      '../Component/index.js': 'file:///src/Component/index.js',
      './utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle import mode without rewriting source', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils';`;

    const result = processImportsWithStoreAt(
      source,
      mockImportResult,
      mockResolvedPathsMap,
      'import',
    );

    expect(result.processedSource).toBe(source); // No source rewriting
    expect(result.extraFiles).toEqual({
      '../Component.js': 'file:///src/Component/index.js',
      './utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle flat mode and automatically rewrite source', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils';`;

    // For this test, let's use paths that would actually match the rewrite logic
    const testImportResult = {
      '../Component': { path: '/src/Component', names: ['Component'] },
      './utils': { path: '/src/utils', names: ['helper'] },
    };

    const testResolvedPathsMap = new Map([
      ['/src/Component', '/src/Component.js'], // Direct file, not index
      ['/src/utils', '/src/utils.ts'],
    ]);

    const result = processImportsWithStoreAt(
      source,
      testImportResult,
      testResolvedPathsMap,
      'flat',
    );

    // Source should be rewritten to use same directory imports
    expect(result.processedSource).not.toBe(source);
    expect(result.processedSource).toContain("from './Component'");
    expect(result.processedSource).toContain("from './utils'");

    expect(result.extraFiles).toEqual({
      './Component.js': 'file:///src/Component.js',
      './utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle empty imports', () => {
    const source = 'const x = 1;';

    const result = processImportsWithStoreAt(source, {}, new Map(), 'import');

    expect(result.processedSource).toBe(source);
    expect(result.extraFiles).toEqual({});
  });

  it('should handle canonical mode with non-index files', () => {
    const source = `import Utils from '../utils';`;
    const importResult = {
      '../utils': { path: '/src/utils', names: ['Utils'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/utils', '/src/utils.ts'], // Direct file, not index
    ]);

    const result = processImportsWithStoreAt(source, importResult, resolvedPathsMap, 'canonical');

    expect(result.extraFiles).toEqual({
      '../utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle import mode with index files correctly', () => {
    const source = `import Component from '../Component';`;
    const importResult = {
      '../Component': { path: '/src/Component', names: ['Component'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/Component', '/src/Component/index.tsx'], // Index file
    ]);

    const result = processImportsWithStoreAt(source, importResult, resolvedPathsMap, 'import');

    expect(result.extraFiles).toEqual({
      '../Component.tsx': 'file:///src/Component/index.tsx',
    });
  });

  it('should handle flat mode with different file extensions', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils.js';`;
    const importResult = {
      '../Component': { path: '/src/Component', names: ['Component'] },
      './utils.js': { path: '/src/utils', names: ['helper'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/Component', '/src/Component.tsx'],
      ['/src/utils', '/src/utils.js'],
    ]);

    const result = processImportsWithStoreAt(source, importResult, resolvedPathsMap, 'flat');

    expect(result.extraFiles).toEqual({
      './Component.tsx': 'file:///src/Component.tsx',
      './utils.js': 'file:///src/utils.js',
    });
  });
});
