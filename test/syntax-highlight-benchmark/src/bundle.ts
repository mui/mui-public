import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'vite';
import { packageDir } from './packageVersion';

export interface BundleSize {
  label: string;
  rawKiB: number;
  gzipKiB: number;
  brotliKiB: number;
  note?: string;
}

export interface BundleEntry {
  label: string;
  entry: string;
  /** Assets fetched at runtime rather than bundled, such as a WebAssembly binary. */
  external?: { path: string; note: string };
}

const kib = (bytes: number) => bytes / 1024;

export function sizes(label: string, contents: Buffer[], note?: string): BundleSize {
  const total = (map: (content: Buffer) => number) =>
    contents.reduce((sum, content) => sum + map(content), 0);
  return {
    label,
    rawKiB: kib(total((content) => content.length)),
    gzipKiB: kib(total((content) => gzipSync(content, { level: 9 }).length)),
    brotliKiB: kib(total((content) => brotliCompressSync(content).length)),
    note,
  };
}

type BuildOutput = Extract<Awaited<ReturnType<typeof build>>, { output: unknown }>['output'];

/** Builds `entry` for the browser and returns its chunks and assets without writing them. */
export async function buildOutput(
  entry: string,
  alias?: Array<{ find: RegExp; replacement: string }>,
): Promise<BuildOutput> {
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias },
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      lib: { entry, formats: ['es'], fileName: 'entry' },
    },
  });
  const outputs = Array.isArray(output) ? output : [output];
  return outputs.flatMap((result) => {
    if (!('output' in result)) {
      throw new Error('Unexpected watcher from vite build');
    }
    return result.output;
  }) as BuildOutput;
}

async function bundle(entry: string): Promise<Buffer[]> {
  return (await buildOutput(entry)).map((chunk) =>
    Buffer.from(chunk.type === 'chunk' ? chunk.code : chunk.source),
  );
}

export async function measureBundles(entries: BundleEntry[]): Promise<BundleSize[]> {
  const results: BundleSize[] = [];
  for (const { label, entry, external } of entries) {
    // eslint-disable-next-line no-await-in-loop -- vite builds share global state; run them one at a time
    const contents = await bundle(fileURLToPath(new URL(`./bundles/${entry}`, import.meta.url)));
    if (external) {
      contents.push(readFileSync(external.path));
    }
    results.push(sizes(label, contents, external?.note));
  }
  return results;
}

export const ONIGURUMA_WASM = {
  path: join(packageDir('vscode-oniguruma', '@wooorm/starry-night'), 'release/onig.wasm'),
  note: 'includes onig.wasm, which starry-night fetches separately at runtime',
};
