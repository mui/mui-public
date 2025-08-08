/**
 * Tests for exportVariantAsCra functionality
 */

import { describe, it, expect } from 'vitest';
import type { VariantCode } from '../CodeHighlighter/types';
import { exportVariantAsCra } from './exportVariantAsCra';
import { stringOrHastToString } from '../pipeline/hastUtils';

// Test VariantCode that represents a simple React component
const mockVariantCode: VariantCode = {
  fileName: 'HelloWorld.js',
  source: `import React from 'react';

export default function HelloWorld() {
  const [count, setCount] = React.useState(0);

  return (
    <div>
      <h1>Hello World!</h1>
      <p>You clicked {count} times</p>
      <button onClick={() => setCount(count + 1)}>
        Click me
      </button>
    </div>
  );
}`,
  extraFiles: {
    'utils.js': {
      source: 'export const formatNumber = (num) => num.toLocaleString();',
    },
  },
};

describe('exportVariantAsCra', () => {
  it('should export basic CRA template with default settings', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'Hello World Demo',
      description: 'A simple React counter demo',
    });

    expect(result.exported.extraFiles).toBeDefined();

    // Check that package.json exists with correct path
    expect(result.exported.extraFiles!['../package.json']).toBeDefined();

    const packageJsonFile = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.private).toBe(true);
      expect(packageJson.description).toBe('A simple React counter demo');
      expect(packageJson.dependencies.react).toBe('latest');
      expect(packageJson.dependencies['react-dom']).toBe('latest');
      expect(packageJson.devDependencies['react-scripts']).toBe('latest');
      expect(packageJson.scripts.start).toBe('react-scripts start');
      expect(packageJson.scripts.build).toBe('react-scripts build');
    }

    // Check that HTML file exists
    expect(result.exported.extraFiles!['../public/index.html']).toBeDefined();

    // Check that entrypoint exists
    const entrypointKeys = Object.keys(result.exported.extraFiles!).filter(
      (key) => key.includes('index.js') && !key.includes('public'),
    );
    expect(entrypointKeys.length).toBeGreaterThan(0);
  });

  it('should export TypeScript CRA template', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'Hello World Demo (TypeScript)',
      description: 'A TypeScript React counter demo',
      useTypescript: true,
    });

    // Check TypeScript config
    expect(result.exported.extraFiles!['../tsconfig.json']).toBeDefined();

    const packageJsonFile = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.devDependencies.typescript).toBe('latest');
      expect(packageJson.devDependencies['@types/react']).toBe('latest');
      expect(packageJson.devDependencies['@types/react-dom']).toBe('latest');
    }
  });

  it('should support custom dependencies and scripts', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'Custom Demo',
      dependencies: {
        lodash: '^4.17.21',
        'date-fns': '^2.29.0',
      },
      devDependencies: {
        '@types/lodash': '^4.14.0',
      },
      scripts: {
        lint: 'eslint src --ext .js,.jsx',
        'type-check': 'tsc --noEmit',
      },
    });

    const packageJsonFile = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.dependencies.lodash).toBe('^4.17.21');
      expect(packageJson.dependencies['date-fns']).toBe('^2.29.0');
      expect(packageJson.devDependencies['@types/lodash']).toBe('^4.14.0');
      expect(packageJson.scripts.lint).toBe('eslint src --ext .js,.jsx');
      expect(packageJson.scripts['type-check']).toBe('tsc --noEmit');
    }
  });

  it('should support custom package.json fields', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'Custom Demo',
      packageJsonFields: {
        name: 'my-custom-demo',
        version: '1.0.0',
        author: 'Test Author',
        license: 'MIT',
      },
    });

    const packageJsonFile = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.name).toBe('my-custom-demo');
      expect(packageJson.version).toBe('1.0.0');
      expect(packageJson.author).toBe('Test Author');
      expect(packageJson.license).toBe('MIT');
    }
  });

  it('should support extra metadata files', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'Custom Demo',
      extraMetadataFiles: {
        '.env': {
          source: 'REACT_APP_VERSION=1.0.0',
        },
        'README.md': {
          source: '# Custom Demo\n\nThis is a demo.',
        },
      },
    });

    expect(result.exported.extraFiles!['../.env']).toBeDefined();
    expect(result.exported.extraFiles!['../README.md']).toBeDefined();

    const envFile = result.exported.extraFiles!['../.env'];
    if (typeof envFile === 'object' && 'source' in envFile) {
      expect(envFile.source).toBe('REACT_APP_VERSION=1.0.0');
    }
  });

  it('should handle default title when not provided', () => {
    const result = exportVariantAsCra(mockVariantCode);

    const packageJsonFile = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.description).toBe('Demo created with Create React App');
    }

    const htmlFile = result.exported.extraFiles!['../public/index.html'];
    if (typeof htmlFile === 'object' && 'source' in htmlFile) {
      expect(htmlFile.source).toContain('<title>Demo</title>');
    }
  });

  it('should not include package type field for CRA', () => {
    const result = exportVariantAsCra(mockVariantCode);

    const packageJsonFile = result.exported.extraFiles!['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.type).toBeUndefined();
    }
  });

  it('should not include Vite-specific files (regression test)', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'CRA Demo',
      useTypescript: true,
    });

    const extraFiles = result.exported.extraFiles!;
    const fileKeys = Object.keys(extraFiles);

    // Should NOT include any Vite-specific files
    const viteFiles = fileKeys.filter(
      (key) => key.includes('vite.config') || key.includes('tsconfig.node.json'),
    );
    expect(viteFiles).toHaveLength(0);

    // Should NOT include Vite dependencies in package.json
    const packageJsonFile = extraFiles['../package.json'];
    if (typeof packageJsonFile === 'object' && 'source' in packageJsonFile) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile.source!));
      expect(packageJson.devDependencies.vite).toBeUndefined();
      expect(packageJson.devDependencies['@vitejs/plugin-react']).toBeUndefined();
      expect(packageJson.scripts.dev).toBeUndefined();
      expect(packageJson.scripts.build).toBe('react-scripts build'); // Should have CRA scripts instead
      expect(packageJson.scripts.start).toBe('react-scripts start');
    }

    // Should include CRA-specific dependencies
    const packageJsonFile2 = extraFiles['../package.json'];
    if (typeof packageJsonFile2 === 'object' && 'source' in packageJsonFile2) {
      const packageJson = JSON.parse(stringOrHastToString(packageJsonFile2.source!));
      expect(packageJson.devDependencies['react-scripts']).toBe('latest');
    }
  });
});

