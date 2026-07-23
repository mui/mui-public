import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadDemo } from './demoLoader';
import type { DemoLoaderContext, LoadDemoOptions } from './demoLoader';

/** Writes fixture files into a fresh temp directory and returns its root. */
async function writeFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'load-demo-test-'));
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }),
  );
  return root;
}

interface LoaderRun {
  output: string;
  dependencies: string[];
}

interface LoaderVariant {
  fileName: string;
  exportName: string;
  language: string;
  totalLines: number;
  html: string;
  extraFiles?: Record<string, { language: string; totalLines: number }>;
}

interface LoaderPrecompute {
  variants: Record<string, LoaderVariant>;
  deferredUrl?: string;
}

// Emulates the bundler's resolver over the fixture filesystem.
const RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
async function resolveRequest(context: string, request: string): Promise<string> {
  const base = path.resolve(context, request);
  const candidates = await Promise.all(
    RESOLVE_SUFFIXES.map(async (suffix) => {
      const candidate = base + suffix;
      try {
        return (await fs.stat(candidate)).isFile() ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  const found = candidates.find((candidate): candidate is string => candidate !== null);
  if (!found) {
    throw new Error(`cannot resolve "${request}" from "${context}"`);
  }
  return found;
}

/** Invokes the loader with a minimal webpack-style loader context. */
async function runLoader(
  rootContext: string,
  resourcePath: string,
  options: LoadDemoOptions = {},
  emitFile?: (name: string, content: string) => void,
  compilerContext: Pick<DemoLoaderContext, 'mode' | '_compiler'> = {},
): Promise<LoaderRun> {
  const source = await fs.readFile(resourcePath, 'utf8');
  const dependencies: string[] = [];
  return new Promise((resolve, reject) => {
    const context: DemoLoaderContext = {
      resourcePath,
      rootContext,
      cacheable() {},
      addDependency(file) {
        dependencies.push(file);
      },
      emitFile,
      ...compilerContext,
      getOptions: () => options,
      getResolve: () => resolveRequest,
      async() {
        return (error, output) => {
          if (error) {
            reject(error);
          } else {
            resolve({ output: output ?? '', dependencies });
          }
        };
      },
    };
    loadDemo.call(context, source);
  });
}

/** Extracts the parsed `__docsInfraPrecompute` payload appended by the loader. */
function precomputeOf(output: string): LoaderPrecompute {
  const marker = '__docsInfraPrecompute: ';
  const start = output.lastIndexOf(marker);
  if (start === -1) {
    throw new Error('no precompute assignment found in loader output');
  }
  const end = output.lastIndexOf(' });');
  return JSON.parse(output.slice(start + marker.length, end)) as LoaderPrecompute;
}

function focusFrameLines(html: string): number {
  const focusStart = html.indexOf('data-frame-type="focus"');
  const nextFrame = html.indexOf('<span class="frame"', focusStart);
  const focusFrame = html.slice(focusStart, nextFrame === -1 ? undefined : nextFrame);
  return focusFrame.match(/class="line"/g)?.length ?? 0;
}

const BUTTON_SOURCE = [
  "import * as React from 'react';",
  '',
  'export default function Button() {',
  '  return <button type="button">Click</button>;',
  '}',
  '',
].join('\n');

const DEMO_INDEX = [
  "import { createDemo } from '../createDemo';",
  "import Button from './Button';",
  '',
  'export const ButtonDemo = createDemo(import.meta.url, Button);',
  '',
].join('\n');

describe('loadDemo', () => {
  describe('module recognition', () => {
    it('passes through modules without a createDemo call unchanged', async () => {
      const root = await writeFixture({
        'app/section/demos/basic/index.ts': [
          "import { createDemoPerformance } from '../wrappers';",
          "import Page from './page';",
          '',
          'export const Perf = createDemoPerformance(import.meta.url, Page);',
          '',
        ].join('\n'),
        'app/section/demos/basic/page.tsx': BUTTON_SOURCE,
      });
      const entry = path.join(root, 'app/section/demos/basic/index.ts');
      const { output, dependencies } = await runLoader(root, entry);
      expect(output).toBe(await fs.readFile(entry, 'utf8'));
      expect(dependencies).toEqual([]);
    });

    it('rejects when a variant import does not resolve to a file', async () => {
      const root = await writeFixture({
        'app/section/demos/broken/index.ts': [
          "import { createDemo } from '../createDemo';",
          "import Missing from './Missing';",
          '',
          'export const BrokenDemo = createDemo(import.meta.url, Missing);',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/broken/index.ts');
      await expect(runLoader(root, entry)).rejects.toThrow('Default');
    });
  });

  describe('single-component demos', () => {
    it('appends a precompute assignment for the demo export', async () => {
      const root = await writeFixture({
        'app/section/demos/basic/index.ts': DEMO_INDEX,
        'app/section/demos/basic/Button.tsx': BUTTON_SOURCE,
      });
      const entry = path.join(root, 'app/section/demos/basic/index.ts');
      const { output, dependencies } = await runLoader(root, entry);

      expect(output.startsWith(DEMO_INDEX)).toBe(true);
      expect(output).toContain('Object.assign(ButtonDemo, { __docsInfraPrecompute:');
      expect(dependencies).toContain(path.join(root, 'app/section/demos/basic/Button.tsx'));

      const precompute = precomputeOf(output);
      const variant = precompute.variants.Default;
      expect(variant.fileName).toBe('Button.tsx');
      expect(variant.exportName).toBe('default');
      expect(variant.language).toBe('tsx');
      expect(variant.totalLines).toBe(5);
      expect(variant.html).toContain('class="frame"');
      expect(variant.html).toContain('Click');
      expect(precompute.deferredUrl).toBeUndefined();
    });

    it('collects relative imports as extra files, flattening their display paths', async () => {
      const root = await writeFixture({
        'app/section/demos/extra/index.ts': DEMO_INDEX,
        'app/section/demos/extra/Button.tsx': [
          "import { helper } from './helper';",
          "import '../../shared/_theme.css';",
          '',
          'export default function Button() {',
          '  return <button type="button">{helper()}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/extra/helper.ts': "export const helper = () => 'ok';\n",
        'app/section/shared/_theme.css': '.demo { color: red; }\n',
      });
      const entry = path.join(root, 'app/section/demos/extra/index.ts');
      const { output, dependencies } = await runLoader(root, entry);

      const variant = precomputeOf(output).variants.Default;
      expect(Object.keys(variant.extraFiles ?? {})).toEqual(['helper.ts', 'theme.css']);
      expect(variant.html).toContain('./theme.css');
      expect(variant.html).not.toContain('_theme.css');
      expect(dependencies).toContain(path.join(root, 'app/section/shared/_theme.css'));
    });

    it('rewrites directory imports to the resolved index file display name', async () => {
      const root = await writeFixture({
        'app/section/demos/directory/index.ts': DEMO_INDEX,
        'app/section/demos/directory/Button.tsx': [
          "import { label } from './parts';",
          '',
          'export default function Button() {',
          '  return <button type="button">{label}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/directory/parts/index.tsx': "export const label = 'Click';\n",
      });
      const entry = path.join(root, 'app/section/demos/directory/index.ts');
      const { output } = await runLoader(root, entry);

      const variant = precomputeOf(output).variants.Default;
      expect(Object.keys(variant.extraFiles ?? {})).toEqual(['index.tsx']);
      expect(variant.html).toContain('./index.tsx');
      expect(variant.html).not.toContain('./parts');
    });

    it('keeps imported index files distinct from an index entry file', async () => {
      const root = await writeFixture({
        'app/section/demos/directory-entry/index.ts': [
          "import { createDemo } from '../createDemo';",
          "import Demo from './variant';",
          '',
          'export const DirectoryDemo = createDemo(import.meta.url, Demo);',
          '',
        ].join('\n'),
        'app/section/demos/directory-entry/variant/index.tsx': [
          "import { label } from '../parts';",
          '',
          'export default function Demo() {',
          '  return <button type="button">{label}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/directory-entry/parts/index.tsx': "export const label = 'Click';\n",
      });
      const entry = path.join(root, 'app/section/demos/directory-entry/index.ts');
      const { output } = await runLoader(root, entry);

      const variant = precomputeOf(output).variants.Default;
      expect(variant.fileName).toBe('index.tsx');
      expect(Object.keys(variant.extraFiles ?? {})).toEqual(['parts/index.tsx']);
      expect(variant.html).toContain('./parts/index.tsx');
    });

    it('renames colliding extra file names by their parent directory', async () => {
      const root = await writeFixture({
        'app/section/demos/collide/index.ts': DEMO_INDEX,
        'app/section/demos/collide/Button.tsx': [
          "import { first } from './helper';",
          "import { second } from '../../shared/helper';",
          '',
          'export default function Button() {',
          '  return <button type="button">{first()}{second()}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/collide/helper.ts': 'export const first = () => 1;\n',
        'app/section/shared/helper.ts': 'export const second = () => 2;\n',
      });
      const entry = path.join(root, 'app/section/demos/collide/index.ts');
      const { output } = await runLoader(root, entry);
      const variant = precomputeOf(output).variants.Default;
      expect(Object.keys(variant.extraFiles ?? {})).toEqual(['helper.ts', 'shared/helper.ts']);
    });

    it('rewrites colliding index imports to their final display names', async () => {
      const root = await writeFixture({
        'app/section/demos/indexes/index.ts': DEMO_INDEX,
        'app/section/demos/indexes/Button.tsx': [
          "import { first } from './first';",
          "import { second } from './second';",
          '',
          'export default function Button() {',
          '  return <button type="button">{first}{second}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/indexes/first/index.tsx': "export const first = 'First';\n",
        'app/section/demos/indexes/second/index.tsx': "export const second = 'Second';\n",
      });
      const entry = path.join(root, 'app/section/demos/indexes/index.ts');
      const { output } = await runLoader(root, entry);

      const variant = precomputeOf(output).variants.Default;
      expect(Object.keys(variant.extraFiles ?? {})).toEqual(['index.tsx', 'second/index.tsx']);
      expect(variant.html).toContain('./index.tsx');
      expect(variant.html).toContain('./second/index.tsx');
      expect(variant.html).not.toContain('./first');
    });

    it('stops collecting imports beyond the depth limit', async () => {
      const root = await writeFixture({
        'app/section/demos/deep/index.ts': DEMO_INDEX,
        'app/section/demos/deep/Button.tsx': [
          "import { a } from './a';",
          '',
          'export default function Button() {',
          '  return <button type="button">{a()}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/deep/a.ts': "import { b } from './b';\n\nexport const a = () => b();\n",
        'app/section/demos/deep/b.ts': "import { c } from './c';\n\nexport const b = () => c();\n",
        'app/section/demos/deep/c.ts': "import { d } from './d';\n\nexport const c = () => d();\n",
        'app/section/demos/deep/d.ts': 'export const d = () => 4;\n',
      });
      const entry = path.join(root, 'app/section/demos/deep/index.ts');
      const { output } = await runLoader(root, entry);
      const variant = precomputeOf(output).variants.Default;
      expect(Object.keys(variant.extraFiles ?? {})).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });
  });

  describe('single-component demos with named imports', () => {
    it('resolves a named-imported component to its module', async () => {
      const root = await writeFixture({
        'app/section/demos/named/index.ts': [
          "import { createDemo } from '../createDemo';",
          "import { Button } from './Button';",
          '',
          'export const ButtonDemo = createDemo(import.meta.url, Button);',
          '',
        ].join('\n'),
        'app/section/demos/named/Button.tsx': [
          "import * as React from 'react';",
          '',
          'export function Button() {',
          '  return <button type="button">Click</button>;',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/named/index.ts');
      const { output } = await runLoader(root, entry);
      const variant = precomputeOf(output).variants.Default;
      expect(variant.fileName).toBe('Button.tsx');
      expect(variant.exportName).toBe('Button');
      expect(variant.html).toContain('Click');
    });

    it('records the original export name of an aliased named import', async () => {
      const root = await writeFixture({
        'app/section/demos/aliased/index.ts': [
          "import { createDemo } from '../createDemo';",
          "import { Button as BaseButton } from './Button';",
          '',
          'export const ButtonDemo = createDemo(import.meta.url, BaseButton);',
          '',
        ].join('\n'),
        'app/section/demos/aliased/Button.tsx': [
          "import * as React from 'react';",
          '',
          'export function Button() {',
          '  return <button type="button">Click</button>;',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/aliased/index.ts');
      const { output } = await runLoader(root, entry);
      expect(precomputeOf(output).variants.Default.exportName).toBe('Button');
    });
  });

  describe('variant demos', () => {
    it('loads each variant of createDemoWithVariants, supporting shorthand and renamed keys', async () => {
      const root = await writeFixture({
        'app/section/demos/variants/index.ts': [
          "import { createDemoWithVariants } from '../createDemo';",
          "import Css from './css/index';",
          "import TailwindImpl from './tailwind/index';",
          '',
          'export const VariantsDemo = createDemoWithVariants(import.meta.url, {',
          '  Css,',
          '  Tailwind: TailwindImpl,',
          '});',
          '',
        ].join('\n'),
        'app/section/demos/variants/css/index.tsx': BUTTON_SOURCE,
        'app/section/demos/variants/tailwind/index.tsx': BUTTON_SOURCE,
      });
      const entry = path.join(root, 'app/section/demos/variants/index.ts');
      const { output } = await runLoader(root, entry);
      const { variants } = precomputeOf(output);
      expect(Object.keys(variants)).toEqual(['Css', 'Tailwind']);
      expect(variants.Css.fileName).toBe('index.tsx');
      expect(variants.Tailwind.html).toContain('Click');
    });
  });

  describe('focus windows', () => {
    it('focuses at most 10 lines by default', async () => {
      const root = await writeFixture({
        'app/section/demos/default-focus/index.ts': DEMO_INDEX,
        'app/section/demos/default-focus/Button.tsx': [
          'export default function Button() {',
          ...Array.from({ length: 8 }, (unused, index) => `  const value${index} = ${index};`),
          '  return null;',
          '}',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/default-focus/index.ts');
      const { output } = await runLoader(root, entry);

      expect(focusFrameLines(precomputeOf(output).variants.Default.html)).toBe(10);
    });

    it('supports a custom focusFramesMaxSize', async () => {
      const root = await writeFixture({
        'app/section/demos/custom-focus/index.ts': DEMO_INDEX,
        'app/section/demos/custom-focus/Button.tsx': [
          'export default function Button() {',
          ...Array.from({ length: 8 }, (unused, index) => `  const value${index} = ${index};`),
          '  return null;',
          '}',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/custom-focus/index.ts');
      const { output } = await runLoader(root, entry, {
        emphasisOptions: { focusFramesMaxSize: 6 },
      });

      expect(focusFrameLines(precomputeOf(output).variants.Default.html)).toBe(6);
    });

    it('splits the collapsed panel window around @focus comments', async () => {
      const root = await writeFixture({
        'app/section/demos/focused/index.ts': DEMO_INDEX,
        'app/section/demos/focused/Button.tsx': [
          "import * as React from 'react';",
          '',
          'export default function Button() {',
          '  // @focus-start',
          '  return <button type="button">Click</button>;',
          '  // @focus-end',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/focused/index.ts');
      const { output } = await runLoader(root, entry);
      const variant = precomputeOf(output).variants.Default;
      expect(variant.html).toContain('data-frame-type="focus"');
      expect(variant.html).not.toContain('@focus');
    });

    it('limits an explicit focus range to focusFramesMaxSize', async () => {
      const root = await writeFixture({
        'app/section/demos/focused-limit/index.ts': DEMO_INDEX,
        'app/section/demos/focused-limit/Button.tsx': [
          'export default function Button() {',
          '  // @focus-start',
          ...Array.from({ length: 8 }, (unused, index) => `  const value${index} = ${index};`),
          '  // @focus-end',
          '  return null;',
          '}',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/focused-limit/index.ts');
      const { output } = await runLoader(root, entry, {
        emphasisOptions: { focusFramesMaxSize: 6 },
      });

      expect(focusFrameLines(precomputeOf(output).variants.Default.html)).toBe(6);
    });
  });

  describe('deferred sources', () => {
    it('truncates long sources in the precompute and emits the full html as a JSON asset', async () => {
      const longBody = Array.from(
        { length: 20 },
        (unused, index) => `  const v${index} = ${index};`,
      );
      const root = await writeFixture({
        'app/section/demos/long/index.ts': DEMO_INDEX,
        'app/section/demos/long/Button.tsx': [
          'export default function Button() {',
          ...longBody,
          '  return null;',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/long/index.ts');
      const { output } = await runLoader(root, entry, {
        assetDir: 'assets',
        urlPrefix: '/assets/',
      });

      const precompute = precomputeOf(output);
      expect(precompute.deferredUrl).toMatch(/^\/assets\/section-long\.[0-9a-f]{8}\.json$/);
      expect(precompute.variants.Default.html).toContain('v0');
      expect(precompute.variants.Default.html).not.toContain('v19');

      const assetPath = path.join(root, 'assets', path.basename(precompute.deferredUrl ?? ''));
      const deferred = JSON.parse(await fs.readFile(assetPath, 'utf8')) as Record<
        string,
        { source?: string; extraFiles?: Record<string, string> }
      >;
      expect(deferred.Default.source).toContain('v19');
    });

    it('defers extra file sources while keeping their metadata inline', async () => {
      const root = await writeFixture({
        'app/section/demos/meta/index.ts': DEMO_INDEX,
        'app/section/demos/meta/Button.tsx': [
          "import { helper } from './helper';",
          '',
          'export default function Button() {',
          '  return <button type="button">{helper()}</button>;',
          '}',
          '',
        ].join('\n'),
        'app/section/demos/meta/helper.ts': "export const helper = () => 'ok';\n",
      });
      const entry = path.join(root, 'app/section/demos/meta/index.ts');
      const { output } = await runLoader(root, entry, {
        assetDir: 'assets',
        urlPrefix: '/assets/',
      });

      const precompute = precomputeOf(output);
      const variant = precompute.variants.Default;
      expect(variant.extraFiles?.['helper.ts'].language).toBe('ts');
      expect(variant.extraFiles?.['helper.ts']).not.toHaveProperty('html');

      const assetPath = path.join(root, 'assets', path.basename(precompute.deferredUrl ?? ''));
      const deferred = JSON.parse(await fs.readFile(assetPath, 'utf8')) as Record<
        string,
        { source?: string; extraFiles?: Record<string, string> }
      >;
      expect(deferred.Default.extraFiles?.['helper.ts']).toContain('helper');
    });

    it('emits the JSON through emitFile when the loader context provides it', async () => {
      const longBody = Array.from(
        { length: 20 },
        (unused, index) => `  const v${index} = ${index};`,
      );
      const root = await writeFixture({
        'app/section/demos/emitted/index.ts': DEMO_INDEX,
        'app/section/demos/emitted/Button.tsx': [
          'export default function Button() {',
          ...longBody,
          '  return null;',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/emitted/index.ts');
      const emitted: Array<{ name: string; content: string }> = [];
      const { output } = await runLoader(
        root,
        entry,
        {},
        (name, content) => {
          emitted.push({ name, content });
        },
        { _compiler: { name: 'client' } },
      );

      const precompute = precomputeOf(output);
      expect(precompute.deferredUrl).toMatch(
        /^\/_next\/static\/demo-sources\/section-emitted\.[0-9a-f]{8}\.json$/,
      );
      expect(emitted).toHaveLength(1);
      expect(emitted[0].name).toBe(
        `static/demo-sources/${path.basename(precompute.deferredUrl ?? '')}`,
      );
      const deferred = JSON.parse(emitted[0].content) as Record<string, { source?: string }>;
      expect(deferred.Default.source).toContain('v19');
      await expect(fs.access(path.join(root, 'public'))).rejects.toThrow();
    });

    it('honors emitDir and urlPrefix overrides when emitting', async () => {
      const longBody = Array.from(
        { length: 20 },
        (unused, index) => `  const v${index} = ${index};`,
      );
      const root = await writeFixture({
        'app/section/demos/server/index.ts': DEMO_INDEX,
        'app/section/demos/server/Button.tsx': [
          'export default function Button() {',
          ...longBody,
          '  return null;',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/server/index.ts');
      const emitted: string[] = [];
      const { output } = await runLoader(
        root,
        entry,
        { emitDir: '../static/demo-sources', urlPrefix: '/assets/' },
        (name) => {
          emitted.push(name);
        },
        { _compiler: { name: 'server' } },
      );

      const precompute = precomputeOf(output);
      expect(precompute.deferredUrl).toMatch(/^\/assets\/section-server\.[0-9a-f]{8}\.json$/);
      expect(emitted).toEqual([
        `../static/demo-sources/${path.basename(precompute.deferredUrl ?? '')}`,
      ]);
    });

    it('derives the emit dir from the compiler so assets land in <distDir>/static', async () => {
      const longBody = Array.from(
        { length: 20 },
        (unused, index) => `  const v${index} = ${index};`,
      );
      const files = {
        'app/section/demos/layered/index.ts': DEMO_INDEX,
        'app/section/demos/layered/Button.tsx': [
          'export default function Button() {',
          ...longBody,
          '  return null;',
          '}',
          '',
        ].join('\n'),
      };
      const cases = [
        { compiler: 'server', mode: 'production', expected: '../../static/demo-sources' },
        { compiler: 'server', mode: 'development', expected: '../static/demo-sources' },
        { compiler: 'edge-server', mode: 'production', expected: '../static/demo-sources' },
        { compiler: 'client', mode: 'production', expected: 'static/demo-sources' },
      ];
      for (const { compiler, mode, expected } of cases) {
        // eslint-disable-next-line no-await-in-loop -- sequential fixture reuse keeps cases readable
        const root = await writeFixture(files);
        const entry = path.join(root, 'app/section/demos/layered/index.ts');
        const emitted: string[] = [];
        // eslint-disable-next-line no-await-in-loop -- see above
        const { output } = await runLoader(root, entry, {}, (name) => emitted.push(name), {
          mode,
          _compiler: { name: compiler },
        });
        const precompute = precomputeOf(output);
        expect(precompute.deferredUrl).toMatch(
          /^\/_next\/static\/demo-sources\/section-layered\.[0-9a-f]{8}\.json$/,
        );
        expect(emitted).toEqual([`${expected}/${path.basename(precompute.deferredUrl ?? '')}`]);
      }
    });

    it('falls back to the filesystem write when emitFile lacks a compiler name', async () => {
      const longBody = Array.from(
        { length: 20 },
        (unused, index) => `  const v${index} = ${index};`,
      );
      const root = await writeFixture({
        'app/section/demos/shim/index.ts': DEMO_INDEX,
        'app/section/demos/shim/Button.tsx': [
          'export default function Button() {',
          ...longBody,
          '  return null;',
          '}',
          '',
        ].join('\n'),
      });
      const entry = path.join(root, 'app/section/demos/shim/index.ts');
      const emitted: string[] = [];
      const { output } = await runLoader(root, entry, {}, (name) => emitted.push(name));

      const precompute = precomputeOf(output);
      expect(emitted).toEqual([]);
      expect(precompute.deferredUrl).toMatch(
        /^\/build\/demo-sources\/section-shim\.[0-9a-f]{8}\.json$/,
      );
      const assetPath = path.join(
        root,
        'public/build/demo-sources',
        path.basename(precompute.deferredUrl ?? ''),
      );
      const deferred = JSON.parse(await fs.readFile(assetPath, 'utf8')) as Record<
        string,
        { source?: string }
      >;
      expect(deferred.Default.source).toContain('v19');
    });
  });
});
