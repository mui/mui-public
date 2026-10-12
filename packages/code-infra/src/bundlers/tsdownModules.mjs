import { parseAsync, transformAsync } from '@babel/core';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import { parse } from 'yuku-parser';
import { createFilesMatcher, parseTsconfig } from 'get-tsconfig';
import MagicString from 'magic-string';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'tsdown';
import { declarationReexports } from './declarationReexports.mjs';

// Babel configurations read build settings from process.env. Isolate formats in
// separate processes so parallel ESM and CommonJS builds cannot share that state.
/** @type {{ sourceDir: string; ignores: string[]; declarationIgnores: string[]; outDir: string; configFile: string | null; binSources: string[]; banner: string; outExtension: string; bundle: 'esm' | 'cjs'; sourceMap: boolean; skipTypes: boolean; tsgo: boolean; typeOutExtension: string; verbose: boolean }} */
const options = JSON.parse(process.argv[2]);
// Support the repository's TypeScript 7 alias. For standard installations,
// let rolldown-plugin-dts discover typescript or @typescript/native-preview.
const require = createRequire(path.join(process.cwd(), 'package.json'));
let nativeCompiler;
if (options.tsgo && !options.skipTypes) {
  let nativePackage;
  try {
    nativePackage = require.resolve('@typescript/native/package.json');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
  if (nativePackage) {
    const { default: getExePath } = await import(
      pathToFileURL(path.join(path.dirname(nativePackage), 'lib/getExePath.js')).href
    );
    nativeCompiler = getExePath();
  }
}
const files = await globby('**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}', {
  cwd: options.sourceDir,
  ignore: [...options.ignores, '**/*.d.{ts,mts,cts}'],
  absolute: true,
});
/** @type {Map<string, string>} */
const sources = new Map();
const entries = Object.fromEntries(
  files.map((file) => {
    const stem = path
      .relative(options.sourceDir, file)
      .slice(0, -path.extname(file).length)
      .split(path.sep)
      .join('/');
    if (sources.has(stem)) {
      throw new Error(
        `Source files share the output path "${stem}": ${sources.get(stem)} and ${file}`,
      );
    }
    sources.set(stem, file);
    return [stem, file];
  }),
);
/** @type {Map<string, string[]>} */
const directives = new Map();
await build({
  config: false,
  entry: entries,
  outDir: options.outDir,
  clean: false,
  dts: false,
  env: Object.fromEntries(
    [
      'MUI_VERSION',
      'MUI_MAJOR_VERSION',
      'MUI_MINOR_VERSION',
      'MUI_PATCH_VERSION',
      'MUI_PRERELEASE',
    ].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  ),
  format: options.bundle,
  platform: 'neutral',
  target: false,
  treeshake: false,
  cjsDefault: false,
  sourcemap: options.sourceMap,
  outExtensions: () => ({ js: options.outExtension, dts: options.typeOutExtension }),
  logLevel: options.verbose ? 'info' : 'error',
  inputOptions: {
    // Keep dependency imports external; local edges are resolved and rewritten below.
    external: (id, importer) => Boolean(importer) && !id.startsWith('.') && !path.isAbsolute(id),
  },
  outputOptions: {
    exports: 'named',
    banner: (chunk) => (chunk.name === 'index' ? options.banner : ''),
  },
  plugins: [
    {
      name: 'mui-library-modules',
      async resolveId(id, importer) {
        if (!importer || (!id.startsWith('.') && !path.isAbsolute(id))) {
          return null;
        }
        const resolved = await this.resolve(id, importer, { skipSelf: true });
        let resolvedSource = resolved?.id;
        // Repository Babel plugins can introduce imports using the output extension.
        if (!resolvedSource && ['.js', '.mjs', '.cjs'].includes(path.extname(id))) {
          const requested = path.resolve(path.dirname(importer), id);
          const requestedStem = path
            .relative(options.sourceDir, requested)
            .slice(0, -path.extname(requested).length)
            .split(path.sep)
            .join('/');
          const source = sources.get(requestedStem);
          if (source) {
            resolvedSource = source;
          }
        }
        if (!resolvedSource) {
          throw new Error(`Cannot resolve library import "${id}" from "${importer}".`);
        }
        const stem = path
          .relative(options.sourceDir, resolvedSource)
          .slice(0, -path.extname(resolvedSource).length)
          .split(path.sep)
          .join('/');
        if (!sources.has(stem)) {
          if (/\.[cm]?[jt]sx?$/.test(resolvedSource)) {
            throw new Error(
              `Library import "${id}" references excluded source "${resolvedSource}".`,
            );
          }
          if (!resolvedSource.startsWith(`${options.sourceDir}${path.sep}`)) {
            throw new Error(
              `Library asset "${id}" is outside src and cannot be copied by build-new.`,
            );
          }
          // Assets are copied verbatim alongside the compiled files.
          return { id, external: true };
        }
        const target = path.join(options.outDir, `${stem}${options.outExtension}`);
        const importerStem = path
          .relative(options.sourceDir, importer)
          .slice(0, -path.extname(importer).length);
        const importerOut = path.join(options.outDir, `${importerStem}${options.outExtension}`);
        let relative = path.relative(path.dirname(importerOut), target).split(path.sep).join('/');
        if (!relative.startsWith('.')) {
          relative = `./${relative}`;
        }
        return { id: relative, external: true };
      },
      async transform(code, id) {
        const ast = await parseAsync(code, {
          filename: id,
          configFile: false,
          babelrc: false,
          parserOpts: { plugins: /\.[cm]?ts$/.test(id) ? ['typescript'] : ['typescript', 'jsx'] },
        });
        if (ast?.type === 'File') {
          directives.set(
            id,
            ast.program.directives.map((directive) => directive.value.value),
          );
        }
        if (!options.configFile) {
          return null;
        }
        const result = await transformAsync(code, {
          filename: id,
          configFile: options.configFile,
          caller: { name: 'tsdown-bundler', supportsStaticESM: true },
          sourceMaps: options.sourceMap,
          ast: true,
        });
        return result
          ? { code: result.code ?? '', map: result.map ? JSON.stringify(result.map) : undefined }
          : null;
      },
      async renderChunk(code, chunk) {
        const prologue = directives.get(chunk.facadeModuleId ?? '') ?? [];
        const retained = prologue.filter((directive) => directive !== 'use strict');
        const isBin = options.binSources.includes(chunk.facadeModuleId ?? '');
        if (!retained.length && !isBin) {
          return null;
        }
        const ast = await parseAsync(code, { configFile: false, babelrc: false });
        const emitted = new Set(ast?.program.directives.map((directive) => directive.value.value));
        const missing = [...new Set(retained)].filter((directive) => !emitted.has(directive));
        if (!missing.length && !isBin) {
          return null;
        }
        const output = new MagicString(code);
        const shebangEnd = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
        if (isBin && shebangEnd) {
          output.overwrite(0, shebangEnd, '#!/usr/bin/env node\n');
        }
        const prefix = `${missing.map((directive) => `${JSON.stringify(directive)};`).join('\n')}${missing.length ? '\n' : ''}`;
        output.appendLeft(shebangEnd, prefix);
        if (isBin && !shebangEnd) {
          output.prepend('#!/usr/bin/env node\n');
        }
        return { code: output.toString(), map: output.generateMap({ hires: true }) };
      },
    },
  ],
});

if (!options.skipTypes) {
  const tsconfig = path.join(process.cwd(), 'tsconfig.build.json');
  const matches = createFilesMatcher({ path: tsconfig, config: parseTsconfig(tsconfig) });
  const declarations = await globby('**/*.d.{ts,mts,cts}', {
    cwd: options.sourceDir,
    ignore: options.declarationIgnores,
    absolute: true,
  });
  const declarationEntries = Object.fromEntries(
    Object.entries(entries).filter(([, file]) => matches(file)),
  );
  await Promise.all(
    declarations.map(async (file) => {
      if (!matches(file)) {
        return;
      }
      const { program } = parse(await fs.readFile(file, 'utf8'), {
        lang: 'dts',
        sourceType: 'module',
      });
      if (
        !program.body.some(
          (node) => node.type.startsWith('Import') || node.type.startsWith('Export'),
        )
      ) {
        // An ambient script must stay a script. Declaration bundling adds
        // `export {}`, which would turn its module declarations into augmentations.
        const target = path.join(options.outDir, path.relative(options.sourceDir, file));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(file, target);
        return;
      }
      const stem = path
        .relative(options.sourceDir, file)
        .replace(/\.d\.[cm]?ts$/, '')
        .split(path.sep)
        .join('/');
      // A declaration alongside JavaScript is loaded by rolldown-plugin-dts.
      // Standalone declarations (including ambient modules) need their own entry.
      if (!declarationEntries[stem]) {
        declarationEntries[`${stem}.d`] = file;
      }
    }),
  );
  await build({
    config: false,
    entry: declarationEntries,
    outDir: options.outDir,
    clean: false,
    tsconfig,
    // Declaration bundling is always ESM, including declarations for CJS output.
    // Keep it separate from Babel's JavaScript transforms and module resolver.
    format: 'esm',
    unbundle: true,
    root: options.sourceDir,
    dts: {
      emitDtsOnly: true,
      generator: options.tsgo ? 'tsgo' : 'tsc',
      tsgo: options.tsgo ? { path: nativeCompiler } : undefined,
      emitJs: true,
      sourcemap: options.sourceMap,
    },
    treeshake: true,
    cjsDefault: false,
    outExtensions: () => ({ js: options.outExtension, dts: options.typeOutExtension }),
    logLevel: options.verbose ? 'info' : 'error',
    inputOptions: {
      external: (id, importer) => Boolean(importer) && !id.startsWith('.') && !path.isAbsolute(id),
    },
    plugins: [
      declarationReexports(),
      {
        name: 'mui-cjs-declaration-stubs',
        transform(code, id) {
          // The declaration plugin's ESM stub is invalid inside a .cjs input.
          return id.endsWith('.cjs') && code === 'export {}' ? '' : null;
        },
      },
    ],
  });
}
