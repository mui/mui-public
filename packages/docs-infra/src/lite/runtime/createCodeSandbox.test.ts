import { describe, expect, it } from 'vitest';
import LZString from 'lz-string';
import { createCodeSandbox } from './createCodeSandbox';

function decodeParameters(parameters: string): Record<string, { content: string }> {
  const base64 = parameters.replaceAll('-', '+').replaceAll('_', '/');
  const json = LZString.decompressFromBase64(base64);
  return (JSON.parse(json) as { files: Record<string, { content: string }> }).files;
}

describe('createCodeSandbox', () => {
  it('wraps a demo in the same Vite project used by StackBlitz', () => {
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
        "index.html",
        "vite.config.ts",
        "tsconfig.json",
        "src/main.tsx",
        "src/Button.tsx",
      ]
    `);
    expect(files['src/main.tsx'].content).toContain("import Demo from './Button';");
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
    expect(files['index.html'].content).toContain('/demo.css');
  });
});
