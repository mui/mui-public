/**
 * Tests for flattenVariant functionality
 */

import { describe, it, expect } from 'vitest';
import { flattenVariant } from './flattenVariant';
import type { VariantCode } from '../CodeHighlighter/types';

describe('flattenVariant', () => {
  it('should handle basic variant with no extra files', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle variant without URL', () => {
    const variant: VariantCode = {
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'Demo.tsx': { source: "console.log('Demo.tsx')" },
    });
  });

  it('should handle the basic example', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle the basic example from requirements', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'helper.ts': { source: "console.log('helper.ts')" },
      'checkbox/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle metadata files and scope non-metadata to src', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'package.json': { source: "console.log('package.json')", metadata: true },
      'src/helper.ts': { source: "console.log('helper.ts')" },
      'src/checkbox/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle multiple metadata files', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../package.json': { source: "console.log('package.json')", metadata: true },
        '../.meta/config.json': { source: "console.log('config.json')", metadata: true },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'package.json': { source: "console.log('package.json')", metadata: true },
      '.meta/config.json': { source: "console.log('config.json')", metadata: true },
      'src/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle multiple metadata files when extra files are present', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../package.json': { source: "console.log('package.json')", metadata: true },
        '../../.meta/config.json': { source: "console.log('config.json')", metadata: true },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'package.json': { source: "console.log('package.json')", metadata: true },
      '.meta/config.json': { source: "console.log('config.json')", metadata: true },
      'src/helper.ts': { source: "console.log('helper.ts')" },
      'src/checkbox/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle string extra files', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': "console.log('helper.ts as string')",
        'utils.ts': "console.log('utils.ts as string')",
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'helper.ts': { source: "console.log('helper.ts as string')" },
      'checkbox/utils.ts': { source: "console.log('utils.ts as string')" },
      'checkbox/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle complex relative paths', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/checkbox/subdir/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../utils.ts': { source: "console.log('utils.ts')" },
        '../../../types.ts': { source: "console.log('types.ts')" },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'components/checkbox/helper.ts': { source: "console.log('helper.ts')" },
      'components/utils.ts': { source: "console.log('utils.ts')" },
      'types.ts': { source: "console.log('types.ts')" },
      'components/checkbox/subdir/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle relative paths without URL context', () => {
    const variant: VariantCode = {
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../../helper.ts': { source: "console.log('helper.ts')" },
        '../utils.ts': { source: "console.log('utils.ts')" },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'helper.ts': { source: "console.log('helper.ts')" },
      'a/utils.ts': { source: "console.log('utils.ts')" },
      'a/b/index.ts': { source: "console.log('index.ts')" },
    });
  });

  it('should handle metadata files with complex paths', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/deep/nested/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        '../helper.tsx': { source: "console.log('helper.tsx')" },
        '../../../../../package.json': { source: "console.log('package.json')", metadata: true },
        '../../../../../tsconfig.json': { source: "console.log('tsconfig.json')", metadata: true },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'package.json': { source: "console.log('package.json')", metadata: true },
      'tsconfig.json': { source: "console.log('tsconfig.json')", metadata: true },
      'src/lib/components/deep/helper.tsx': { source: "console.log('helper.tsx')" },
      'src/lib/components/deep/nested/Demo.tsx': { source: "console.log('Demo.tsx')" },
    });
  });

  it('should handle metadata files when src already exists', () => {
    const variant: VariantCode = {
      url: 'file:///src/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        '../meta.json': { source: '{ "name": "meta.json" }' },
        '../../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'package.json': { source: "console.log('package.json')", metadata: true },
      'src/meta.json': { source: '{ "name": "meta.json" }' },
      'src/src/Demo.tsx': { source: "console.log('Demo.tsx')" },
    });
  });

  it('should output metadata files when files are outputted without backtracking', () => {
    const variant: VariantCode = {
      url: 'file:///lib/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        'dir/utils.ts': { source: "console.log('utils.ts')" },
        '../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'package.json': { source: "console.log('package.json')", metadata: true },
      'src/dir/utils.ts': { source: "console.log('utils.ts')" },
      'src/Demo.tsx': { source: "console.log('Demo.tsx')" },
    });
  });

  it('should handle current directory references', () => {
    const variant: VariantCode = {
      url: 'file:///src/components/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        './helper.ts': { source: "console.log('helper.ts')" },
        './utils/index.ts': { source: "console.log('utils/index.ts')" },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'helper.ts': { source: "console.log('helper.ts')" },
      'utils/index.ts': { source: "console.log('utils/index.ts')" },
      'Demo.tsx': { source: "console.log('Demo.tsx')" },
    });
  });

  it('should handle empty or null sources gracefully', () => {
    const variant: VariantCode = {
      url: 'file:///src/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        'helper.ts': { source: '' },
        'utils.ts': {},
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'helper.ts': { source: '' },
      'Demo.tsx': { source: "console.log('Demo.tsx')" },
    });
  });

  it('should handle variant with no source', () => {
    const variant: VariantCode = {
      url: 'file:///src/Demo.tsx',
      fileName: 'Demo.tsx',
      extraFiles: {
        'helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({
      'helper.ts': { source: "console.log('helper.ts')" },
    });
  });

  it('should handle variant with no fileName', () => {
    const variant: VariantCode = {
      source: "console.log('no fileName')",
    };

    const result = flattenVariant(variant);

    expect(result).toEqual({});
  });

  it('should generate alphabetic synthetic paths for deep back navigation', () => {
    const variant: VariantCode = {
      fileName: 'main.ts',
      source: "console.log('main.ts')",
      extraFiles: {
        '../utils.ts': { source: "console.log('utils.ts')" },
        '../../shared.ts': { source: "console.log('shared.ts')" },
        '../../../config.ts': { source: "console.log('config.ts')" },
        '../../../../deep.ts': { source: "console.log('deep.ts')" },
        '../../../../../deeper.ts': { source: "console.log('deeper.ts')" },
      },
    };

    const result = flattenVariant(variant);

    // With 6 levels of back navigation, we should get alphabetic structure
    // Main file at the deepest level
    expect(result['a/b/c/d/e/main.ts']).toEqual({ source: "console.log('main.ts')" });

    // Extra files at progressively shallower levels
    expect(result['a/b/c/d/utils.ts']).toEqual({ source: "console.log('utils.ts')" });
    expect(result['a/b/c/shared.ts']).toEqual({ source: "console.log('shared.ts')" });
    expect(result['a/b/config.ts']).toEqual({ source: "console.log('config.ts')" });
    expect(result['a/deep.ts']).toEqual({ source: "console.log('deep.ts')" });
    expect(result['deeper.ts']).toEqual({ source: "console.log('deeper.ts')" });
  });

  it('should ensure first directory is always "a" in synthetic paths', () => {
    const variant: VariantCode = {
      fileName: 'component.tsx',
      source: 'export default function Component() {}',
      extraFiles: {
        '../types.ts': { source: 'export interface Props {}' },
        '../../constants.ts': { source: 'export const CONSTANTS = {};' },
      },
    };

    const result = flattenVariant(variant);
    const paths = Object.keys(result);

    // Main file should be at a/b/component.tsx
    expect(result['a/b/component.tsx']).toEqual({
      source: 'export default function Component() {}',
    });

    // All paths should start with 'a' when they have directories
    const pathsWithDirectories = paths.filter((path) => path.includes('/'));
    pathsWithDirectories.forEach((path) => {
      expect(path.startsWith('a/')).toBe(true);
    });
  });

  it('should not create synthetic URL when fileName is missing', () => {
    const variant: VariantCode = {
      // No fileName provided
      source: 'export default function Component() {}',
      extraFiles: {
        '../utils.ts': { source: 'export const util = () => {};' },
      },
    };

    const result = flattenVariant(variant);

    // Should only have the extra file, no main file
    expect(Object.keys(result)).toEqual(['utils.ts']);
    expect(result['utils.ts']).toEqual({ source: 'export const util = () => {};' });
  });
});
