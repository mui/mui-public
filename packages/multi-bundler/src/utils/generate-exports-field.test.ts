import { describe, it, expect } from 'vitest';
import { generateExportsField, createEntriesMap, type OutputChunk } from './generate-exports-field';
import type { ResolvedEntry } from './resolve-entrypoints';

describe('generateExportsField', () => {
  describe('basic exports', () => {
    it('should generate ESM-only exports', () => {
      const outputs: OutputChunk[] = [{ name: 'index', outputFile: 'index.mjs', format: 'esm' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: './index.mjs',
          },
        },
        bin: {},
      });
    });

    it('should generate CJS-only exports', () => {
      const outputs: OutputChunk[] = [{ name: 'index', outputFile: 'index.cjs', format: 'cjs' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            require: './index.cjs',
          },
        },
        bin: {},
      });
    });

    it('should generate both ESM and CJS exports', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'index', outputFile: 'index.cjs', format: 'cjs' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: './index.mjs',
            require: './index.cjs',
          },
        },
        bin: {},
      });
    });
  });

  describe('exports with types', () => {
    it('should generate exports with ESM types', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'index.d', outputFile: 'index.d.mts', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: {
              types: './index.d.mts',
              default: './index.mjs',
            },
          },
        },
        bin: {},
      });
    });

    it('should generate exports with CJS types', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.cjs', format: 'cjs' },
        { name: 'index.d', outputFile: 'index.d.cts', format: 'cjs' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            require: {
              types: './index.d.cts',
              default: './index.cjs',
            },
          },
        },
        bin: {},
      });
    });

    it('should generate exports with both ESM and CJS types', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'index', outputFile: 'index.cjs', format: 'cjs' },
        { name: 'index.d', outputFile: 'index.d.mts', format: 'esm' },
        { name: 'index.d', outputFile: 'index.d.cts', format: 'cjs' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: {
              types: './index.d.mts',
              default: './index.mjs',
            },
            require: {
              types: './index.d.cts',
              default: './index.cjs',
            },
          },
        },
        bin: {},
      });
    });
  });

  describe('multiple entry points', () => {
    it('should generate exports for multiple entries', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'utils', outputFile: 'utils.mjs', format: 'esm' },
        { name: 'helpers', outputFile: 'helpers.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
        {
          exportKey: 'utils',
          source: 'src/utils.ts',
          platform: 'neutral',
          originalKey: './utils',
        },
        {
          exportKey: 'helpers',
          source: 'src/helpers.ts',
          platform: 'neutral',
          originalKey: './helpers',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: './index.mjs',
          },
          './utils': {
            import: './utils.mjs',
          },
          './helpers': {
            import: './helpers.mjs',
          },
        },
        bin: {},
      });
    });

    it('should handle nested export paths', () => {
      const outputs: OutputChunk[] = [
        { name: 'adapters/react', outputFile: 'adapters/react.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'adapters/react',
          source: 'src/adapters/react.ts',
          platform: 'neutral',
          originalKey: './adapters/react',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          './adapters/react': {
            import: './adapters/react.mjs',
          },
        },
        bin: {},
      });
    });
  });

  describe('condition-specific entries', () => {
    it('should nest react-server condition under export path', () => {
      const outputs: OutputChunk[] = [
        { name: 'index.react-server', outputFile: 'index.react-server.mjs', format: 'esm' },
        { name: 'index.react-server', outputFile: 'index.react-server.cjs', format: 'cjs' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index.react-server',
          condition: 'react-server',
          source: 'src/index.ts',
          platform: 'node',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            'react-server': {
              import: './index.react-server.mjs',
              require: './index.react-server.cjs',
            },
          },
        },
        bin: {},
      });
    });

    it('should handle multiple conditions for same export path', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'index.react-server', outputFile: 'index.react-server.mjs', format: 'esm' },
        { name: 'index.node', outputFile: 'index.node.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          condition: 'default',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
        {
          exportKey: 'index.react-server',
          condition: 'react-server',
          source: 'src/index.server.ts',
          platform: 'node',
          originalKey: '.',
        },
        {
          exportKey: 'index.node',
          condition: 'node',
          source: 'src/index.node.ts',
          platform: 'node',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: './index.mjs',
            'react-server': {
              import: './index.react-server.mjs',
            },
            node: {
              import: './index.node.mjs',
            },
          },
        },
        bin: {},
      });
    });

    it('should handle conditions with types', () => {
      const outputs: OutputChunk[] = [
        { name: 'utils.react-server', outputFile: 'utils.react-server.mjs', format: 'esm' },
        { name: 'utils.react-server', outputFile: 'utils.react-server.cjs', format: 'cjs' },
        { name: 'utils.react-server.d', outputFile: 'utils.react-server.d.mts', format: 'esm' },
        { name: 'utils.react-server.d', outputFile: 'utils.react-server.d.cts', format: 'cjs' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'utils.react-server',
          condition: 'react-server',
          source: 'src/utils.ts',
          platform: 'node',
          originalKey: './utils',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          './utils': {
            'react-server': {
              import: {
                types: './utils.react-server.d.mts',
                default: './utils.react-server.mjs',
              },
              require: {
                types: './utils.react-server.d.cts',
                default: './utils.react-server.cjs',
              },
            },
          },
        },
        bin: {},
      });
    });
  });

  describe('bin entries', () => {
    it('should generate single bin entry', () => {
      const outputs: OutputChunk[] = [{ name: 'bin', outputFile: 'bin.mjs', format: 'esm' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'bin',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          originalKey: './src/cli.ts',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: './bin.mjs',
      });
    });

    it('should generate named bin entry', () => {
      const outputs: OutputChunk[] = [
        { name: 'bin/my-cli', outputFile: 'bin/my-cli.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'bin/my-cli',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          binName: 'my-cli',
          originalKey: 'my-cli',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: {
          'my-cli': './bin/my-cli.mjs',
        },
      });
    });

    it('should generate multiple bin entries', () => {
      const outputs: OutputChunk[] = [
        { name: 'bin/cli', outputFile: 'bin/cli.mjs', format: 'esm' },
        { name: 'bin/dev', outputFile: 'bin/dev.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'bin/cli',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          binName: 'cli',
          originalKey: 'cli',
        },
        {
          exportKey: 'bin/dev',
          source: 'src/dev.ts',
          platform: 'node',
          isBin: true,
          binName: 'dev',
          originalKey: 'dev',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: {
          cli: './bin/cli.mjs',
          dev: './bin/dev.mjs',
        },
      });
    });

    it('should prefer ESM over CJS for bin entries', () => {
      const outputs: OutputChunk[] = [
        { name: 'bin', outputFile: 'bin.mjs', format: 'esm' },
        { name: 'bin', outputFile: 'bin.cjs', format: 'cjs' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'bin',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          originalKey: './src/cli.ts',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: './bin.mjs',
      });
    });

    it('should fall back to CJS if no ESM for bin', () => {
      const outputs: OutputChunk[] = [{ name: 'bin', outputFile: 'bin.cjs', format: 'cjs' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'bin',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          originalKey: './src/cli.ts',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: './bin.cjs',
      });
    });
  });

  describe('mixed entries', () => {
    it('should handle exports and bin together', () => {
      const outputs: OutputChunk[] = [
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'index', outputFile: 'index.cjs', format: 'cjs' },
        { name: 'index.d', outputFile: 'index.d.mts', format: 'esm' },
        { name: 'index.d', outputFile: 'index.d.cts', format: 'cjs' },
        { name: 'bin', outputFile: 'bin.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
        {
          exportKey: 'bin',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          originalKey: './src/cli.ts',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: {
              types: './index.d.mts',
              default: './index.mjs',
            },
            require: {
              types: './index.d.cts',
              default: './index.cjs',
            },
          },
        },
        bin: './bin.mjs',
      });
    });

    it('should handle complex package with multiple exports, conditions, and bin', () => {
      const outputs: OutputChunk[] = [
        // Main entry
        { name: 'index', outputFile: 'index.mjs', format: 'esm' },
        { name: 'index', outputFile: 'index.cjs', format: 'cjs' },
        { name: 'index.d', outputFile: 'index.d.mts', format: 'esm' },
        { name: 'index.d', outputFile: 'index.d.cts', format: 'cjs' },
        // Utils with react-server condition
        { name: 'utils', outputFile: 'utils.mjs', format: 'esm' },
        { name: 'utils', outputFile: 'utils.cjs', format: 'cjs' },
        { name: 'utils.react-server', outputFile: 'utils.react-server.mjs', format: 'esm' },
        { name: 'utils.react-server', outputFile: 'utils.react-server.cjs', format: 'cjs' },
        { name: 'utils.react-server.d', outputFile: 'utils.react-server.d.mts', format: 'esm' },
        { name: 'utils.react-server.d', outputFile: 'utils.react-server.d.cts', format: 'cjs' },
        // CLI
        { name: 'bin', outputFile: 'bin.mjs', format: 'esm' },
      ];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
        {
          exportKey: 'utils',
          condition: 'default',
          source: 'src/utils/index.ts',
          platform: 'neutral',
          originalKey: './utils',
        },
        {
          exportKey: 'utils.react-server',
          condition: 'react-server',
          source: 'src/utils/server.ts',
          platform: 'node',
          originalKey: './utils',
        },
        {
          exportKey: 'bin',
          source: 'src/cli.ts',
          platform: 'node',
          isBin: true,
          originalKey: './src/cli.ts',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: {
              types: './index.d.mts',
              default: './index.mjs',
            },
            require: {
              types: './index.d.cts',
              default: './index.cjs',
            },
          },
          './utils': {
            import: './utils.mjs',
            require: './utils.cjs',
            'react-server': {
              import: {
                types: './utils.react-server.d.mts',
                default: './utils.react-server.mjs',
              },
              require: {
                types: './utils.react-server.d.cts',
                default: './utils.react-server.cjs',
              },
            },
          },
        },
        bin: './bin.mjs',
      });
    });
  });

  describe('edge cases', () => {
    it('should return empty exports for empty outputs', () => {
      const outputs: OutputChunk[] = [];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: {},
      });
    });

    it('should return empty exports for empty entries', () => {
      const outputs: OutputChunk[] = [{ name: 'index', outputFile: 'index.mjs', format: 'esm' }];
      const entries: ResolvedEntry[] = [];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {},
        bin: {},
      });
    });

    it('should skip entries with no matching outputs', () => {
      const outputs: OutputChunk[] = [{ name: 'index', outputFile: 'index.mjs', format: 'esm' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: '.',
        },
        {
          exportKey: 'utils',
          source: 'src/utils.ts',
          platform: 'neutral',
          originalKey: './utils',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: './index.mjs',
          },
        },
        bin: {},
      });
    });

    it('should handle originalKey without ./ prefix', () => {
      const outputs: OutputChunk[] = [{ name: 'utils', outputFile: 'utils.mjs', format: 'esm' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'utils',
          source: 'src/utils.ts',
          platform: 'neutral',
          originalKey: 'utils',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          './utils': {
            import: './utils.mjs',
          },
        },
        bin: {},
      });
    });

    it('should handle originalKey as index', () => {
      const outputs: OutputChunk[] = [{ name: 'index', outputFile: 'index.mjs', format: 'esm' }];
      const entries: ResolvedEntry[] = [
        {
          exportKey: 'index',
          source: 'src/index.ts',
          platform: 'neutral',
          originalKey: 'index',
        },
      ];

      const result = generateExportsField(outputs, createEntriesMap(entries));

      expect(result).toEqual({
        exports: {
          '.': {
            import: './index.mjs',
          },
        },
        bin: {},
      });
    });
  });
});

describe('createEntriesMap', () => {
  it('should create a map from entries array', () => {
    const entries: ResolvedEntry[] = [
      {
        exportKey: 'index',
        source: 'src/index.ts',
        platform: 'neutral',
        originalKey: '.',
      },
      {
        exportKey: 'utils',
        source: 'src/utils.ts',
        platform: 'neutral',
        originalKey: './utils',
      },
    ];

    const map = createEntriesMap(entries);

    expect(map.size).toBe(2);
    expect(map.get('index')).toEqual(entries[0]);
    expect(map.get('utils')).toEqual(entries[1]);
  });

  it('should handle empty array', () => {
    const map = createEntriesMap([]);
    expect(map.size).toBe(0);
  });
});
