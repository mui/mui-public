import { collectSandboxPackages } from './createSandboxFileSystem';
import type { CreateSandboxFileSystemOptions, SandboxFileSystem } from './createSandboxFileSystem';

const JS_FILES = /\.(tsx|ts|jsx|js)$/;
const TS_FILES = /\.(tsx|ts)$/;

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

function htmlTemplate(
  title: string,
  description: string | undefined,
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
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

function sourceFileName(options: CreateSandboxFileSystemOptions, useTypescript: boolean): string {
  const { entryFileName, files } = options;
  const extension = useTypescript ? 'tsx' : 'jsx';
  if (entryFileName !== `index.${extension}`) {
    return entryFileName;
  }
  const candidates = [`App.${extension}`, `entrypoint.${extension}`, `main.${extension}`];
  return (
    candidates.find((candidate) => files[candidate] === undefined) ?? `index-entry.${extension}`
  );
}

function rootIndexTemplate(sourceFile: string, exportName: string, useTypescript: boolean): string {
  const modulePath = `./${sourceFile.replace(JS_FILES, '')}`;
  const demoImport =
    exportName === 'default'
      ? `import App from '${modulePath}';`
      : `import { ${exportName} as App } from '${modulePath}';`;
  return [
    "import * as React from 'react';",
    "import * as ReactDOM from 'react-dom/client';",
    demoImport,
    '',
    `ReactDOM.createRoot(document.getElementById('root')${useTypescript ? '!' : ''}).render(`,
    '  <React.StrictMode>',
    '    <App />',
    '  </React.StrictMode>,',
    ');',
    '',
  ].join('\n');
}

/** Builds the Create React App filesystem used by CodeSandbox. */
export function createCodeSandboxFileSystem(options: CreateSandboxFileSystemOptions): {
  fileSystem: SandboxFileSystem;
  rootFile: string;
} {
  const { title, description, files, exportName = 'default' } = options;
  const useTypescript = Object.keys(files).some((fileName) => TS_FILES.test(fileName));
  const extension = useTypescript ? 'tsx' : 'jsx';
  const sourceFile = sourceFileName(options, useTypescript);
  const detected = Object.fromEntries(
    collectSandboxPackages(files)
      .filter((name) => name !== 'react' && name !== 'react-dom')
      .map((name) => [name, 'latest']),
  );
  const packageJson = {
    private: true,
    name: title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    version: '0.0.0',
    description,
    scripts: {
      start: 'react-scripts start',
      build: 'react-scripts build',
      test: 'react-scripts test',
      eject: 'react-scripts eject',
    },
    dependencies: {
      react: '^19',
      'react-dom': '^19',
      ...detected,
      ...options.dependencies,
    },
    devDependencies: {
      'react-scripts': 'latest',
      ...(useTypescript
        ? {
            typescript: 'latest',
            '@types/react': '^19',
            '@types/react-dom': '^19',
          }
        : {}),
    },
  };
  const fileSystem: SandboxFileSystem = {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'public/index.html': htmlTemplate(title, description, options.htmlHead),
    ...(useTypescript
      ? {
          'tsconfig.json': `${JSON.stringify(
            {
              compilerOptions: {
                target: 'ES2020',
                useDefineForClassFields: true,
                lib: ['ES2020', 'DOM', 'DOM.Iterable'],
                module: 'ESNext',
                skipLibCheck: true,
                moduleResolution: 'node',
                allowImportingTsExtensions: true,
                resolveJsonModule: true,
                isolatedModules: true,
                noEmit: true,
                jsx: 'react',
                strict: true,
                noUnusedLocals: true,
                noUnusedParameters: true,
                noFallthroughCasesInSwitch: true,
                allowJs: true,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                forceConsistentCasingInFileNames: true,
              },
              include: ['src'],
            },
            null,
            2,
          )}\n`,
        }
      : {}),
  };
  for (const [fileName, source] of Object.entries(files)) {
    fileSystem[`src/${fileName === options.entryFileName ? sourceFile : fileName}`] = source;
  }
  fileSystem[`src/index.${extension}`] = rootIndexTemplate(sourceFile, exportName, useTypescript);
  Object.assign(fileSystem, options.extraFiles);
  return { fileSystem, rootFile: `src/${sourceFile}` };
}
