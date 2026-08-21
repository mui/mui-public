import { describe, expect, it } from 'vitest';
import LZString from 'lz-string';
import { createCodeSandbox } from './createCodeSandbox';

function decodeParameters(parameters: string): Record<string, { content: string }> {
  const base64 = parameters.replaceAll('-', '+').replaceAll('_', '/');
  const json = LZString.decompressFromBase64(base64);
  return (JSON.parse(json) as { files: Record<string, { content: string }> }).files;
}

describe('createCodeSandbox', () => {
  it('wraps a TypeScript demo in a Create React App project', () => {
    const { url, formData } = createCodeSandbox({
      title: 'Button',
      files: {
        'Button.tsx': 'export default function Button() { return <button>Click</button>; }',
      },
      entryFileName: 'Button.tsx',
    });
    const files = decodeParameters(formData.parameters);

    expect(url).toBe('https://codesandbox.io/api/v1/sandboxes/define');
    expect(formData.query).toBe('file=src/Button.tsx');
    expect(Object.keys(files)).toMatchInlineSnapshot(`
      [
        "package.json",
        "public/index.html",
        "tsconfig.json",
        "src/Button.tsx",
        "src/index.tsx",
      ]
    `);
    expect(files['src/index.tsx'].content).toContain("import App from './Button';");
    expect(files['public/index.html'].content).not.toContain('<script');
    const packageJson = JSON.parse(files['package.json'].content) as {
      type?: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.type).toBeUndefined();
    expect(packageJson.scripts.start).toBe('react-scripts start');
    expect(packageJson.devDependencies['react-scripts']).toBe('latest');
  });

  it('preserves dependency overrides, extra files, and HTML head markup', () => {
    const { formData } = createCodeSandbox({
      title: 'Demo',
      files: {
        'Demo.jsx': "import value from 'some-library'; export default value;",
      },
      entryFileName: 'Demo.jsx',
      dependencies: { 'some-library': '^2.0.0' },
      extraFiles: { 'public/demo.css': 'body { margin: 0; }' },
      htmlHead: '<link rel="stylesheet" href="/demo.css" />',
    });
    const files = decodeParameters(formData.parameters);
    const packageJson = JSON.parse(files['package.json'].content) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies['some-library']).toBe('^2.0.0');
    expect(files['public/demo.css'].content).toContain('margin');
    expect(files['public/index.html'].content).toContain('/demo.css');
  });

  it('renames an index demo to App and selects the demo source', () => {
    const { formData } = createCodeSandbox({
      title: 'Demo',
      files: { 'index.tsx': 'export default function Demo() { return null; }' },
      entryFileName: 'index.tsx',
    });
    const files = decodeParameters(formData.parameters);

    expect(formData.query).toBe('file=src/App.tsx');
    expect(files['src/App.tsx'].content).toContain('function Demo');
    expect(files['src/index.tsx'].content).toContain("import App from './App';");
  });
});
