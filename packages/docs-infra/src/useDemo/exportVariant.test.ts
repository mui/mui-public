/**
 * Tests for exportVariant functionality
 */

import { describe, it, expect } from 'vitest';
import { exportVariant, type ExportConfig } from './exportVariant';
import type { VariantCode } from '../CodeHighlighter/types';
import { stringOrHastToString } from '../pipeline/hastUtils';

describe('exportVariant', () => {
  const baseVariantCode: VariantCode = {
    url: 'file:///src/components/checkbox/index.ts',
    fileName: 'index.ts',
    source: "console.log('index.ts')",
  };

  it('should add basic package.json with default configuration', () => {
    const result = exportVariant(baseVariantCode);

    expect(result.exported.extraFiles).toBeDefined();
    expect(result.exported.extraFiles!['../package.json']).toBeDefined();

    const packageJsonContent = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));
      expect(packageJson.private).toBe(true);
      expect(packageJson.dependencies.react).toBe('latest');
      expect(packageJson.dependencies['react-dom']).toBe('latest');
      expect(packageJson.devDependencies.vite).toBe('latest');
      expect(packageJsonContent.metadata).toBe(true);
    } else {
      throw new Error('Expected package.json to be an object with source property');
    }
  });

  it('should add vite.config.js by default', () => {
    const result = exportVariant(baseVariantCode);

    expect(result.exported.extraFiles!['../vite.config.js']).toBeDefined();
    const viteConfig = result.exported.extraFiles!['../vite.config.js'];
    if (typeof viteConfig === 'object' && 'source' in viteConfig) {
      expect(stringOrHastToString(viteConfig.source!)).toContain('@vitejs/plugin-react');
      expect(viteConfig.metadata).toBe(true);
    }
  });

  it('should add TypeScript configuration when useTypescript is true', () => {
    const config: ExportConfig = {
      useTypescript: true,
    };

    const result = exportVariant(baseVariantCode, config);

    expect(result.exported.extraFiles!['../tsconfig.json']).toBeDefined();
    expect(result.exported.extraFiles!['../tsconfig.node.json']).toBeDefined();
    expect(result.exported.extraFiles!['../vite.config.ts']).toBeDefined();

    const tsconfig = result.exported.extraFiles!['../tsconfig.json'];
    if (typeof tsconfig === 'object' && 'source' in tsconfig) {
      const tsconfigContent = JSON.parse(stringOrHastToString(tsconfig.source!));
      expect(tsconfigContent.compilerOptions.jsx).toBe('react-jsx');
      expect(tsconfig.metadata).toBe(true);
    }
  });

  it('should merge custom dependencies and devDependencies', () => {
    const config: ExportConfig = {
      dependencies: {
        lodash: '^4.17.21',
        'custom-lib': '1.0.0',
      },
      devDependencies: {
        jest: '^29.0.0',
        'custom-dev-tool': 'latest',
      },
    };

    const result = exportVariant(baseVariantCode, config);

    const packageJsonContent = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));
      expect(packageJson.dependencies.lodash).toBe('^4.17.21');
      expect(packageJson.dependencies['custom-lib']).toBe('1.0.0');
      expect(packageJson.dependencies.react).toBe('latest'); // Should keep defaults
      expect(packageJson.devDependencies.jest).toBe('^29.0.0');
      expect(packageJson.devDependencies['custom-dev-tool']).toBe('latest');
      expect(packageJson.devDependencies.vite).toBe('latest'); // Should keep defaults
    }
  });

  it('should handle existing extraFiles without back navigation', () => {
    const variantWithExtraFiles: VariantCode = {
      ...baseVariantCode,
      extraFiles: {
        'helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = exportVariant(variantWithExtraFiles);

    expect(result.exported.extraFiles!['helper.ts']).toBeDefined();
    expect(result.exported.extraFiles!['../package.json']).toBeDefined();

    // Should be at root level since no back navigation
    const packageJsonContent = result.exported.extraFiles!['../package.json'];
    expect(typeof packageJsonContent).toBe('object');
  });

  it('should handle existing extraFiles with back navigation', () => {
    const variantWithBackNav: VariantCode = {
      ...baseVariantCode,
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
      },
    };

    const result = exportVariant(variantWithBackNav);

    expect(result.exported.extraFiles!['../helper.ts']).toBeDefined();
    expect(result.exported.extraFiles!['../../package.json']).toBeDefined();

    const packageJsonContent = result.exported.extraFiles!['../../package.json'];
    if (typeof packageJsonContent === 'object' && 'metadata' in packageJsonContent) {
      expect(packageJsonContent.metadata).toBe(true);
    }
  });

  it('should handle multiple levels of back navigation', () => {
    const variantWithDeepBackNav: VariantCode = {
      ...baseVariantCode,
      extraFiles: {
        '../helper.ts': { source: "console.log('helper.ts')" },
        '../../config.json': { source: '{}' },
      },
    };

    const result = exportVariant(variantWithDeepBackNav);

    expect(result.exported.extraFiles!['../helper.ts']).toBeDefined();
    expect(result.exported.extraFiles!['../../config.json']).toBeDefined();
    expect(result.exported.extraFiles!['../../../package.json']).toBeDefined();

    const packageJsonContent = result.exported.extraFiles!['../../../package.json'];
    if (typeof packageJsonContent === 'object' && 'metadata' in packageJsonContent) {
      expect(packageJsonContent.metadata).toBe(true);
    }
  });

  it('should add custom metadata files', () => {
    const config: ExportConfig = {
      extraMetadataFiles: {
        'custom-config.json': { source: '{"custom": true}' },
        '.env': { source: 'NODE_ENV=development' },
      },
    };

    const result = exportVariant(baseVariantCode, config);

    expect(result.exported.extraFiles!['../custom-config.json']).toBeDefined();
    expect(result.exported.extraFiles!['../.env']).toBeDefined();

    const customConfig = result.exported.extraFiles!['../custom-config.json'];
    if (typeof customConfig === 'object' && 'metadata' in customConfig) {
      expect(customConfig.metadata).toBe(true);
      expect(stringOrHastToString(customConfig.source!)).toBe('{"custom": true}');
    }
  });

  it('should merge custom package.json fields', () => {
    const config: ExportConfig = {
      packageJsonFields: {
        name: 'my-custom-demo',
        version: '1.0.0',
        license: 'MIT',
        author: 'Test Author',
      },
      scripts: {
        test: 'jest',
        lint: 'eslint .',
      },
    };

    const result = exportVariant(baseVariantCode, config);

    const packageJsonContent = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));
      expect(packageJson.name).toBe('my-custom-demo');
      expect(packageJson.version).toBe('1.0.0');
      expect(packageJson.license).toBe('MIT');
      expect(packageJson.author).toBe('Test Author');
      expect(packageJson.scripts.test).toBe('jest');
      expect(packageJson.scripts.lint).toBe('eslint .');
      expect(packageJson.scripts.dev).toBe('vite'); // Should keep defaults
    }
  });

  it('should merge custom tsconfig options', () => {
    const config: ExportConfig = {
      useTypescript: true,
      tsconfigOptions: {
        strict: false,
        noImplicitAny: true,
        customOption: 'custom-value',
      },
    };

    const result = exportVariant(baseVariantCode, config);

    const tsconfigContent = result.exported.extraFiles!['../tsconfig.json'];
    if (typeof tsconfigContent === 'object' && 'source' in tsconfigContent) {
      const tsconfig = JSON.parse(stringOrHastToString(tsconfigContent.source!));
      expect(tsconfig.compilerOptions.strict).toBe(false);
      expect(tsconfig.compilerOptions.noImplicitAny).toBe(true);
      expect(tsconfig.compilerOptions.customOption).toBe('custom-value');
      expect(tsconfig.compilerOptions.jsx).toBe('react-jsx'); // Should keep defaults
    }
  });

  it('should preserve original variant code properties', () => {
    const originalVariant: VariantCode = {
      ...baseVariantCode,
      filesOrder: ['index.ts', 'helper.ts'],
      allFilesListed: true,
      transforms: { js: { delta: {} } },
    };

    const result = exportVariant(originalVariant);

    expect(result.exported.url).toBe(originalVariant.url);
    expect(result.exported.fileName).toBe(originalVariant.fileName);
    expect(result.exported.source).toBe(originalVariant.source);
    expect(result.exported.filesOrder).toEqual(originalVariant.filesOrder);
    expect(result.exported.allFilesListed).toBe(originalVariant.allFilesListed);
    expect(result.exported.transforms).toEqual(originalVariant.transforms);
  });

  it('should return rootFile path', () => {
    const result = exportVariant(baseVariantCode);

    expect(result.rootFile).toBeDefined();
    expect(typeof result.rootFile).toBe('string');
    expect(result.rootFile).toMatch(/^src\/.*\.(js|jsx|ts|tsx)$/);
  });

  it('should handle named exports correctly', () => {
    const variantWithNamedExport: VariantCode = {
      ...baseVariantCode,
      namedExport: 'Checkbox',
    };

    const result = exportVariant(variantWithNamedExport);

    // Find the entrypoint file
    const entrypointFiles = Object.keys(result.exported.extraFiles!).filter(
      (fileName) =>
        fileName.includes('index.') && (fileName.endsWith('.jsx') || fileName.endsWith('.tsx')),
    );

    expect(entrypointFiles).toHaveLength(1);
    const entrypointFile = result.exported.extraFiles![entrypointFiles[0]];

    if (typeof entrypointFile === 'object' && 'source' in entrypointFile) {
      const entrypointSource = stringOrHastToString(entrypointFile.source!);

      // Should generate named import instead of default import
      expect(entrypointSource).toContain('import { Checkbox as App } from');
      expect(entrypointSource).not.toContain('import App from');
    } else {
      throw new Error('Expected entrypoint to be an object with source property');
    }
  });

  it('should handle default exports correctly', () => {
    const variantWithDefaultExport: VariantCode = {
      ...baseVariantCode,
      // No namedExport field means it's a default export
    };

    const result = exportVariant(variantWithDefaultExport);

    // Find the entrypoint file
    const entrypointFiles = Object.keys(result.exported.extraFiles!).filter(
      (fileName) =>
        fileName.includes('index.') && (fileName.endsWith('.jsx') || fileName.endsWith('.tsx')),
    );

    expect(entrypointFiles).toHaveLength(1);
    const entrypointFile = result.exported.extraFiles![entrypointFiles[0]];

    if (typeof entrypointFile === 'object' && 'source' in entrypointFile) {
      const entrypointSource = stringOrHastToString(entrypointFile.source!);

      // Should generate default import
      expect(entrypointSource).toContain('import App from');
      expect(entrypointSource).not.toContain('import { ');
    } else {
      throw new Error('Expected entrypoint to be an object with source property');
    }
  });

  describe('externals dependencies handling', () => {
    it('should add externals as dependencies with latest version', () => {
      const variantWithExternals: VariantCode = {
        ...baseVariantCode,
        externals: ['lodash', '@mui/material', 'axios'],
      };

      const result = exportVariant(variantWithExternals);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // Should add externals as dependencies with 'latest' version
        expect(packageJson.dependencies.lodash).toBe('latest');
        expect(packageJson.dependencies['@mui/material']).toBe('latest');
        expect(packageJson.dependencies.axios).toBe('latest');

        // Should preserve default dependencies
        expect(packageJson.dependencies.react).toBe('latest');
        expect(packageJson.dependencies['react-dom']).toBe('latest');
      } else {
        throw new Error('Expected package.json to be an object with source property');
      }
    });

    it('should handle empty externals array', () => {
      const variantWithEmptyExternals: VariantCode = {
        ...baseVariantCode,
        externals: [],
      };

      const result = exportVariant(variantWithEmptyExternals);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // Should only have default dependencies
        expect(packageJson.dependencies.react).toBe('latest');
        expect(packageJson.dependencies['react-dom']).toBe('latest');
        expect(Object.keys(packageJson.dependencies)).toHaveLength(2);
      }
    });

    it('should handle undefined externals', () => {
      const variantWithoutExternals: VariantCode = {
        ...baseVariantCode,
        // No externals property
      };

      const result = exportVariant(variantWithoutExternals);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // Should only have default dependencies
        expect(packageJson.dependencies.react).toBe('latest');
        expect(packageJson.dependencies['react-dom']).toBe('latest');
        expect(Object.keys(packageJson.dependencies)).toHaveLength(2);
      }
    });

    it('should merge externals with custom dependencies', () => {
      const variantWithExternals: VariantCode = {
        ...baseVariantCode,
        externals: ['lodash', '@emotion/react'],
      };

      const config: ExportConfig = {
        dependencies: {
          'custom-lib': '^2.0.0',
          lodash: '^4.17.21', // Should override externals version
        },
      };

      const result = exportVariant(variantWithExternals, config);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // Custom dependencies should override externals
        expect(packageJson.dependencies.lodash).toBe('^4.17.21');
        expect(packageJson.dependencies['custom-lib']).toBe('^2.0.0');

        // Externals not overridden should use 'latest'
        expect(packageJson.dependencies['@emotion/react']).toBe('latest');

        // Should preserve defaults
        expect(packageJson.dependencies.react).toBe('latest');
        expect(packageJson.dependencies['react-dom']).toBe('latest');
      }
    });

    it('should handle externals with special characters and scoped packages', () => {
      const variantWithScopedExternals: VariantCode = {
        ...baseVariantCode,
        externals: ['@mui/material', '@emotion/react', '@types/lodash', 'react-router-dom'],
      };

      const result = exportVariant(variantWithScopedExternals);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // Should handle scoped packages correctly
        expect(packageJson.dependencies['@mui/material']).toBe('latest');
        expect(packageJson.dependencies['@emotion/react']).toBe('latest');
        expect(packageJson.dependencies['@types/lodash']).toBe('latest');
        expect(packageJson.dependencies['react-router-dom']).toBe('latest');
      }
    });

    it('should not override React dependencies from externals', () => {
      const variantWithReactExternals: VariantCode = {
        ...baseVariantCode,
        externals: ['react', 'react-dom', 'other-lib'],
      };

      const result = exportVariant(variantWithReactExternals);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // React packages should maintain their existing values
        expect(packageJson.dependencies.react).toBe('latest');
        expect(packageJson.dependencies['react-dom']).toBe('latest');

        // Other externals should be added
        expect(packageJson.dependencies['other-lib']).toBe('latest');
      }
    });

    it('should handle large number of externals', () => {
      const manyExternals = Array.from({ length: 20 }, (_, i) => `package-${i}`);
      const variantWithManyExternals: VariantCode = {
        ...baseVariantCode,
        externals: manyExternals,
      };

      const result = exportVariant(variantWithManyExternals);

      const packageJsonContent = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonContent === 'object' && 'source' in packageJsonContent) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonContent.source!));

        // Should add all externals
        manyExternals.forEach((external) => {
          expect(packageJson.dependencies[external]).toBe('latest');
        });

        // Should have React defaults + all externals
        expect(Object.keys(packageJson.dependencies).length).toBe(2 + manyExternals.length);
      }
    });
  });
});
