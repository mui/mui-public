import { describe, expect, it } from 'vitest';
import { createSandboxFileSystem } from './createSandboxFileSystem';

describe('createSandboxFileSystem', () => {
  it('builds a path-to-content mapping for a Vite React project', () => {
    const files = createSandboxFileSystem({
      title: 'Button Demo',
      files: {
        'Button.tsx': "import { Button } from 'some-library'; export default Button;",
      },
      entryFileName: 'Button.tsx',
      dependencies: { 'some-library': '^2.0.0' },
      extraFiles: { 'public/demo.css': 'body { margin: 0; }' },
      htmlHead: '<link rel="stylesheet" href="/demo.css" />',
    });
    const packageJson = JSON.parse(files['package.json']) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(files)).toMatchInlineSnapshot(`
      [
        "package.json",
        "index.html",
        "vite.config.ts",
        "tsconfig.json",
        "src/main.tsx",
        "src/Button.tsx",
        "public/demo.css",
      ]
    `);
    expect(files['src/main.tsx']).toContain("import Demo from './Button';");
    expect(files['index.html']).toContain('/demo.css');
    expect(packageJson.dependencies['some-library']).toBe('^2.0.0');
  });
});