describe('Integration with exportVariant', () => {
  it('should properly integrate with exportVariant functionality', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'Integration Test',
      useTypescript: true,
    });

    // Check that exportVariant features are working
    expect(result.exported.extraFiles).toBeDefined();

    // Should have original extraFiles
    expect(result.exported.extraFiles!['utils.js']).toBeDefined();

    // Should have CRA-specific files
    expect(result.exported.extraFiles!['../package.json']).toBeDefined();
    expect(result.exported.extraFiles!['../public/index.html']).toBeDefined();
    expect(result.exported.extraFiles!['../tsconfig.json']).toBeDefined(); // Because useTypescript: true
  });

  it('should handle complex extraFiles structure', () => {
    const complexVariantCode: VariantCode = {
      fileName: 'ComplexDemo.js',
      source: 'export default function ComplexDemo() { return <div>Complex</div>; }',
      metadataPrefix: 'src/',
      extraFiles: {
        'components/Button.jsx': {
          source: 'export const Button = () => <button>Click</button>;',
        },
        'hooks/useCounter.js': {
          source:
            'export const useCounter = () => { const [count, setCount] = useState(0); return [count, setCount]; };',
        },
        '../shared/constants.js': {
          source: 'export const API_URL = "https://api.example.com";',
          metadata: true,
        },
      },
    };

    const result = exportVariantAsCra(complexVariantCode, {
      title: 'Complex Demo',
    });

    // Should include all original files
    expect(result.exported.extraFiles!['components/Button.jsx']).toBeDefined();
    expect(result.exported.extraFiles!['hooks/useCounter.js']).toBeDefined();
    expect(result.exported.extraFiles!['../shared/constants.js']).toBeDefined();

    // Should handle the back-navigation file correctly
    const sharedConstants = result.exported.extraFiles!['../shared/constants.js'];
    if (typeof sharedConstants === 'object' && 'metadata' in sharedConstants) {
      expect(sharedConstants.metadata).toBe(true);
    }
  });

  it('should return rootFile path', () => {
    const result = exportVariantAsCra(mockVariantCode);

    expect(result.rootFile).toBeDefined();
    expect(typeof result.rootFile).toBe('string');
    expect(result.rootFile).toMatch(/^src\/.*\.js$/);
  });

  it('should skip JavaScript links in HTML (htmlSkipJsLink behavior)', () => {
    const result = exportVariantAsCra(mockVariantCode, {
      title: 'CRA Demo',
    });

    // Check that HTML file exists
    const htmlFile = result.exported.extraFiles!['../public/index.html'];
    expect(htmlFile).toBeDefined();

    if (typeof htmlFile === 'object' && 'source' in htmlFile) {
      const htmlContent = stringOrHastToString(htmlFile.source!);
      
      // For CRA, the HTML should NOT include script tags for the entrypoint
      // because CRA injects them automatically during build
      expect(htmlContent).not.toContain('<script type="module" src="src/index.');
      expect(htmlContent).not.toContain('<script src="src/index.');
      
      // But it should still have the basic HTML structure
      expect(htmlContent).toContain('<title>CRA Demo</title>');
      expect(htmlContent).toContain('<div id="root"></div>');
      expect(htmlContent.toLowerCase()).toContain('<!doctype html>');
    } else {
      throw new Error('Expected HTML file to be an object with source property');
    }
  });
});
