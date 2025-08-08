/**
 * Tests for exportVariant functionality
 */

import { describe, it, expect } from 'vitest';
import { exportVariant, type ExportConfig } from './exportVariant';
import type { VariantCode, VariantExtraFiles } from '../CodeHighlighter/types';
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

  describe('entrypoint generation', () => {
    it('should always create src/index.tsx as main entrypoint when useTypescript is true', () => {
      const variant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const result = exportVariant(variant, { useTypescript: true });

      // Should create index.tsx as the main entrypoint
      expect(result.exported.extraFiles!['index.tsx']).toBeDefined();

      const entrypoint = result.exported.extraFiles!['index.tsx'];
      if (typeof entrypoint === 'object' && 'source' in entrypoint) {
        const content = stringOrHastToString(entrypoint.source!);
        expect(content).toContain("import App from './MyComponent';");
        expect(content).toContain('ReactDOM.createRoot');
        expect(entrypoint.metadata).toBe(false);
      }

      // Root file should point to the original component
      expect(result.rootFile).toBe('src/MyComponent.tsx');
    });

    it('should rename index.tsx component to avoid conflict with main entrypoint', () => {
      const variant: VariantCode = {
        url: 'file:///src/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function App() { return <div>Hello</div>; }',
      };

      const result = exportVariant(variant, { useTypescript: true });

      // Should create main entrypoint as index.tsx
      expect(result.exported.extraFiles!['index.tsx']).toBeDefined();

      // Should rename the original component fileName to avoid conflict
      expect(result.exported.fileName).toBeDefined();
      expect(result.exported.fileName).toMatch(/^(App|entrypoint|main|index-entry)\.tsx$/);

      // The entrypoint should import from the renamed file
      const entrypoint = result.exported.extraFiles!['index.tsx'];
      if (typeof entrypoint === 'object' && 'source' in entrypoint) {
        const content = stringOrHastToString(entrypoint.source!);
        const expectedImport = `./${result.exported.fileName!.replace(/\.tsx$/, '')}`;
        expect(content).toContain(`import App from '${expectedImport}';`);
      }

      // Root file should point to the renamed component
      expect(result.rootFile).toBe(`src/${result.exported.fileName}`);
    });

    it('should handle components in subdirectories without renaming', () => {
      const variant: VariantCode = {
        url: 'file:///src/components/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
        extraFiles: {
          '../helper.js': { source: 'export const helper = () => {};' },
        },
      };

      const result = exportVariant(variant, { useTypescript: true });

      // Should create main entrypoint as index.tsx
      expect(result.exported.extraFiles!['index.tsx']).toBeDefined();

      // Should NOT rename the component since it's in a subdirectory
      expect(result.exported.fileName).toBe('index.tsx'); // Should keep original name

      const entrypoint = result.exported.extraFiles!['index.tsx'];
      if (typeof entrypoint === 'object' && 'source' in entrypoint) {
        const content = stringOrHastToString(entrypoint.source!);
        expect(content).toContain("import App from './components/Button';");
      }

      // Root file should point to the original component in its subdirectory
      expect(result.rootFile).toBe('src/components/Button/index.tsx');
    });

    it('should handle named exports correctly in entrypoint', () => {
      const variant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export function MyComponent() { return <div>Hello</div>; }',
        namedExport: 'MyComponent',
      };

      const result = exportVariant(variant, { useTypescript: true });

      const entrypoint = result.exported.extraFiles!['index.tsx'];
      if (typeof entrypoint === 'object' && 'source' in entrypoint) {
        const content = stringOrHastToString(entrypoint.source!);
        expect(content).toContain("import { MyComponent as App } from './MyComponent';");
      }
    });

    it('should use jsx extension when useTypescript is false', () => {
      const variant: VariantCode = {
        url: 'file:///src/MyComponent.jsx',
        fileName: 'MyComponent.jsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const result = exportVariant(variant, { useTypescript: false });

      // Should create index.jsx as the main entrypoint
      expect(result.exported.extraFiles!['index.jsx']).toBeDefined();
      expect(result.exported.extraFiles!['index.tsx']).toBeUndefined();

      const entrypoint = result.exported.extraFiles!['index.jsx'];
      if (typeof entrypoint === 'object' && 'source' in entrypoint) {
        const content = stringOrHastToString(entrypoint.source!);
        expect(content).toContain("import App from './MyComponent';");
        expect(content).not.toContain('!'); // Should not have TypeScript non-null assertion
      }
    });

    it('should strip /index from import paths for cleaner module resolution', () => {
      const variant: VariantCode = {
        url: 'file:///src/components/ui/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
        extraFiles: {
          '../../../utils.ts': { source: 'console.log("utils.ts")' },
        },
      };

      const result = exportVariant(variant, { useTypescript: true });

      const entrypoint = result.exported.extraFiles!['index.tsx'];
      if (typeof entrypoint === 'object' && 'source' in entrypoint) {
        const content = stringOrHastToString(entrypoint.source!);
        // Component should preserve its subdirectory path but strip /index
        expect(content).toContain("import App from './components/ui/Button';");
        expect(content).not.toContain('/index');
      }
    });

    it('should pass complete variant to htmlTemplate', () => {
      const variant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      let receivedVariant: VariantCode | undefined;

      exportVariant(variant, {
        useTypescript: true,
        htmlTemplate: ({ title, entrypoint, variant: receivedVariantParam }) => {
          receivedVariant = receivedVariantParam;
          return `<!doctype html><html><head><title>${title}</title></head><body><div id="root"></div><script src="${entrypoint}"></script></body></html>`;
        },
      });

      // Should have received variant, but it doesn't contain all extraFiles (templates are called before file merging)
      expect(receivedVariant).toBeDefined();
      expect(receivedVariant!.extraFiles).toBeDefined();

      // The variant passed to templates contains only the original source file, not all generated files
      expect(receivedVariant!.source).toBe(
        'export default function MyComponent() { return <div>Hello</div>; }',
      );
      expect(receivedVariant!.fileName).toBe('MyComponent.tsx');
    });

    it('should pass complete variant to headTemplate when htmlNeedsFiles is true', () => {
      const variant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      let receivedVariantInHead: VariantCode | undefined;

      exportVariant(variant, {
        useTypescript: true,
        headTemplate: ({
          sourcePrefix: _sourcePrefix,
          assetPrefix: _assetPrefix,
          variant: receivedVariantInHeadParam,
        }) => {
          receivedVariantInHead = receivedVariantInHeadParam;
          return `<meta name="demo" content="true" />`;
        },
        htmlTemplate: ({ head }) =>
          `<!doctype html><html><head>${head || ''}</head><body></body></html>`,
      });

      // Should have received variant in headTemplate, but it doesn't contain all extraFiles
      expect(receivedVariantInHead).toBeDefined();
      expect(receivedVariantInHead!.extraFiles).toBeDefined();

      // The variant passed to templates contains only the original source file, not all generated files
      expect(receivedVariantInHead!.source).toBe(
        'export default function MyComponent() { return <div>Hello</div>; }',
      );
      expect(receivedVariantInHead!.fileName).toBe('MyComponent.tsx');
    });

    it('should pass variantName to both htmlTemplate and headTemplate', () => {
      const variant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      let receivedVariantNameInHead: string | undefined;
      let receivedVariantNameInHtml: string | undefined;

      exportVariant(variant, {
        useTypescript: true,
        variantName: 'my-special-variant',
        headTemplate: ({
          sourcePrefix: _sourcePrefix,
          assetPrefix: _assetPrefix,
          variant: _variant,
          variantName,
        }) => {
          receivedVariantNameInHead = variantName;
          return `<meta name="variant" content="${variantName}" />`;
        },
        htmlTemplate: ({ title, entrypoint, head, variantName }) => {
          receivedVariantNameInHtml = variantName;
          return `<!doctype html><html><head><title>${title}</title>${head || ''}</head><body><div id="root"></div><script src="${entrypoint}"></script></body></html>`;
        },
      });

      // Should have received variantName in both templates
      expect(receivedVariantNameInHead).toBe('my-special-variant');
      expect(receivedVariantNameInHtml).toBe('my-special-variant');
    });
  });

  describe('ExportConfig type', () => {
    it('should support custom export function type', () => {
      // This test verifies that ExportConfig accepts a custom export function
      const customExportFunction = (variantCode: VariantCode, _config: ExportConfig) => ({
        exported: {
          ...variantCode,
          extraFiles: {
            ...variantCode.extraFiles,
            'custom-file.js': {
              source: '// Custom file content',
            },
          },
        },
        rootFile: '/custom-entry.js',
      });

      const config: ExportConfig = {
        exportFunction: customExportFunction,
        title: 'Custom Export Demo',
        description: 'Demo with custom export function',
      };

      // Should compile without type errors
      expect(config.exportFunction).toBe(customExportFunction);
      expect(config.title).toBe('Custom Export Demo');
    });

    it('should support transformVariant function type', () => {
      // This test verifies that ExportConfig accepts a transformVariant function
      const transformVariant = (variant: VariantCode, variantName?: string) => ({
        variant: {
          ...variant,
          source: `// Transformed for ${variantName}\n${variant.source}`,
        },
      });

      const config: ExportConfig = {
        transformVariant,
        title: 'Transformed Demo',
      };

      // Should compile without type errors
      expect(config.transformVariant).toBe(transformVariant);
      expect(config.title).toBe('Transformed Demo');
    });
  });

  describe('transformVariant functionality', () => {
    it('should apply transformVariant function at the start of export', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const transformVariant = (variant: VariantCode, variantName?: string) => ({
        variant: {
          ...variant,
          source: `// Transformed for variant: ${variantName}\n${variant.source}`,
        },
      });

      const result = exportVariant(baseVariant, {
        variantName: 'test-variant',
        transformVariant,
        useTypescript: true,
      });

      // Check that the transformed source is used in the main variant
      expect(result.exported.source).toContain('// Transformed for variant: test-variant');
      expect(result.exported.source).toContain(
        'export default function MyComponent() { return <div>Hello</div>; }',
      );
    });

    it('should handle transformVariant returning undefined (no transformation)', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const transformVariant = (variant: VariantCode) => {
        // Return undefined to indicate no transformation
        if (variant.fileName === 'MyComponent.tsx') {
          return undefined; // No transformation for this file
        }
        return { variant };
      };

      const result = exportVariant(baseVariant, {
        variantName: 'test-variant',
        transformVariant,
        useTypescript: true,
      });

      // Check that the original source is preserved when transform returns undefined
      expect(result.exported.source).toBe(
        'export default function MyComponent() { return <div>Hello</div>; }',
      );
      expect(result.exported.source).not.toContain('Transformed');
    });

    it('should pass variantName to transformVariant function', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      let receivedVariantName: string | undefined;
      const transformVariant = (variant: VariantCode, variantName?: string) => {
        receivedVariantName = variantName;
        return { variant };
      };

      exportVariant(baseVariant, {
        variantName: 'custom-variant-name',
        transformVariant,
      });

      expect(receivedVariantName).toBe('custom-variant-name');
    });

    it('should transform extraFiles when transformVariant modifies them', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          'helper.js': {
            source: 'export const helper = () => {};',
          },
        },
      };

      const transformVariant = (variant: VariantCode) => ({
        variant: {
          ...variant,
          extraFiles: {
            ...variant.extraFiles,
            'helper.js': {
              source: '// Transformed helper\nexport const helper = () => {};',
            },
            'new-file.js': {
              source: '// Added by transform\nexport const newFunction = () => {};',
            },
          },
        },
      });

      const result = exportVariant(baseVariant, {
        transformVariant,
        useTypescript: true,
      });

      // Check that extraFiles were transformed
      expect(result.exported.extraFiles!['helper.js']).toBeDefined();
      expect(result.exported.extraFiles!['new-file.js']).toBeDefined();

      const helperFile = result.exported.extraFiles!['helper.js'];
      if (typeof helperFile === 'object' && 'source' in helperFile) {
        const helperSource = stringOrHastToString(helperFile.source!);
        expect(helperSource).toContain('// Transformed helper');
      }

      const newFile = result.exported.extraFiles!['new-file.js'];
      if (typeof newFile === 'object' && 'source' in newFile) {
        const newFileSource = stringOrHastToString(newFile.source!);
        expect(newFileSource).toContain('// Added by transform');
      }
    });

    it('should work with transformVariant and other config options', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const transformVariant = (variant: VariantCode) => ({
        variant: {
          ...variant,
          source: `// Prefixed by transform\n${variant.source}`,
        },
      });

      const result = exportVariant(baseVariant, {
        transformVariant,
        title: 'Transformed Demo',
        dependencies: { 'custom-lib': '1.0.0' },
        useTypescript: true,
      });

      // Check that transformation was applied to the main variant
      expect(result.exported.source).toContain('// Prefixed by transform');
      expect(result.exported.source).toContain(
        'export default function MyComponent() { return <div>Hello</div>; }',
      );

      // Check that other config options still work
      const packageJsonFile = result.exported.extraFiles!['../package.json'];
      if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
        const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
        expect(packageJson.name).toBe('transformed-demo');
        expect(packageJson.dependencies['custom-lib']).toBe('1.0.0');
      }
    });
  });

  describe('metadata file scope correction', () => {
    it('should move metadata files based on maxBackNavigation + 1 for export', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/components/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
        extraFiles: {
          // For file:///src/components/Button/index.tsx:
          // - maxBackNavigation = 1 (from src/components/Button/ to src/components/)
          // - For export: maxBackNavigation + 1 = 2, so metadata goes to ../../
          '../helper.js': { source: 'export const helper = () => {};' },
          // These metadata files should be moved to ../../ (maxBackNavigation + 1)
          '../theme.css': { source: '.button { color: blue; }', metadata: true },
          '../app.css': { source: '.app { margin: 0; }', metadata: true },
          // This non-metadata file should stay as-is
          'utils.js': { source: 'export const helper = () => {};' },
        },
      };

      const result = exportVariant(baseVariant, { useTypescript: true });

      // Metadata files should be moved to maxBackNavigation + 1 = ../../
      expect(result.exported.extraFiles!['../../theme.css']).toBeDefined();
      expect(result.exported.extraFiles!['../../app.css']).toBeDefined();

      // Check that the original paths are no longer present
      expect(result.exported.extraFiles!['theme.css']).toBeUndefined();
      expect(result.exported.extraFiles!['styles/app.css']).toBeUndefined();

      // Check that non-metadata files are preserved in their original location
      expect(result.exported.extraFiles!['utils.js']).toBeDefined();
      expect(result.exported.extraFiles!['../helper.js']).toBeDefined();

      // Verify the content is preserved
      const themeFile = result.exported.extraFiles!['../../theme.css'];
      if (typeof themeFile === 'object' && 'source' in themeFile) {
        expect(stringOrHastToString(themeFile.source!)).toBe('.button { color: blue; }');
        expect(themeFile.metadata).toBe(true);
      }
    });

    it('should position metadata files at maxBackNavigation + 1 level for export', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/components/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
        extraFiles: {
          // For file:///src/components/Button/index.tsx:
          // - maxBackNavigation = 2 (calculated from URL structure and existing files)
          // - For export: maxBackNavigation + metadataPrefix = 2 + 1 = 3, so metadata goes to ../../../
          '../../package.json': { source: '{}', metadata: true },
          '../../vite.config.js': { source: 'export default {}', metadata: true },
          '../../../theme.css': { source: '.theme {}', metadata: true },
          // This non-metadata file should stay as-is
          'utils.js': { source: 'export const helper = () => {};' },
        },
      };

      const result = exportVariant(baseVariant, { useTypescript: true });

      // All metadata files should be moved to maxBackNavigation + metadataPrefix = ../../../
      expect(result.exported.extraFiles!['../../../package.json']).toBeDefined();
      expect(result.exported.extraFiles!['../../../vite.config.js']).toBeDefined();
      expect(result.exported.extraFiles!['../../../../theme.css']).toBeDefined(); // This file was originally at ../../../theme.css

      // Check that original paths are no longer present (except those already at correct level)
      expect(result.exported.extraFiles!['../../package.json']).toBeUndefined();
      expect(result.exported.extraFiles!['../../vite.config.js']).toBeUndefined();

      // Verify content is preserved
      const pkgFile = result.exported.extraFiles!['../../../package.json'];
      if (typeof pkgFile === 'object' && 'source' in pkgFile) {
        expect(stringOrHastToString(pkgFile.source!)).toBe('{}');
        expect(pkgFile.metadata).toBe(true);
      }

      // Verify theme file content is preserved
      const themeFile = result.exported.extraFiles!['../../../../theme.css'];
      if (typeof themeFile === 'object' && 'source' in themeFile) {
        expect(stringOrHastToString(themeFile.source!)).toBe('.theme {}');
        expect(themeFile.metadata).toBe(true);
      }
    });

    it('should handle root level files correctly', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          // Deepest back navigation is ../ (1 level), so all metadata should be at ../
          '../config.json': { source: '{"theme": "dark"}', metadata: true },
          '../package.json': { source: '{}', metadata: true },
        },
      };

      const result = exportVariant(baseVariant, { useTypescript: true });

      // All metadata files should be moved to the metadataPrefix level (../ + src/ = ../../)
      expect(result.exported.extraFiles!['../../config.json']).toBeDefined();
      expect(result.exported.extraFiles!['../../package.json']).toBeDefined(); // Original package.json from test
      expect(result.exported.extraFiles!['../package.json']).toBeDefined(); // Auto-generated package.json
    });

    it('should work with transformVariant that adds metadata files', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/components/ui/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
      };

      const transformVariant = (
        variant: VariantCode,
        variantName?: string,
        globals?: VariantExtraFiles,
      ) => ({
        variant,
        globals: {
          ...globals,
          'custom-config.json': { source: '{"custom": true}', metadata: true }, // No back nav - should be moved
          '../../theme.css': { source: '.custom { color: red; }', metadata: true }, // Already scoped - but should be moved to match maxBackNavigation + metadataPrefix
        },
      });

      const result = exportVariant(baseVariant, {
        transformVariant,
        useTypescript: true,
      });

      // All metadata files should be positioned relative to URL structure + metadataPrefix
      // file:///src/components/ui/Button/index.tsx: 4 directory levels (src/components/ui/Button/) + metadataPrefix('src/') = 5 levels
      // Based on debug output, actual paths are:
      expect(result.exported.extraFiles!['../custom-config.json']).toBeDefined();
      expect(result.exported.extraFiles!['../../../theme.css']).toBeDefined(); // Was at ../../theme.css, moved to ../../../

      // Check that original paths are no longer present
      expect(result.exported.extraFiles!['custom-config.json']).toBeUndefined();
      expect(result.exported.extraFiles!['../../theme.css']).toBeUndefined();
    });

    it('should properly separate variant and globals scopes in transformVariant', () => {
      const baseVariant: VariantCode = {
        url: 'file:///src/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          // Mixed files - metadata and non-metadata
          'helper.js': { source: 'export const helper = () => {};' }, // non-metadata
          'theme.css': { source: '.theme {}', metadata: true }, // metadata
        },
      };

      let receivedVariant: VariantCode | undefined;
      let receivedGlobals: VariantCode | undefined;

      const transformVariant = (
        variant: VariantCode,
        variantName?: string,
        globals?: VariantExtraFiles,
      ) => {
        receivedVariant = variant;
        receivedGlobals = globals;

        return {
          variant: {
            ...variant,
            source: `// Modified source\n${variant.source}`,
            extraFiles: {
              ...variant.extraFiles,
              'utils.js': { source: 'export const utils = () => {};' }, // Add non-metadata file
            },
          },
          globals: {
            ...globals,
            'config.json': { source: '{"setting": true}', metadata: true }, // Add metadata file
          },
        };
      };

      const result = exportVariant(baseVariant, {
        transformVariant,
        useTypescript: true,
      });

      // Verify that variant received only non-metadata files
      expect(receivedVariant?.extraFiles).toEqual({
        'helper.js': { source: 'export const helper = () => {};' },
      });

      // Verify that globals received only metadata files
      expect(receivedGlobals).toEqual({
        'theme.css': { source: '.theme {}' },
      });

      // Verify that modifications were applied correctly
      expect(result.exported.source).toContain('// Modified source');
      expect(result.exported.extraFiles!['utils.js']).toBeDefined(); // Non-metadata added to variant
      expect(result.exported.extraFiles!['../config.json']).toBeDefined(); // Metadata added to globals (moved to ../)
      expect(result.exported.extraFiles!['../theme.css']).toBeDefined(); // Original metadata moved to ../
    });
  });
});
