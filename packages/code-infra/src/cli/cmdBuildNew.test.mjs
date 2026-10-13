import { parseSync } from '@babel/core';
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build as vite } from 'vite';
import ts from 'typescript';
import { parseFromProgram } from 'typescript-api-extractor';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const cli = path.resolve(import.meta.dirname, '../bin/code-infra.mjs');

/**
 * Creates a real library workspace used through the CLI and emitted files.
 * @param {string} packageType
 */
async function createLibrary(packageType) {
  const cwd = await makeTempDir();
  await fs.writeFile(path.join(cwd, 'pnpm-workspace.yaml'), 'packages: []\n');
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');
  const pkg = {
    name: 'library-fixture',
    version: '1.2.3',
    license: 'MIT',
    type: packageType,
    sideEffects: ['**/index.*', '**/effects.*'],
    exports: {
      '.': './src/index.ts',
      './conditional': { 'react-server': './src/server.ts', default: './src/client.ts' },
      './style.css': './src/style.css',
      './private': null,
    },
    imports: { '#counter': './src/counter.ts' },
    bin: { fixture: './src/bin.ts' },
    publishConfig: { directory: 'build', access: 'public' },
  };
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(
    path.join(cwd, 'tsconfig.build.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        types: ['node'],
      },
      include: ['src'],
      exclude: ['src/no-declarations.ts'],
    }),
  );
  await fs.mkdir(path.join(cwd, 'src'));
  const sources = {
    'index.ts':
      "import './effects';\nexport * as api from './counter';\nexport { default as native } from './native.cjs';\nexport { esmValue } from './esm.mjs';\nexport { default as common } from './common.cjs';\n",
    'counter.ts':
      "export let counter = 0;\nexport function bump() { counter += 1; }\nexport function hello1() { return 'used-member'; }\nexport function hello11() { return 'UNUSED_NAMESPACE_SENTINEL'; }\n",
    'effects.ts': "console.log('SIDE_EFFECT_SENTINEL');\n",
    'client.ts': "'use client';\nexport const client = 1;\n",
    'server.ts':
      "'use server';\nexport async function server() { return 2; }\nexport const identity = <T = unknown>(value: T) => value;\n",
    'worker.ts':
      "import { parentPort } from 'node:worker_threads'; parentPort?.postMessage('WORKER_MODULE_SENTINEL');\n",
    'bin.ts': "#!/usr/bin/env -S tsx\nimport { hello1 } from '#counter'; console.log(hello1());\n",
    'native.cjs': 'module.exports = { value: 42, version: process.env.MUI_VERSION };\n',
    'documented.ts':
      '/** PUBLIC_FUNCTION_DOCUMENTATION */\nexport function greet(options: GreetOptions) { return options.name; }\n/** PUBLIC_TYPE_DOCUMENTATION */\nexport interface GreetOptions { name: string; }\n',
    'docs.ts':
      "export { greet as welcome } from './documented'; export type { GreetOptions } from './documented';\n",
    'no-declarations.ts': 'export const javascriptOnly = 1;\n',
    'ambient.d.ts':
      'declare module "library-ambient" { export interface Ambient { value: number } }\n',
    'standalone.d.ts': 'export interface Standalone { value: number }\n',
    'native.d.cts': 'declare const value: { value: number; version: string }; export = value;\n',
    'esm.mts': 'export const esmValue = 3;\n',
    'common.cts': 'const value = { value: 4 }; export = value;\n',
    'style.css': '.fixture { color: red; }\n',
    'unused.test.cjs': "throw new Error('test files must not ship');\n",
    '__snapshots__/highlightTypes.test.ts.snap': 'SNAPSHOT_MUST_NOT_SHIP',
    '__snapshots__/reference.snap': 'SNAPSHOT_MUST_NOT_SHIP',
    'highlightTypes.test.ts.snap': 'SNAPSHOT_MUST_NOT_SHIP',
    'unused.spec.txt': 'TEST_ASSET_MUST_NOT_SHIP',
    'unused.test.ts': "throw new Error('test files must not ship');\n",
  };
  await Promise.all(
    Object.entries(sources).map(async ([file, contents]) => {
      const sourcePath = path.join(cwd, 'src', file);
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, contents);
    }),
  );
  return cwd;
}

/**
 * Reads client/server directive prologues from emitted modules.
 * @param {string} outputDir
 * @param {string[]} extensions
 */
