import { describe, it, expect, vi } from 'vitest';
import { resolveBinEntries, resolveExportsEntries, type ExportsField } from './resolve-entrypoints';

vi.mock('globby', () => ({
  globby: vi.fn((pattern: string) => {
    // Simulate file matching based on patterns
    if (pattern === 'src/adapters/*.ts') {
      return Promise.resolve(['src/adapters/redis.ts', 'src/adapters/memory.ts']);
    }
    if (pattern === 'src/*/index.ts') {
      return Promise.resolve(['src/utils/index.ts', 'src/core/index.ts']);
    }
    if (pattern === 'src/components/*.tsx') {
      return Promise.resolve(['src/components/Button.tsx', 'src/components/Input.tsx']);
    }
    return Promise.resolve([]);
  }),
}));

describe('resolveBinEntries', () => {
  it('should return empty array for undefined bin', async () => {
    const result = await resolveBinEntries(undefined, '/root');
    expect(result).toEqual([]);
  });

  it('should handle string bin entry', async () => {
    const result = await resolveBinEntries('./src/cli.ts', '/root');
    expect(result).toEqual([
      {
        exportKey: 'bin',
        source: 'src/cli.ts',
        platform: 'node',
        isBin: true,
        originalKey: './src/cli.ts',
      },
    ]);
  });

  it('should handle object bin entry with single command', async () => {
    const result = await resolveBinEntries({ mycli: './src/cli.ts' }, '/root');
    expect(result).toEqual([
      {
        exportKey: 'bin/mycli',
        source: 'src/cli.ts',
        platform: 'node',
        isBin: true,
        binName: 'mycli',
        originalKey: 'mycli',
      },
    ]);
  });

  it('should handle object bin entry with multiple commands', async () => {
    const result = await resolveBinEntries(
      {
        'my-cli': './src/cli.ts',
        'my-serve': './src/serve.ts',
      },
      '/root',
    );
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      exportKey: 'bin/my-cli',
      source: 'src/cli.ts',
      platform: 'node',
      isBin: true,
      binName: 'my-cli',
      originalKey: 'my-cli',
    });
    expect(result).toContainEqual({
      exportKey: 'bin/my-serve',
      source: 'src/serve.ts',
      platform: 'node',
      isBin: true,
      binName: 'my-serve',
      originalKey: 'my-serve',
    });
  });
});

