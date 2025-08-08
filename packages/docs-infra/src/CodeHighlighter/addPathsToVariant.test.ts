/**
 * Tests for addPathsToVariant functionality
 */

import { describe, it, expect } from 'vitest';
import { addPathsToVariant } from './addPathsToVariant';
import type { VariantCode } from './types';

describe('addPathsToVariant', () => {
  it('should add path to basic variant with no extra files', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('index.ts');
    expect(result.extraFiles).toEqual({});
  });

  it('should handle variant without URL', () => {
    const variant: VariantCode = {
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('Demo.tsx');
    expect(result.extraFiles).toEqual({});
  });

  it('should handle the basic example with back navigation', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('checkbox/index.ts');
    expect(result.extraFiles!['../helper.ts'].path).toBe('helper.ts');
  });

  it('should handle metadata files by removing metadataPrefix back navigation', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      metadataPrefix: 'src/',
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('src/checkbox/index.ts');
    // Non-metadata file resolves back navigation and includes metadataPrefix
    expect(result.extraFiles!['../helper.ts'].path).toBe('src/helper.ts');
    // Metadata file removes metadataPrefix-related back navigation
    expect(result.extraFiles!['../../package.json'].path).toBe('package.json');
  });

  it('should handle metadata files without metadataPrefix', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('checkbox/index.ts');
    expect(result.extraFiles!['../helper.ts'].path).toBe('helper.ts');
    expect(result.extraFiles!['../package.json'].path).toBe('package.json');
  });

  it('should handle metadata files without metadataPrefix and respect back navigation', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('components/checkbox/index.ts');
    // Non-metadata file resolves back navigation (no prefix)
    expect(result.extraFiles!['../helper.ts'].path).toBe('components/helper.ts');
    // Metadata file without metadataPrefix just removes all back navigation
    expect(result.extraFiles!['../../package.json'].path).toBe('package.json');
  });

  it('should handle multiple metadata files', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      metadataPrefix: 'src/',
      extraFiles: {
        '../package.json': { source: "console.log('package.json')", metadata: true },
        '../.meta/config.json': { source: "console.log('config.json')", metadata: true },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('src/index.ts');
    expect(result.extraFiles!['../package.json'].path).toBe('package.json');
    expect(result.extraFiles!['../.meta/config.json'].path).toBe('.meta/config.json');
  });

  it('should handle string extra files', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': 'file:///lib/components/helper.ts',
        'utils.ts': 'file:///lib/components/checkbox/utils.ts',
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('checkbox/index.ts');
    expect(result.extraFiles!['../helper.ts'].path).toBe('helper.ts');
    expect(result.extraFiles!['utils.ts'].path).toBe('utils.ts');
  });

  it('should handle complex relative paths', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/checkbox/subdir/index.ts',
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../utils.ts': { source: "console.log('utils.ts')" },
        '../../../types.ts': { source: "console.log('types.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('components/checkbox/subdir/index.ts');
    expect(result.extraFiles!['../helper.ts'].path).toBe('components/checkbox/helper.ts');
    expect(result.extraFiles!['../../utils.ts'].path).toBe('components/utils.ts');
    expect(result.extraFiles!['../../../types.ts'].path).toBe('types.ts');
  });

  it('should handle relative paths without URL context using synthetic paths', () => {
    const variant: VariantCode = {
      fileName: 'index.ts',
      source: "console.log('index.ts')",
      extraFiles: {
        '../../helper.ts': { source: "console.log('helper.ts')" },
        '../utils.ts': { source: "console.log('utils.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    // With maxBackNavigation = 2, should create synthetic structure
    expect(result.path).toBe('a/b/index.ts');
    expect(result.extraFiles!['../utils.ts'].path).toBe('a/utils.ts');
    expect(result.extraFiles!['../../helper.ts'].path).toBe('helper.ts');
  });

  it('should handle current directory references', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        './helper.ts': { source: "console.log('helper.ts')" },
        './utils/index.ts': { source: "console.log('utils/index.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('Demo.tsx');
    expect(result.extraFiles!['./helper.ts'].path).toBe('helper.ts');
    expect(result.extraFiles!['./utils/index.ts'].path).toBe('utils/index.ts');
  });

  it('should handle variant with no fileName but with URL', () => {
    const variant: VariantCode = {
      url: 'file:///lib/Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        'helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    // Should derive fileName from URL
    expect(result.path).toBe('Demo.tsx');
    expect(result.extraFiles!['helper.ts'].path).toBe('helper.ts');
  });

  it('should handle variant with no fileName and no source', () => {
    const variant: VariantCode = {
      extraFiles: {
        'helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBeUndefined();
    expect(result.extraFiles!['helper.ts'].path).toBe('helper.ts');
  });

  it('should handle metadata files with metadataPrefix and maxBackNavigation', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/Button/index.tsx',
      fileName: 'index.tsx',
      source: 'export default function Button() { return <button>Click me</button>; }',
      metadataPrefix: 'src/',
      extraFiles: {
        'utils.js': { source: 'export const utils = () => {};' }, // Non-metadata, no back nav
        '../theme.css': { source: '.theme {}', metadata: true }, // Metadata with back nav
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('src/index.tsx');

    expect(result.extraFiles!['utils.js'].path).toBe('src/utils.js');
    expect(result.extraFiles!['../theme.css'].path).toBe('theme.css');
  });

  it('should handle deep back navigation with synthetic paths', () => {
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

    const result = addPathsToVariant(variant);

    // With maxBackNavigation = 6, should create synthetic structure
    expect(result.path).toBe('a/b/c/d/e/main.ts');
    expect(result.extraFiles!['../utils.ts'].path).toBe('a/b/c/d/utils.ts');
    expect(result.extraFiles!['../../shared.ts'].path).toBe('a/b/c/shared.ts');
    expect(result.extraFiles!['../../../config.ts'].path).toBe('a/b/config.ts');
    expect(result.extraFiles!['../../../../deep.ts'].path).toBe('a/deep.ts');
    expect(result.extraFiles!['../../../../../deeper.ts'].path).toBe('deeper.ts');
  });

  it('should handle metadata files with extra back navigation', () => {
    const variant: VariantCode = {
      url: 'file:///lib/components/deep/nested/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      metadataPrefix: 'src/app/',
      extraFiles: {
        '../helper.tsx': { source: "console.log('helper.tsx')" },
        '../../../../../package.json': { source: "console.log('package.json')", metadata: true },
        '../../../../../code/tsconfig.json': {
          source: "console.log('tsconfig.json')",
          metadata: true,
        },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('src/app/components/deep/nested/Demo.tsx');
    expect(result.extraFiles!['../helper.tsx'].path).toBe('src/app/components/deep/helper.tsx');
    // when using `metadataPrefix`, we can remove any extra `../` shared by all metadata files
    expect(result.extraFiles!['../../../../../code/tsconfig.json'].path).toBe('code/tsconfig.json');
    expect(result.extraFiles!['../../../../../package.json'].path).toBe('package.json');
  });

  it('should handle metadata files with extra and unbalanced back navigation', () => {
    const variant: VariantCode = {
      url: 'file:///monorepo/lib/components/deep/nested/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      metadataPrefix: 'src/app/',
      extraFiles: {
        '../helper.tsx': { source: "console.log('helper.tsx')" },
        '../../../../../../tsconfig.json': {
          source: "console.log('tsconfig.json')",
          metadata: true,
        },
        '../../../../../../../../../../package.json': {
          source: "console.log('package.json')",
          metadata: true,
        },
      },
    };

    const result = addPathsToVariant(variant);

    // users should use the 'should handle metadata files with extra back navigation' case as an alterative to this behavior
    expect(result.path).toBe('a/b/monorepo/lib/src/app/components/deep/nested/Demo.tsx');
    expect(result.extraFiles!['../helper.tsx'].path).toBe(
      'a/b/monorepo/lib/src/app/components/deep/helper.tsx',
    );
    expect(result.extraFiles!['../../../../../../tsconfig.json'].path).toBe(
      'a/b/monorepo/tsconfig.json',
    );
    expect(result.extraFiles!['../../../../../../../../../../package.json'].path).toBe(
      'package.json',
    );
  });

  it('should handle metadata files when src already exists in URL', () => {
    const variant: VariantCode = {
      url: 'file:///src/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      metadataPrefix: 'src/',
      extraFiles: {
        '../meta.json': { source: '{ "name": "meta.json" }' },
        '../../package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('src/src/Demo.tsx');
    expect(result.extraFiles!['../meta.json'].path).toBe('src/meta.json');
    expect(result.extraFiles!['../../package.json'].path).toBe('package.json');
  });

  it('should handle metadata files without backtracking', () => {
    const variant: VariantCode = {
      url: 'file:///lib/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        'dir/utils.ts': { source: "console.log('utils.ts')" },
        'package.json': { source: "console.log('package.json')", metadata: true },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('Demo.tsx');
    expect(result.extraFiles!['dir/utils.ts'].path).toBe('dir/utils.ts');
    expect(result.extraFiles!['package.json'].path).toBe('package.json');
  });

  it('should handle empty or null sources gracefully', () => {
    const variant: VariantCode = {
      url: 'file:///lib/Demo.tsx',
      fileName: 'Demo.tsx',
      source: "console.log('Demo.tsx')",
      extraFiles: {
        'helper.ts': { source: '' },
        'utils.ts': {},
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('Demo.tsx');
    expect(result.extraFiles!['helper.ts'].path).toBe('helper.ts');
    expect(result.extraFiles!['utils.ts'].path).toBe('utils.ts');
  });

  it('should handle variant with no source', () => {
    const variant: VariantCode = {
      url: 'file:///lib/Demo.tsx',
      fileName: 'Demo.tsx',
      extraFiles: {
        'helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('Demo.tsx');
    expect(result.extraFiles!['helper.ts'].path).toBe('helper.ts');
  });

  it('should handle variant with no fileName', () => {
    const variant: VariantCode = {
      source: "console.log('no fileName')",
    };

    const result = addPathsToVariant(variant);

    expect(result.path).toBeUndefined();
    expect(result.extraFiles).toBeUndefined();
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

    const result = addPathsToVariant(variant);

    expect(result.path).toBe('a/b/component.tsx');
    expect(result.extraFiles!['../types.ts'].path).toBe('a/types.ts');
    expect(result.extraFiles!['../../constants.ts'].path).toBe('constants.ts');

    // Verify all paths with directories start with 'a'
    const paths = [result.path, ...Object.values(result.extraFiles || {}).map((f) => f.path)];
    const pathsWithDirectories = paths.filter((path) => path && path.includes('/'));
    pathsWithDirectories.forEach((path) => {
      expect(path!.startsWith('a/')).toBe(true);
    });
  });

  it('should not create synthetic URL when fileName is missing', () => {
    const variant: VariantCode = {
      // No fileName provided
      source: 'export default function Component() {}',
      extraFiles: {
        '../extras/utils.ts': { source: 'export const util = () => {};' },
        '../utils.ts': { source: 'export const util = () => {};' },
        '../../../utils.ts': { source: 'export const util = () => {};' },
      },
    };

    const result = addPathsToVariant(variant);

    // Should have no main file flat path since fileName is missing
    expect(result.path).toBeUndefined();
    expect(result.extraFiles!['../extras/utils.ts'].path).toBe('a/b/extras/utils.ts');
    expect(result.extraFiles!['../utils.ts'].path).toBe('a/b/utils.ts');
    expect(result.extraFiles!['../../../utils.ts'].path).toBe('utils.ts');
  });
});
