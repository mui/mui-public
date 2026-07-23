import { describe, expect, it } from 'vitest';
import { createStackBlitz } from './createStackBlitz';

const BUTTON_SOURCE = [
  "import * as React from 'react';",
  '',
  'export default function Button() {',
  '  return <button type="button">Click</button>;',
  '}',
  '',
].join('\n');

interface PackageJsonShape {
  name: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

function packageJsonOf(formData: Record<string, string>): PackageJsonShape {
  return JSON.parse(formData['project[files][package.json]']) as PackageJsonShape;
}

describe('createStackBlitz', () => {
  it('wraps a TypeScript demo in a Vite project', () => {
    const { url, formData } = createStackBlitz({
      title: 'Button',
      files: { 'Button.tsx': BUTTON_SOURCE },
      entryFileName: 'Button.tsx',
    });
    expect(url).toBe('https://stackblitz.com/run?file=src/Button.tsx');
    expect(Object.keys(formData).filter((key) => key.startsWith('project[files]')))
      .toMatchInlineSnapshot(`
      [
        "project[files][package.json]",
        "project[files][index.html]",
        "project[files][vite.config.ts]",
        "project[files][tsconfig.json]",
        "project[files][src/main.tsx]",
        "project[files][src/Button.tsx]",
      ]
    `);
    expect(formData['project[files][src/main.tsx]']).toContain("import Demo from './Button';");
  });

  it('bootstraps named exports and JavaScript-only demos', () => {
    const { formData } = createStackBlitz({
      title: 'Toggle',
      files: { 'Toggle.jsx': 'export function Toggle() { return null; }\n' },
      entryFileName: 'Toggle.jsx',
      exportName: 'Toggle',
    });
    expect(formData['project[files][src/main.jsx]']).toContain(
      "import { Toggle as Demo } from './Toggle';",
    );
    expect(formData['project[files][vite.config.js]']).toBeDefined();
    expect(formData['project[files][tsconfig.json]']).toBeUndefined();
  });

  it('adds package imports and applies dependency overrides', () => {
    const { formData } = createStackBlitz({
      title: 'Demo',
      files: {
        'Demo.tsx': [
          "import * as React from 'react';",
          "import { thing } from 'some-library/subpath';",
          "import { widget } from '@scope/widgets/button';",
          "import './styles.css';",
          'export default thing;',
        ].join('\n'),
      },
      entryFileName: 'Demo.tsx',
      dependencies: { 'some-library': '^2.0.0', extra: '^1.0.0' },
    });
    expect(packageJsonOf(formData).dependencies).toMatchObject({
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      '@scope/widgets': 'latest',
      'some-library': '^2.0.0',
      extra: '^1.0.0',
    });
  });

  it('merges extra files and head markup into the scaffold', () => {
    const { formData } = createStackBlitz({
      title: 'Button',
      description: 'A button demo',
      files: { 'Button.tsx': BUTTON_SOURCE },
      entryFileName: 'Button.tsx',
      extraFiles: { 'public/demo.css': 'body { margin: 0; }\n' },
      htmlHead: '<link rel="stylesheet" href="/demo.css" />',
    });
    expect(formData['project[files][public/demo.css]']).toContain('margin');
    expect(formData['project[files][index.html]']).toContain('/demo.css');
    expect(packageJsonOf(formData).name).toBe('button');
  });
});
