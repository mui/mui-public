export type SandboxFileSystem = Record<string, string>;

export interface CreateSandboxFileSystemOptions {
  title: string;
  description?: string;
  files: SandboxFileSystem;
  entryFileName: string;
  exportName?: string;
  dependencies?: Record<string, string>;
  extraFiles?: SandboxFileSystem;
  htmlHead?: string;
}

const JS_FILES = /\.(tsx|ts|jsx|js)$/;
const TS_FILES = /\.(tsx|ts)$/;
const IMPORT_SPECIFIERS =
  /\bimport\s+['"]([^'"]+)['"]|\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/g;

function toPackageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.includes(':')) {
    return null;
  }
  const [first, second] = specifier.split('/');
  if (first.startsWith('@')) {
    return second && first.length > 1 ? `${first}/${second}` : null;
  }
  return first || null;
}

export function collectSandboxPackages(files: SandboxFileSystem): string[] {
  const packages = new Set<string>();
  for (const [fileName, source] of Object.entries(files)) {
    if (!JS_FILES.test(fileName)) {
      continue;
    }
    for (const match of source.matchAll(IMPORT_SPECIFIERS)) {
      const packageName = toPackageName(match[1] ?? match[2] ?? match[3] ?? '');
      if (packageName) {
        packages.add(packageName);
      }
    }
  }
  return [...packages].sort();
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

function htmlTemplate(
  title: string,
  description: string | undefined,
  mainFile: string,
  htmlHead: string | undefined,
): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    `    <title>${escapeHtml(title)}</title>`,
    ...(description
      ? [`    <meta name="description" content="${escapeHtml(description)}" />`]
      : []),
    '    <meta name="viewport" content="initial-scale=1, width=device-width" />',
    ...(htmlHead ? htmlHead.split('\n').map((line) => `    ${line}`) : []),
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    `    <script type="module" src="/src/${mainFile}"></script>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

function mainTemplate(entryFileName: string, exportName: string, useTypescript: boolean): string {
  const modulePath = `./${entryFileName.replace(JS_FILES, '')}`;
  const demoImport =
    exportName === 'default'
      ? `import Demo from '${modulePath}';`
      : `import { ${exportName} as Demo } from '${modulePath}';`;
  return [
    "import * as React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    demoImport,
    '',
    `createRoot(document.getElementById('root')${useTypescript ? '!' : ''}).render(`,
    '  <React.StrictMode>',
    '    <Demo />',
    '  </React.StrictMode>,',
    ');',
    '',
  ].join('\n');
}

const VITE_CONFIG = [
  "import { defineConfig } from 'vite';",
  "import react from '@vitejs/plugin-react';",
  '',
  'export default defineConfig({',
  '  plugins: [react()],',
  '});',
  '',
].join('\n');

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src'],
};

/** Builds a path-to-content mapping for a Vite React demo project. */
export function createSandboxFileSystem(
  options: CreateSandboxFileSystemOptions,
): SandboxFileSystem {
  const { title, description, files, entryFileName, exportName = 'default' } = options;
  const useTypescript = Object.keys(files).some((fileName) => TS_FILES.test(fileName));
  const extension = useTypescript ? 'tsx' : 'jsx';
  const mainFile = `main.${extension}` in files ? `bootstrap.${extension}` : `main.${extension}`;
  const detected = Object.fromEntries(
    collectSandboxPackages(files)
      .filter((name) => name !== 'react' && name !== 'react-dom')
      .map((name) => [name, 'latest']),
  );
  const packageJson = {
    name:
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'demo',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      ...detected,
      ...options.dependencies,
    },
    devDependencies: {
      vite: 'latest',
      '@vitejs/plugin-react': 'latest',
      ...(useTypescript
        ? {
            typescript: 'latest',
            '@types/react': '^19.0.0',
            '@types/react-dom': '^19.0.0',
          }
        : {}),
    },
  };
  const fileSystem: SandboxFileSystem = {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'index.html': htmlTemplate(title, description, mainFile, options.htmlHead),
    [`vite.config.${useTypescript ? 'ts' : 'js'}`]: VITE_CONFIG,
    ...(useTypescript ? { 'tsconfig.json': `${JSON.stringify(TSCONFIG, null, 2)}\n` } : {}),
    [`src/${mainFile}`]: mainTemplate(entryFileName, exportName, useTypescript),
  };
  for (const [fileName, source] of Object.entries(files)) {
    fileSystem[`src/${fileName}`] = source;
  }
  Object.assign(fileSystem, options.extraFiles);
  return fileSystem;
}