describe('resolveExportsEntries', () => {
  describe('basic exports', () => {
    it('should return empty array for undefined exports', async () => {
      const result = await resolveExportsEntries(undefined, '/root');
      expect(result).toEqual([]);
    });

    it('should handle string exports and normalize "." to "index"', async () => {
      const result = await resolveExportsEntries('./src/index.ts', '/root');
      expect(result).toEqual([
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ]);
    });

    it('should handle simple object exports with normalization', async () => {
      const result = await resolveExportsEntries(
        {
          '.': './src/index.ts',
          './utils': './src/utils.ts',
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'index',
        source: 'src/index.ts',
        platform: 'neutral',
        originalKey: '.',
      });
      expect(result).toContainEqual({
        exportKey: 'utils',
        source: 'src/utils.ts',
        platform: 'neutral',
        originalKey: './utils',
      });
    });

    it('should NOT append /index for non-glob subpath exports pointing to index files', async () => {
      const result = await resolveExportsEntries(
        {
          './utils': './src/utils/index.ts',
        },
        '/root',
      );
      expect(result).toEqual([
        {
          exportKey: 'utils',
          source: 'src/utils/index.ts',
          platform: 'neutral',
          originalKey: './utils',
        },
      ]);
    });
  });

  describe('platform conditions', () => {
    it('should handle nested conditions with node condition and append condition suffix', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            node: './src/server.ts',
            default: './src/main.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      // node condition appends .node suffix
      expect(result).toContainEqual({
        exportKey: 'index.node',
        condition: 'node',
        source: 'src/server.ts',
        platform: 'node',
        originalKey: '.',
      });
      // default condition does NOT append suffix
      expect(result).toContainEqual({
        exportKey: 'index',
        condition: 'default',
        source: 'src/main.ts',
        platform: 'neutral',
        originalKey: '.',
      });
    });

    it('should handle nested conditions with browser condition and append condition suffix', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            browser: './src/browser.ts',
            default: './src/main.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'index.browser',
        condition: 'browser',
        source: 'src/browser.ts',
        platform: 'browser',
        originalKey: '.',
      });
      expect(result).toContainEqual({
        exportKey: 'index',
        condition: 'default',
        source: 'src/main.ts',
        platform: 'neutral',
        originalKey: '.',
      });
    });

    it('should handle react-server condition with suffix', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            'react-server': './src/server.ts',
            default: './src/main.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'index.react-server',
        condition: 'react-server',
        source: 'src/server.ts',
        platform: 'node',
        originalKey: '.',
      });
    });

    it('should handle worker condition with suffix', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            worker: './src/worker.ts',
            default: './src/main.ts',
          },
        },
        '/root',
      );
      expect(result).toContainEqual({
        exportKey: 'index.worker',
        condition: 'worker',
        source: 'src/worker.ts',
        platform: 'browser',
        originalKey: '.',
      });
    });

    it('should handle deno condition with suffix', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            deno: './src/deno.ts',
            default: './src/main.ts',
          },
        },
        '/root',
      );
      expect(result).toContainEqual({
        exportKey: 'index.deno',
        condition: 'deno',
        source: 'src/deno.ts',
        platform: 'node',
        originalKey: '.',
      });
    });

    it('should handle import/require conditions with suffix', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            import: './src/esm.ts',
            require: './src/cjs.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'index.import',
        condition: 'import',
        source: 'src/esm.ts',
        platform: 'neutral',
        originalKey: '.',
      });
      expect(result).toContainEqual({
        exportKey: 'index.require',
        condition: 'require',
        source: 'src/cjs.ts',
        platform: 'neutral',
        originalKey: '.',
      });
    });

    it('should handle subpath exports with condition suffix', async () => {
      const result = await resolveExportsEntries(
        {
          './utils': {
            'react-server': './src/utils/server.ts',
            default: './src/utils/index.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'utils.react-server',
        condition: 'react-server',
        source: 'src/utils/server.ts',
        platform: 'node',
        originalKey: './utils',
      });
      expect(result).toContainEqual({
        exportKey: 'utils',
        condition: 'default',
        source: 'src/utils/index.ts',
        platform: 'neutral',
        originalKey: './utils',
      });
    });
  });

  describe('condition filtering', () => {
    it('should skip types condition', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            types: './dist/index.d.ts',
            import: './src/main.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        exportKey: 'index.import',
        condition: 'import',
        source: 'src/main.ts',
        platform: 'neutral',
        originalKey: '.',
      });
    });

    it('should skip non-source file conditions', async () => {
      // Files without recognized extensions (.json, .wasm, etc.) are skipped
      const result = await resolveExportsEntries(
        {
          '.': {
            import: './dist/data.json',
            require: './dist/module.wasm',
          },
        },
        '/root',
      );
      expect(result).toEqual([]);
    });
  });

  describe('source file extensions', () => {
    it('should include .js files as valid source files', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            import: './src/main.js',
          },
        },
        '/root',
      );
      expect(result).toEqual([
        {
          exportKey: 'index.import',
          condition: 'import',
          source: 'src/main.js',
          platform: 'neutral',
          originalKey: '.',
        },
      ]);
    });

    it('should handle .tsx source files', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            default: './src/Component.tsx',
          },
        },
        '/root',
      );
      expect(result).toEqual([
        {
          exportKey: 'index',
          condition: 'default',
          source: 'src/Component.tsx',
          platform: 'neutral',
          originalKey: '.',
        },
      ]);
    });

    it('should handle .mts source files', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            default: './src/main.mts',
          },
        },
        '/root',
      );
      expect(result).toEqual([
        {
          exportKey: 'index',
          condition: 'default',
          source: 'src/main.mts',
          platform: 'neutral',
          originalKey: '.',
        },
      ]);
    });

    it('should handle .cts source files', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            default: './src/main.cts',
          },
        },
        '/root',
      );
      expect(result).toEqual([
        {
          exportKey: 'index',
          condition: 'default',
          source: 'src/main.cts',
          platform: 'neutral',
          originalKey: '.',
        },
      ]);
    });

    it('should handle .jsx source files', async () => {
      const result = await resolveExportsEntries(
        {
          '.': {
            default: './src/App.jsx',
          },
        },
        '/root',
      );
      expect(result).toEqual([
        {
          exportKey: 'index',
          condition: 'default',
          source: 'src/App.jsx',
          platform: 'neutral',
          originalKey: '.',
        },
      ]);
    });
  });

  describe('glob patterns', () => {
    it('should handle glob patterns in exports', async () => {
      const result = await resolveExportsEntries(
        {
          './adapters/*': './src/adapters/*.ts',
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      // Non-index files don't get /index appended
      expect(result).toContainEqual({
        exportKey: 'adapters/redis',
        source: 'src/adapters/redis.ts',
        platform: 'neutral',
        originalKey: './adapters/redis',
      });
      expect(result).toContainEqual({
        exportKey: 'adapters/memory',
        source: 'src/adapters/memory.ts',
        platform: 'neutral',
        originalKey: './adapters/memory',
      });
    });

    it('should handle glob patterns in nested conditions with condition suffix', async () => {
      const result = await resolveExportsEntries(
        {
          './adapters/*': {
            node: './src/adapters/*.ts',
          },
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'adapters/redis.node',
        condition: 'node',
        source: 'src/adapters/redis.ts',
        platform: 'node',
        originalKey: './adapters/redis',
      });
      expect(result).toContainEqual({
        exportKey: 'adapters/memory.node',
        condition: 'node',
        source: 'src/adapters/memory.ts',
        platform: 'node',
        originalKey: './adapters/memory',
      });
    });

    it('should append /index for glob-expanded index files', async () => {
      const result = await resolveExportsEntries(
        {
          './*': './src/*/index.ts',
        },
        '/root',
      );
      expect(result).toHaveLength(2);
      // Index files get /index appended only for glob patterns
      expect(result).toContainEqual({
        exportKey: 'utils/index',
        source: 'src/utils/index.ts',
        platform: 'neutral',
        originalKey: './utils',
      });
      expect(result).toContainEqual({
        exportKey: 'core/index',
        source: 'src/core/index.ts',
        platform: 'neutral',
        originalKey: './core',
      });
    });

    it('should return empty array when no files match glob pattern', async () => {
      const result = await resolveExportsEntries(
        {
          './nonexistent/*': './src/nonexistent/*.ts',
        },
        '/root',
      );
      expect(result).toEqual([]);
    });
  });

  describe('deeply nested conditions', () => {
    it('should handle deeply nested conditions with condition suffix', async () => {
      // The type system doesn't fully express nested conditions, but the runtime handles them
      const result = await resolveExportsEntries(
        {
          '.': {
            import: {
              node: './src/node.ts',
              browser: './src/browser.ts',
            },
          },
        } as unknown as ExportsField,
        '/root',
      );
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        exportKey: 'index.node',
        condition: 'node',
        source: 'src/node.ts',
        platform: 'node',
        originalKey: '.',
      });
      expect(result).toContainEqual({
        exportKey: 'index.browser',
        condition: 'browser',
        source: 'src/browser.ts',
        platform: 'browser',
        originalKey: '.',
      });
    });
  });
});
