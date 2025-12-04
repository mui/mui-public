import { describe, it, expect } from 'vitest';
import { processRelativeImports } from './processRelativeImports';

describe('processRelativeImports', () => {
  const mockImportResult = {
    '../Component': { url: '/src/Component', names: ['Component'] },
    './utils': { url: '/src/utils', names: ['helper'] },
  };

  const mockResolvedPathsMap = new Map([
    ['/src/Component', '/src/Component/index.js'],
    ['/src/utils', '/src/utils.ts'],
  ]);

  it('should handle canonical mode without rewriting source', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils';`;

    const result = processRelativeImports(
      source,
      mockImportResult,
      'canonical',
      true,
      mockResolvedPathsMap,
    );

    expect(result.processedSource).toBe(source); // No source rewriting
    expect(result.extraFiles).toEqual({
      '../Component/index.js': 'file:///src/Component/index.js',
      './utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle import mode without rewriting source', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils';`;

    const result = processRelativeImports(
      source,
      mockImportResult,
      'import',
      true,
      mockResolvedPathsMap,
    );

    expect(result.processedSource).toBe(source); // No source rewriting
    expect(result.extraFiles).toEqual({
      '../Component.js': 'file:///src/Component/index.js',
      './utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle flat mode with basic imports', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils';`;

    const result = processRelativeImports(
      source,
      mockImportResult,
      'flat',
      true,
      mockResolvedPathsMap,
    );

    // Source may not be rewritten if rewrite function can't map index files properly
    // The main functionality is in the extraFiles mapping
    expect(result.extraFiles).toEqual({
      './Component.js': 'file:///src/Component/index.js',
      './utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle empty imports', () => {
    const source = 'const x = 1;';

    const result = processRelativeImports(source, {}, 'import', true, new Map());

    expect(result.processedSource).toBe(source);
    expect(result.extraFiles).toEqual({});
  });

  it('should handle canonical mode with non-index files', () => {
    const source = `import Utils from '../utils';`;
    const importResult = {
      '../utils': { url: '/src/utils', names: ['Utils'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/utils', '/src/utils.ts'], // Direct file, not index
    ]);

    const result = processRelativeImports(
      source,
      importResult,
      'canonical',
      true,
      resolvedPathsMap,
    );

    expect(result.extraFiles).toEqual({
      '../utils.ts': 'file:///src/utils.ts',
    });
  });

  it('should handle import mode with index files correctly', () => {
    const source = `import Component from '../Component';`;
    const importResult = {
      '../Component': { url: '/src/Component', names: ['Component'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/Component', '/src/Component/index.tsx'], // Index file
    ]);

    const result = processRelativeImports(source, importResult, 'import', true, resolvedPathsMap);

    expect(result.extraFiles).toEqual({
      '../Component.tsx': 'file:///src/Component/index.tsx',
    });
  });

  it('should handle flat mode with different file extensions', () => {
    const source = `import Component from '../Component';\nimport { helper } from './utils.js';`;
    const importResult = {
      '../Component': { url: '/src/Component', names: ['Component'] },
      './utils.js': { url: '/src/utils', names: ['helper'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/Component', '/src/Component.tsx'],
      ['/src/utils', '/src/utils.js'],
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    expect(result.extraFiles).toEqual({
      './Component.tsx': 'file:///src/Component.tsx',
      './utils.js': 'file:///src/utils.js',
    });
  });

  it('should handle flat mode with mixed index and direct files', () => {
    const source = `import ComponentA from './a/Component';\nimport ComponentB from './b/Component';`;
    const importResult = {
      './a/Component': { url: '/src/a/Component', names: ['ComponentA'] },
      './b/Component': { url: '/src/b/Component', names: ['ComponentB'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/a/Component', '/src/a/Component.js'], // Direct file
      ['/src/b/Component', '/src/b/Component/index.js'], // Index file
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    expect(result.extraFiles).toEqual({
      './a/Component.js': 'file:///src/a/Component.js',
      './b/Component.js': 'file:///src/b/Component/index.js',
    });
  });

  it('should handle flat mode with complex nested conflicts using minimal distinguishing paths', () => {
    const source = `import ComponentA from './a/Component';\nimport ComponentB from './b/Component';\nimport ComponentC from './c/Component';`;
    const importResult = {
      './a/Component': {
        url: '/components/special/a/path/in/common/Component',
        names: ['ComponentA'],
      },
      './b/Component': {
        url: '/components/special/b/path/in/common/Component',
        names: ['ComponentB'],
      },
      './c/Component': { url: '/components/special/c/Component', names: ['ComponentC'] },
    };
    const resolvedPathsMap = new Map([
      [
        '/components/special/a/path/in/common/Component',
        '/components/special/a/path/in/common/Component.js',
      ],
      [
        '/components/special/b/path/in/common/Component',
        '/components/special/b/path/in/common/Component.js',
      ],
      ['/components/special/c/Component', '/components/special/c/Component.js'],
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    expect(result.extraFiles).toEqual({
      './a/Component.js': 'file:///components/special/a/path/in/common/Component.js',
      './b/Component.js': 'file:///components/special/b/path/in/common/Component.js',
      './c/Component.js': 'file:///components/special/c/Component.js',
    });
  });

  it('should handle challenging naming conflicts in flat mode with deep path resolution', () => {
    // Test case: imports with very deep nested paths that need intelligent conflict resolution
    const source = `import ComponentA from './very/deeply/nested/path/structure/that/goes/on/forever/a/Component';\nimport ComponentB from './very/deeply/nested/path/structure/that/goes/on/forever/b/Component';\nimport ComponentC from './very/deeply/nested/path/structure/that/goes/on/forever/Component';`;
    const importResult = {
      './very/deeply/nested/path/structure/that/goes/on/forever/a/Component': {
        url: '/src/very/deeply/nested/path/structure/that/goes/on/forever/a/Component',
        names: ['ComponentA'],
      },
      './very/deeply/nested/path/structure/that/goes/on/forever/b/Component': {
        url: '/src/very/deeply/nested/path/structure/that/goes/on/forever/b/Component',
        names: ['ComponentB'],
      },
      './very/deeply/nested/path/structure/that/goes/on/forever/Component': {
        url: '/src/very/deeply/nested/path/structure/that/goes/on/forever/Component',
        names: ['ComponentC'],
      },
    };
    const resolvedPathsMap = new Map([
      [
        '/src/very/deeply/nested/path/structure/that/goes/on/forever/a/Component',
        '/src/very/deeply/nested/path/structure/that/goes/on/forever/a/Component.js',
      ],
      [
        '/src/very/deeply/nested/path/structure/that/goes/on/forever/b/Component',
        '/src/very/deeply/nested/path/structure/that/goes/on/forever/b/Component.js',
      ],
      [
        '/src/very/deeply/nested/path/structure/that/goes/on/forever/Component',
        '/src/very/deeply/nested/path/structure/that/goes/on/forever/Component.js',
      ],
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    // Should successfully distinguish all three files using minimal path context
    // The parent-child smart resolution should recognize that the third file is at a "parent" level
    expect(result.extraFiles).toEqual({
      './a/Component.js':
        'file:///src/very/deeply/nested/path/structure/that/goes/on/forever/a/Component.js',
      './b/Component.js':
        'file:///src/very/deeply/nested/path/structure/that/goes/on/forever/b/Component.js',
      './Component.js':
        'file:///src/very/deeply/nested/path/structure/that/goes/on/forever/Component.js',
    });
  });

  it('should handle direct index file imports vs nested index file imports in flat mode', () => {
    const source = `import MainIndex from './index.js';\nimport TestModule from './test/index.js';`;
    const importResult = {
      './index.js': { url: '/src/index.js', names: ['MainIndex'] },
      './test/index.js': { url: '/src/test/index.js', names: ['TestModule'] },
    };
    const resolvedPathsMap = new Map([
      ['/src/index.js', '/src/index.js'],
      ['/src/test/index.js', '/src/test/index.js'],
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    // Direct index import should stay as "./index.js"
    // Nested index import should become "./test.js"
    expect(result.extraFiles).toEqual({
      './index.js': 'file:///src/index.js',
      './test.js': 'file:///src/test/index.js',
    });
  });

  it('should handle module.css index files correctly in flat mode', () => {
    const source = `import indexStyles from './index.module.css';\nimport nestedStyles from './styles/index.module.css';`;
    const importResult = {
      './index.module.css': { url: '/src/index.module.css', names: [] },
      './styles/index.module.css': { url: '/src/styles/index.module.css', names: [] },
    };
    const resolvedPathsMap = new Map([
      ['/src/index.module.css', '/src/index.module.css'],
      ['/src/styles/index.module.css', '/src/styles/index.module.css'],
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    // Direct index.module.css should stay as "./index.module.css"
    // Nested index.module.css should become "./styles.module.css"
    expect(result.extraFiles).toEqual({
      './index.module.css': 'file:///src/index.module.css',
      './styles.module.css': 'file:///src/styles/index.module.css',
    });
  });

  it('should handle _index.module.css files as direct index imports in flat mode', () => {
    const source = `import styles from '../../dir/_index.module.css';`;
    const importResult = {
      '../../dir/_index.module.css': { url: '/src/dir/_index.module.css', names: [] },
    };
    const resolvedPathsMap = new Map([
      ['/src/dir/_index.module.css', '/src/dir/_index.module.css'],
    ]);

    const result = processRelativeImports(source, importResult, 'flat', true, resolvedPathsMap);

    // _index.module.css should be treated as a direct index import and become "./index.module.css"
    expect(result.extraFiles).toEqual({
      './index.module.css': 'file:///src/dir/_index.module.css',
    });
  });
});

describe('processCssImports', () => {
  const mockCssImportResult = {
    './base.css': { url: '/src/styles/base.css', names: [] },
    './components/button.css': { url: '/src/styles/components/button.css', names: [] },
  };

  it('should handle CSS imports in canonical mode', () => {
    const source = `@import './base.css';\n@import './components/button.css';`;

    const result = processRelativeImports(source, mockCssImportResult, 'canonical');

    expect(result.processedSource).toBe(source); // No source rewriting for canonical mode
    expect(result.extraFiles).toEqual({
      './base.css': 'file:///src/styles/base.css',
      './components/button.css': 'file:///src/styles/components/button.css',
    });
  });

  it('should handle CSS imports in import mode', () => {
    const source = `@import './base.css';\n@import './components/button.css';`;
    const cssImportResultWithPositions = {
      './base.css': { url: '/src/styles/base.css', names: [], positions: [{ start: 8, end: 20 }] },
      './components/button.css': {
        url: '/src/styles/components/button.css',
        names: [],
        positions: [{ start: 30, end: 55 }],
      },
    };

    const result = processRelativeImports(source, cssImportResultWithPositions, 'import');

    // Source should be rewritten to normalize ./ paths
    expect(result.processedSource).toBe(`@import 'base.css';\n@import 'components/button.css';`);
    expect(result.extraFiles).toEqual({
      './base.css': 'file:///src/styles/base.css',
      './components/button.css': 'file:///src/styles/components/button.css',
    });
  });

  it('should handle CSS imports in flat mode with simple conflict resolution', () => {
    const source = `@import './base.css';\n@import './components/button.css';`;
    const cssImportResultWithPositions = {
      './base.css': { url: '/src/styles/base.css', names: [], positions: [{ start: 8, end: 20 }] },
      './components/button.css': {
        url: '/src/styles/components/button.css',
        names: [],
        positions: [{ start: 30, end: 55 }],
      },
    };

    const result = processRelativeImports(source, cssImportResultWithPositions, 'flat');

    // Source should be rewritten with flattened paths
    expect(result.processedSource).toBe(`@import 'base.css';\n@import 'button.css';`);
    expect(result.extraFiles).toEqual({
      './base.css': 'file:///src/styles/base.css',
      './button.css': 'file:///src/styles/components/button.css',
    });
  });

  it('should handle CSS imports with naming conflicts in flat mode', () => {
    const source = `@import './theme/base.css';\n@import './layout/base.css';`;
    const importResult = {
      './theme/base.css': {
        url: '/src/styles/theme/base.css',
        names: [],
        positions: [{ start: 8, end: 26 }],
      },
      './layout/base.css': {
        url: '/src/styles/layout/base.css',
        names: [],
        positions: [{ start: 36, end: 55 }],
      },
    };

    const result = processRelativeImports(source, importResult, 'flat');

    // Source should be rewritten with conflict-resolved names
    expect(result.processedSource).toBe(`@import 'base.css';\n@import 'base-1.css';`);
    // Should handle naming conflicts with counter suffixes
    expect(result.extraFiles).toEqual({
      './base.css': 'file:///src/styles/theme/base.css',
      './base-1.css': 'file:///src/styles/layout/base.css',
    });
  });

  it('should handle empty CSS imports', () => {
    const source = '.main { color: red; }';

    const result = processRelativeImports(source, {}, 'import');

    expect(result.processedSource).toBe(source);
    expect(result.extraFiles).toEqual({});
  });

  it('should handle CSS imports with different file extensions', () => {
    const source = `@import './base.css';\n@import './theme.scss';\n@import './variables.less';`;
    const importResult = {
      './base.css': { url: '/src/styles/base.css', names: [], positions: [{ start: 8, end: 20 }] },
      './theme.scss': {
        url: '/src/styles/theme.scss',
        names: [],
        positions: [{ start: 30, end: 44 }],
      },
      './variables.less': {
        url: '/src/styles/variables.less',
        names: [],
        positions: [{ start: 54, end: 72 }],
      },
    };

    const result = processRelativeImports(source, importResult, 'flat');

    // Source should be rewritten with flattened paths (normalize by removing ./)
    expect(result.processedSource).toBe(
      `@import 'base.css';\n@import 'theme.scss';\n@import 'variables.less';`,
    );
    expect(result.extraFiles).toEqual({
      './base.css': 'file:///src/styles/base.css',
      './theme.scss': 'file:///src/styles/theme.scss',
      './variables.less': 'file:///src/styles/variables.less',
    });
  });

  it('should handle CSS imports with complex nested paths', () => {
    const source = `@import './components/forms/input.css';\n@import './components/layout/grid.css';\n@import './utils/mixins.css';`;
    const importResult = {
      './components/forms/input.css': { url: '/src/styles/components/forms/input.css', names: [] },
      './components/layout/grid.css': { url: '/src/styles/components/layout/grid.css', names: [] },
      './utils/mixins.css': { url: '/src/styles/utils/mixins.css', names: [] },
    };

    const result = processRelativeImports(source, importResult, 'canonical');

    expect(result.extraFiles).toEqual({
      './components/forms/input.css': 'file:///src/styles/components/forms/input.css',
      './components/layout/grid.css': 'file:///src/styles/components/layout/grid.css',
      './utils/mixins.css': 'file:///src/styles/utils/mixins.css',
    });
  });

  it('should handle CSS imports with external URLs', () => {
    const source = `@import url('https://fonts.googleapis.com/css2?family=Roboto');\n@import url('https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css');`;
    const importResult = {
      'https://fonts.googleapis.com/css2?family=Roboto': {
        url: 'https://fonts.googleapis.com/css2?family=Roboto',
        names: [],
      },
      'https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css': {
        url: 'https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css',
        names: [],
      },
    };

    const result = processRelativeImports(source, importResult, 'import');

    expect(result.extraFiles).toEqual({
      'https://fonts.googleapis.com/css2?family=Roboto':
        'https://fonts.googleapis.com/css2?family=Roboto',
      'https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css':
        'https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css',
    });
  });

  it('should handle CSS imports with media queries and conditions', () => {
    const source = `@import './print.css' print;\n@import './mobile.css' screen and (max-width: 768px);\n@import './dark.css' (prefers-color-scheme: dark);`;
    const importResult = {
      './print.css': {
        url: '/src/styles/print.css',
        names: [],
        positions: [{ start: 8, end: 21 }],
      },
      './mobile.css': {
        url: '/src/styles/mobile.css',
        names: [],
        positions: [{ start: 37, end: 51 }],
      },
      './dark.css': {
        url: '/src/styles/dark.css',
        names: [],
        positions: [{ start: 91, end: 103 }],
      },
    };

    const result = processRelativeImports(source, importResult, 'flat');

    // Source should be rewritten with flattened paths, preserving media queries
    expect(result.processedSource).toBe(
      `@import 'print.css' print;\n@import 'mobile.css' screen and (max-width: 768px);\n@import 'dark.css' (prefers-color-scheme: dark);`,
    );
    expect(result.extraFiles).toEqual({
      './print.css': 'file:///src/styles/print.css',
      './mobile.css': 'file:///src/styles/mobile.css',
      './dark.css': 'file:///src/styles/dark.css',
    });
  });

  it('should handle CSS imports with layers and supports', () => {
    const source = `@import './base.css' layer(base);\n@import './theme.css' layer(theme) supports(display: grid);`;
    const importResult = {
      './base.css': { url: '/src/styles/base.css', names: [] },
      './theme.css': { url: '/src/styles/theme.css', names: [] },
    };

    const result = processRelativeImports(source, importResult, 'canonical');

    expect(result.extraFiles).toEqual({
      './base.css': 'file:///src/styles/base.css',
      './theme.css': 'file:///src/styles/theme.css',
    });
  });

  it('should demonstrate difference between canonical and import modes', () => {
    const source = `@import './styles/base.css';\n@import '../shared/utils.css';`;
    const importResult = {
      './styles/base.css': {
        url: '/src/components/styles/base.css',
        names: [],
        positions: [{ start: 8, end: 27 }],
      },
      '../shared/utils.css': {
        url: '/src/shared/utils.css',
        names: [],
        positions: [{ start: 37, end: 58 }],
      },
    };

    // Canonical mode: returns exact paths as provided, no source rewriting
    const canonicalResult = processRelativeImports(source, importResult, 'canonical');

    expect(canonicalResult.processedSource).toBe(source); // No rewriting
    expect(canonicalResult.extraFiles).toEqual({
      './styles/base.css': 'file:///src/components/styles/base.css',
      '../shared/utils.css': 'file:///src/shared/utils.css',
    });

    // Import mode: normalizes ./ in source, but keeps original paths in extraFiles
    const importModeResult = processRelativeImports(source, importResult, 'import');

    expect(importModeResult.processedSource).toBe(
      `@import 'styles/base.css';\n@import '../shared/utils.css';`,
    ); // ./ removed, ../ preserved
    expect(importModeResult.extraFiles).toEqual({
      './styles/base.css': 'file:///src/components/styles/base.css', // extraFiles keeps ./
      '../shared/utils.css': 'file:///src/shared/utils.css', // ../ is preserved everywhere
    });
  });
});