async function readDirectives(outputDir, extensions) {
  return Promise.all(
    extensions.flatMap((extension) =>
      [
        ['client', 'use client'],
        ['server', 'use server'],
      ].map(async ([file, directive]) => {
        const code = await fs.readFile(path.join(outputDir, `${file}${extension}`), 'utf8');
        const ast = parseSync(code, { configFile: false, babelrc: false });
        return { directive, values: ast?.program.directives.map((node) => node.value.value) ?? [] };
      }),
    ),
  );
}

describe('build-new library consumption', () => {
  it.each(['preset', 'override', 'native-override'])(
    'rejects Babel module conversion through a %s',
    async (kind) => {
      const cwd = await createLibrary('module');
      await fs.writeFile(path.join(cwd, 'src/nativeNamed.cts'), 'export const value = 1;');
      const pkgPath = path.join(cwd, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
      pkg.dependencies = { '@babel/runtime': '^8.0.7' };
      await fs.writeFile(pkgPath, JSON.stringify(pkg));
      const preset = pathToFileURL(
        createRequire(path.join(repoRoot, 'packages/code-infra/package.json')).resolve(
          '@babel/preset-env',
        ),
      ).href;
      await fs.writeFile(
        path.join(cwd, 'babel.config.mjs'),
        `
      import presetEnv from ${JSON.stringify(preset)};
      export default {
        parserOpts: { plugins: ['typescript'] },
        presets: [[presetEnv, { modules: ${JSON.stringify(kind === 'preset' ? 'commonjs' : 'auto')}, targets: { node: 'current' } }]],
        overrides: ${kind !== 'preset' ? `[{ test: /${kind === 'native-override' ? 'nativeNamed\\.cts' : 'counter\\.ts'}$/, presets: [[presetEnv, { modules: 'commonjs' }]] }]` : '[]'},
      };
    `,
      );
      await expect(
        execa(process.execPath, [cli, 'build-new', '--skipTypes'], { cwd }),
      ).rejects.toThrow(/Babel converted ES module/);
    },
  );

  it('honors per-file Babel overrides without transforming generated runtime modules', async () => {
    const cwd = await createLibrary('module');
    const pkgPath = path.join(cwd, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    pkg.dependencies = { '@babel/runtime': '^8.0.7' };
    await fs.writeFile(pkgPath, JSON.stringify(pkg));
    await fs.writeFile(
      path.join(cwd, 'babel.config.mjs'),
      `
      export default {
        parserOpts: { plugins: ['typescript'] },
        plugins: [() => ({ visitor: { Program(_program, state) {
          if (!state.filename.includes('/src/')) throw new Error('Generated runtime passed through Babel');
        } } })],
        overrides: [{ test: /counter\\.ts$/, plugins: [({ types }) => ({ visitor: { StringLiteral(node) {
          if (node.node.value === 'used-member') node.replaceWith(types.stringLiteral('OVERRIDE_MEMBER'));
        } } })] }],
      };
    `,
    );
    await execa(process.execPath, [cli, 'build-new', '--skipTypes', '--sourceMap'], { cwd });
    const esm = await import(pathToFileURL(path.join(cwd, 'build/index.js')).href);
    const cjs = createRequire(import.meta.url)(path.join(cwd, 'build/index.cjs'));
    expect(esm.api.hello1()).toBe('OVERRIDE_MEMBER');
    expect(cjs.api.hello1()).toBe('OVERRIDE_MEMBER');
    const map = JSON.parse(await fs.readFile(path.join(cwd, 'build/counter.js.map'), 'utf8'));
    expect(map.sourcesContent.join('\n')).toContain('used-member');
  });

  it('preserves JSON assets that share a source module basename', async () => {
    const cwd = await createLibrary('module');
    await fs.writeFile(path.join(cwd, 'src/config.ts'), 'export const unrelated = 1;');
    await fs.writeFile(path.join(cwd, 'src/config.json'), '{"value":42}');
    await fs.writeFile(
      path.join(cwd, 'src/asset.ts'),
      "import config from './config.json' with { type: 'json' }; export const value = config.value;",
    );
    await execa(process.execPath, [cli, 'build-new', '--bundle', 'esm', '--skipTypes'], { cwd });
    const emitted = await import(pathToFileURL(path.join(cwd, 'build/asset.js')).href);
    expect(emitted.value).toBe(42);
    expect(JSON.parse(await fs.readFile(path.join(cwd, 'build/config.json'), 'utf8'))).toEqual({
      value: 42,
    });
  });

  it('flattens pure barrels and inlines metadata without crossing directives or losing effects', async () => {
    const cwd = await createLibrary('module');
    const sources = {
      'orderLog.ts': 'export const events = [];',
      'orderFirst.ts':
        "import { events } from './orderLog'; events.push('first'); export const value = 1;",
      'orderSecond.ts':
        "import { events } from './orderLog'; events.push('second'); export const value = 2;",
      'orderConsumer.ts':
        "import * as first from './orderFirst'; import * as second from './orderSecond'; import { events } from './orderLog'; export const sum = first.value + second.value; export { events };",
      'localRequire.ts':
        "import { value as first } from './orderFirst'; const require = (name) => ({ value: name === 'config' ? 42 : 0 }); const computed = require('config'); export const answer = first + computed.value;",
      'metadata.ts':
        "export const open = 'data-open'; export const width = '--popup-width'; export const plain = 'plain';",
      'unselectedEffect.ts': "console.log('UNSELECTED_BARREL_EFFECT'); export const hidden = 1;",
      'cycleFunctionA.ts':
        "import './cycleFunctionB'; import { open } from './metadata'; export function beforeInit() { return open; }",
      'cycleFunctionB.ts':
        "import { beforeInit } from './cycleFunctionA'; export const result = beforeInit();",
      'barrel.ts':
        "export { open as renamed, width, plain } from './metadata'; export { counter, bump } from './counter'; export * as api from './counter'; export { hidden } from './unselectedEffect';",
      'clientBarrel.ts': "'use client'; export { open } from './metadata';",
      'effectMetadata.ts':
        "export const effects = []; effects.push('initialized'); export const open = 'data-effect';",
      'extra.ts':
        "import { renamed, width, counter, bump, api } from './barrel'; import { open as boundary } from './clientBarrel'; import * as effects from './effectMetadata'; export const attributes = { [renamed]: '', [width]: '10px' }; export function read() { return [counter, boundary, effects.open, api.counter, effects.effects.length]; } export { bump }; export function shadow(renamed) { return renamed; }",
      'dynamic.ts':
        "import * as metadata from './metadata'; export function dynamic(key) { return metadata[key]; } export const computed = metadata['open'];",
      'cycleA.ts': "export * from './cycleB';",
      'cycleB.ts': "export * from './cycleA';",
      'cycleConsumer.ts':
        "import * as cycle from './cycleA'; export function keys() { return Object.keys(cycle); }",
      'defaultOnly.ts': 'export default function answer() { return 42; }',
      'otherMetadata.ts': "export const open = 'data-other';",
      'ambiguous.ts': "export * from './metadata'; export * from './otherMetadata';",
      'ambiguousConsumer.ts':
        "import * as ambiguous from './ambiguous'; export const open = ambiguous.open;",
    };
    await Promise.all(
      Object.entries(sources).map(([file, code]) =>
        fs.writeFile(path.join(cwd, 'src', file), code),
      ),
    );
    await execa(process.execPath, [cli, 'build-new', '--skipTypes', '--sourceMap'], { cwd });
    const code = await fs.readFile(path.join(cwd, 'build/extra.js'), 'utf8');
    expect(code).toContain('"data-open"');
    expect(code).toContain('"--popup-width"');
    expect(code).toMatch(/from "\.\/counter\.js"/);
    expect(code).toMatch(/from "\.\/clientBarrel\.js"/);
    expect(code).toMatch(/from "\.\/effectMetadata\.js"/);
    const esm = await import(pathToFileURL(path.join(cwd, 'build/extra.js')).href);
    expect(esm.attributes).toEqual({ 'data-open': '', '--popup-width': '10px' });
    expect(esm.read()).toEqual([0, 'data-open', 'data-effect', 0, 1]);
    esm.bump();
    expect(esm.read()).toEqual([1, 'data-open', 'data-effect', 1, 1]);
    expect(esm.shadow('shadowed')).toBe('shadowed');
    const cjs = createRequire(import.meta.url)(path.join(cwd, 'build/extra.cjs'));
    expect(cjs.attributes).toEqual(esm.attributes);
    expect(cjs.read()).toEqual([0, 'data-open', 'data-effect', 0, 1]);
    const defaults = createRequire(import.meta.url)(path.join(cwd, 'build/defaultOnly.cjs'));
    expect(Reflect.get(defaults, '__esModule')).toBe(true);
    expect(defaults.default()).toBe(42);
    const esmOrder = await import(pathToFileURL(path.join(cwd, 'build/orderConsumer.js')).href);
    const cjsOrder = createRequire(import.meta.url)(path.join(cwd, 'build/orderConsumer.cjs'));
    expect(esmOrder.sum).toBe(3);
    expect(esmOrder.events).toEqual(['first', 'second']);
    expect(cjsOrder.events).toEqual(['first', 'second']);
    const localRequire = await import(pathToFileURL(path.join(cwd, 'build/localRequire.js')).href);
    expect(localRequire.answer).toBe(43);
    expect(createRequire(import.meta.url)(path.join(cwd, 'build/localRequire.cjs')).answer).toBe(
      43,
    );
    const dynamic = await import(pathToFileURL(path.join(cwd, 'build/dynamic.js')).href);
    expect(dynamic.dynamic('plain')).toBe('plain');
    expect(dynamic.computed).toBe('data-open');
    const cycle = await import(pathToFileURL(path.join(cwd, 'build/cycleConsumer.js')).href);
    expect(cycle.keys()).toEqual([]);
    const ambiguous = await execa(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { open } from ${JSON.stringify(pathToFileURL(path.join(cwd, 'build/ambiguousConsumer.js')).href)}; console.log(String(open));`,
      ],
      { cwd },
    );
    expect(ambiguous.stdout).toBe('undefined');
    const effects = await execa(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import ${JSON.stringify(pathToFileURL(path.join(cwd, 'build/extra.js')).href)};`,
      ],
      { cwd },
    );
    expect(effects.stdout).toContain('UNSELECTED_BARREL_EFFECT');
    await expect(
      execa(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import ${JSON.stringify(pathToFileURL(path.join(cwd, 'build/cycleFunctionA.js')).href)};`,
        ],
        { cwd },
      ),
    ).rejects.toThrow(/before initialization/);
    const client = parseSync(await fs.readFile(path.join(cwd, 'build/clientBarrel.js'), 'utf8'), {
      configFile: false,
      babelrc: false,
    });
    expect(
      client?.program.directives.filter((node) => node.value.value === 'use client'),
    ).toHaveLength(1);
    const map = JSON.parse(await fs.readFile(path.join(cwd, 'build/extra.js.map'), 'utf8'));
    expect(map.sourcesContent.join('\n')).toContain('import { renamed, width');
  });
  it.each(['bin', 'asset', 'collision'])('rejects an invalid %s emission plan', async (kind) => {
    const cwd = await createLibrary('module');
    if (kind === 'bin') {
      const pkgPath = path.join(cwd, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
      pkg.bin = { fixture: './run.ts' };
      await fs.writeFile(pkgPath, JSON.stringify(pkg));
      await fs.writeFile(path.join(cwd, 'run.ts'), 'console.log(1);');
    } else if (kind === 'asset') {
      await fs.writeFile(path.join(cwd, 'config.json'), '{}');
      await fs.appendFile(path.join(cwd, 'src/index.ts'), "import '../config.json';\n");
    } else {
      await fs.writeFile(path.join(cwd, 'src/counter.js'), 'export const counter = 0;');
    }
    let expected = /share the output path/;
    if (kind === 'bin') {
      expected = /must be inside src/;
    } else if (kind === 'asset') {
      expected = /outside src/;
    }
    await expect(
      execa(process.execPath, [cli, 'build-new', '--skipTypes'], { cwd }),
    ).rejects.toThrow(expected);
  });
  it('restores directives removed by a repository Babel transform', async () => {
    const cwd = await createLibrary('module');
    const pkgPath = path.join(cwd, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    pkg.dependencies = { '@babel/runtime': '^8.0.7' };
    await fs.writeFile(pkgPath, JSON.stringify(pkg));
    await fs.writeFile(
      path.join(cwd, 'babel.config.mjs'),
      `
      export default {
        parserOpts: { plugins: ['typescript'] },
        plugins: [() => ({ visitor: { Program(programPath) { programPath.node.directives = []; } } })],
      };
    `,
    );
    await execa(process.execPath, [cli, 'build-new', '--skipTypes'], { cwd });
    const publishedFiles = await fs.readdir(path.join(cwd, 'build'), { recursive: true });
    expect(publishedFiles.some((file) => /\.d\.[cm]?ts(?:\.map)?$/.test(file))).toBe(false);
    const prologues = await readDirectives(path.join(cwd, 'build'), ['.js', '.cjs']);
    for (const { directive, values } of prologues) {
      expect(values.filter((value) => value === directive)).toHaveLength(1);
    }
  });
  it.each([
    { packageType: 'module', tsgo: false },
    { packageType: 'commonjs', tsgo: false },
    { packageType: 'module', tsgo: true },
    { packageType: 'commonjs', tsgo: true },
  ])(
    'preserves library semantics for package type $packageType with tsgo=$tsgo',
    async ({ packageType, tsgo }) => {
      const cwd = await createLibrary(packageType);
      await execa(
        process.execPath,
        [cli, 'build-new', '--bundle', 'esm', 'cjs', '--sourceMap', ...(tsgo ? ['--tsgo'] : [])],
        {
          cwd,
        },
      );
      const outputDir = path.join(cwd, 'build');
      const pkg = JSON.parse(await fs.readFile(path.join(outputDir, 'package.json'), 'utf8'));
      const esmExtension = packageType === 'module' ? '.js' : '.mjs';
      const cjsExtension = packageType === 'module' ? '.cjs' : '.js';
      const entry = path.join(outputDir, `index${esmExtension}`);
      const declarationExtension = packageType === 'module' ? '.d.ts' : '.d.mts';
      const docsEntry = path.join(outputDir, `docs${declarationExtension}`);
      const program = ts.createProgram([docsEntry], {
        rootDir: outputDir,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        types: ['node'],
      });
      const documentation = parseFromProgram(docsEntry, program);
      expect(
        documentation.exports.find((node) => node.name === 'welcome')?.documentation?.description,
      ).toBe('PUBLIC_FUNCTION_DOCUMENTATION');
      expect(
        documentation.exports.find((node) => node.name === 'GreetOptions')?.documentation
          ?.description,
      ).toBe('PUBLIC_TYPE_DOCUMENTATION');
      expect(
        JSON.parse(
          await fs.readFile(path.join(outputDir, `counter${declarationExtension}.map`), 'utf8'),
        ).sources.length,
      ).toBeGreaterThan(0);
      const esm = await import(pathToFileURL(entry).href);
      expect(esm.api.counter).toBe(0);
      esm.api.bump();
      expect(esm.api.counter).toBe(1);
      expect(esm.native.value).toBe(42);
      expect(esm.native.version).toBe('1.2.3');
      expect(esm.esmValue).toBe(3);
      expect(esm.common.value).toBe(4);
      const cjs = createRequire(import.meta.url)(path.join(outputDir, `index${cjsExtension}`));
      cjs.api.bump();
      expect(cjs.api.counter).toBe(1);
      expect(cjs.native.value).toBe(42);
      expect(cjs.native.version).toBe('1.2.3');
      expect(cjs.esmValue).toBe(3);
      expect(cjs.common.value).toBe(4);
      const prologues = await readDirectives(outputDir, [esmExtension, cjsExtension]);
      for (const { directive, values } of prologues) {
        expect(values.filter((value) => value === directive)).toHaveLength(1);
      }
      expect(await fs.readFile(path.join(outputDir, `worker${esmExtension}`), 'utf8')).toContain(
        'WORKER_MODULE_SENTINEL',
      );
      expect(await fs.readFile(path.join(outputDir, 'style.css'), 'utf8')).toContain('color: red');
      const files = await fs.readdir(outputDir, { recursive: true, withFileTypes: true });
      expect(
        files.some(
          (file) =>
            file.isFile() &&
            (file.name.includes('.test.') ||
              file.name.includes('.spec.') ||
              file.parentPath.includes('__snapshots__')),
        ),
      ).toBe(false);
      expect(files.some((file) => file.name.startsWith('no-declarations.d.'))).toBe(false);
      expect(
        await fs.readFile(path.join(outputDir, `no-declarations${esmExtension}`), 'utf8'),
      ).toContain('javascriptOnly');
      expect(pkg.publishConfig).toEqual({ access: 'public' });
      expect(pkg.exports['./private']).toBeNull();
      expect(pkg.exports['./conditional']['react-server'].import.default).toBe(
        `./server${esmExtension}`,
      );
      expect(pkg.imports['#counter'].require.default).toBe(`./counter${cjsExtension}`);
      expect(pkg.exports['./worker']).toBeUndefined();
      const worker = new Worker(pathToFileURL(path.join(outputDir, `worker${esmExtension}`)));
      const message = await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      await worker.terminate();
      expect(message).toBe('WORKER_MODULE_SENTINEL');
      const bin = await execa(process.execPath, [path.join(outputDir, pkg.bin.fixture)], { cwd });
      expect(bin.stdout).toBe('used-member');
      expect(await fs.readFile(path.join(outputDir, pkg.bin.fixture), 'utf8')).toMatch(
        /^#!\/usr\/bin\/env node\n/,
      );
      expect(
        await fs.readFile(path.join(outputDir, `counter${esmExtension}.map`), 'utf8'),
      ).toContain('sources');
      await fs.writeFile(
        path.join(cwd, 'consumer.ts'),
        `import { api } from './build/index${esmExtension}'; console.log(api.hello1(), api.counter);`,
      );
      const consumer = await vite({
        configFile: false,
        root: cwd,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          lib: { entry: path.join(cwd, 'consumer.ts'), formats: ['es'] },
        },
      });
      if (!Array.isArray(consumer) && 'on' in consumer) {
        throw new Error('Unexpected watch build');
      }
      const chunks = Array.isArray(consumer)
        ? consumer.flatMap((result) => result.output)
        : consumer.output;
      const code = chunks
        .flatMap((chunk) => (chunk.type === 'chunk' ? [chunk.code] : []))
        .join('\n');
      expect(code).toContain('used-member');
      expect(code).toContain('SIDE_EFFECT_SENTINEL');
      expect(code).not.toContain('UNUSED_NAMESPACE_SENTINEL');
      expect(code).not.toContain('__exportAll');
      await fs.writeFile(
        path.join(cwd, 'cjs-consumer.cjs'),
        `const { api } = require('./build/index${cjsExtension}'); console.log(api.hello1());`,
      );
      const cjsApp = await vite({
        configFile: false,
        root: cwd,
        logLevel: 'silent',
        build: {
          outDir: 'cjs-consumer-output',
          minify: false,
          commonjsOptions: { include: [/cjs-consumer/, /\/build\//] },
          lib: { entry: path.join(cwd, 'cjs-consumer.cjs'), formats: ['es'] },
        },
      });
      if (!Array.isArray(cjsApp) && 'on' in cjsApp) {
        throw new Error('Unexpected watch build');
      }
      const cjsOutputs = Array.isArray(cjsApp)
        ? cjsApp.flatMap((result) => result.output)
        : cjsApp.output;
      const cjsEntry = cjsOutputs.find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
      if (!cjsEntry) {
        throw new Error('Missing CJS consumer entry');
      }
      const executed = await execa(
        process.execPath,
        [path.join(cwd, 'cjs-consumer-output', cjsEntry.fileName)],
        { cwd },
      );
      expect(executed.stdout).toContain('used-member');
      expect(executed.stdout).toContain('SIDE_EFFECT_SENTINEL');
      await fs.writeFile(
        path.join(cwd, 'types-consumer.mts'),
        `/// <reference path="./build/ambient.d.ts" />\nimport type { Ambient } from 'library-ambient'; const ambient: Ambient = { value: 1 }; void ambient; import type { Standalone } from './build/standalone${esmExtension}'; const standalone: Standalone = { value: 1 }; void standalone; import { api, esmValue, common, native } from './build/index${esmExtension}'; const nativeValue: number = native.value; void nativeValue; const extra: number = esmValue + common.value; void extra; const count: number = api.counter; api.bump(); void count;`,
      );
      await fs.writeFile(
        path.join(cwd, 'types-consumer.cts'),
        `import type { Standalone } from './build/standalone${cjsExtension}'; const standalone: Standalone = { value: 1 }; void standalone; import { api, esmValue, common, native } from './build/index${cjsExtension}'; const nativeValue: number = native.value; void nativeValue; const extra: number = esmValue + common.value; void extra; const count: number = api.counter; api.bump(); void count;`,
      );
      await execa(
        path.join(repoRoot, 'node_modules/.bin/tsc6'),
        [
          '--noEmit',
          '--strict',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2022',
          '--types',
          'node',
          path.join(cwd, 'types-consumer.mts'),
          path.join(cwd, 'types-consumer.cts'),
        ],
        { cwd },
      );
    },
    30000,
  );
});
