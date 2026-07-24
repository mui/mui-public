import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toHtml } from 'hast-util-to-html';
import {
  parseSource,
  splitFocusFrame,
  splitFocusFrameRange,
} from '../../shared/syntax/parseSource';
import type { ParseSourceRoot } from '../../shared/syntax/parseSource';
import { getRelativeImports, parseDemoIndex } from '../../shared/parsers/parseDemoIndex';
import type { RelativeImport } from '../../shared/parsers/parseDemoIndex';
import type { DeferredSources, VariantCode } from '../../runtime/types';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
  performanceMeasure,
} from '../../../pipeline/loadPrecomputedCodeHighlighter/performanceLogger';

export interface LoadDemoOptions {
  assetDir?: string;
  emitDir?: string;
  urlPrefix?: string;
  emphasisOptions?: DemoEmphasisOptions;
  performance?: DemoPerformanceOptions;
}

export interface DemoEmphasisOptions {
  /** Maximum number of lines kept in the collapsed focus window. @default 10 */
  focusFramesMaxSize?: number;
}

export interface DemoPerformanceOptions {
  logging?: boolean;
  notableMs?: number;
  showWrapperMeasures?: boolean;
}

type Resolver = (context: string, request: string) => Promise<string | false>;

/** The loader context surface shared by webpack, Turbopack, and tests. */
export interface DemoLoaderContext {
  resourcePath: string;
  rootContext?: string;
  cacheable?: () => void;
  addDependency: (file: string) => void;
  emitFile?: (name: string, content: string) => void;
  mode?: string;
  _compiler?: { name?: string };
  getOptions?: () => LoadDemoOptions;
  getResolve: (options?: object) => Resolver;
  async: () => (error: Error | null, output?: string) => void;
}

interface VariantFile {
  source: ParseSourceRoot;
  language: string;
  totalLines: number;
}

interface Variant extends VariantFile {
  fileName: string;
  exportName: string;
  extraFiles?: Record<string, VariantFile>;
}

type VisibleVariant = VariantCode;

interface ResolvedRelativeImport extends RelativeImport {
  resolvedPath: string | null;
}

const EXTRA_FILE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.json']);
const MAX_DEPTH = 3;
const DEFAULT_FOCUS_FRAMES_MAX_SIZE = 10;
const SSR_VISIBLE_LINES = 12;
const JS_EXTENSIONS = /\.(tsx|ts|jsx|js)$/;
const FUNCTION_NAME = 'Lite Demo Loader';

async function resolveRelative(
  resolve: Resolver,
  fromDir: string,
  specifier: string,
): Promise<string | null> {
  try {
    const resolved = await resolve(fromDir, specifier);
    return typeof resolved === 'string' ? resolved : null;
  } catch {
    return null;
  }
}

function flattenSpecifier(specifier: string): string | null {
  const name = (specifier.split('/').pop() ?? '').replace(/^_/, '');
  if (!name || name === '.' || name === '..') {
    return null;
  }
  const flat = `./${name}`;
  return flat === specifier ? null : flat;
}

function rewriteRelativeImports(
  source: string,
  imports: Array<RelativeImport | ResolvedRelativeImport>,
  displayNames: Map<string, string>,
): string {
  let output = '';
  let last = 0;
  for (const relativeImport of imports) {
    const { specifier, start, end } = relativeImport;
    const displayName =
      'resolvedPath' in relativeImport && relativeImport.resolvedPath
        ? displayNames.get(relativeImport.resolvedPath)
        : undefined;
    const flat = displayName ? `./${displayName}` : flattenSpecifier(specifier);
    if (flat) {
      output += source.slice(last, start) + flat;
      last = end;
    }
  }
  return output + source.slice(last);
}

function toVariantFile(
  filePath: string,
  source: string,
  imports: ResolvedRelativeImport[] | undefined,
  displayNames: Map<string, string>,
  emphasisOptions: DemoEmphasisOptions,
): VariantFile {
  const fileName = path.basename(filePath);
  const displaySource = JS_EXTENSIONS.test(filePath)
    ? rewriteRelativeImports(source, imports ?? getRelativeImports(source), displayNames)
    : source;
  const highlighted = parseSource(displaySource, fileName);
  const focusRange = highlighted.data.focusRange;
  const focusFramesMaxSize = Math.max(
    1,
    emphasisOptions.focusFramesMaxSize ?? DEFAULT_FOCUS_FRAMES_MAX_SIZE,
  );
  return {
    source: focusRange
      ? splitFocusFrameRange(
          highlighted,
          focusRange.start,
          Math.min(focusRange.end, focusRange.start + focusFramesMaxSize - 1),
        )
      : splitFocusFrame(highlighted, focusFramesMaxSize),
    language: path.extname(filePath).slice(1),
    totalLines: highlighted.data.totalLines,
  };
}

/** Loads a variant entry and its supported relative import tree. */
async function loadVariant(
  entryPath: string,
  addDependency: (file: string) => void,
  resolve: Resolver,
  emphasisOptions: DemoEmphasisOptions,
  startMark: string,
  performanceContext: string[],
): Promise<Omit<Variant, 'exportName'>> {
  const entrySource = await fs.readFile(entryPath, 'utf8');
  addDependency(entryPath);
  const collectedFiles: Record<string, { filePath: string; source: string }> = {};
  const displayNames = new Map<string, string>();
  const importsByFile = new Map<string, ResolvedRelativeImport[]>();
  const visited = new Set([entryPath]);

  const collect = async (filePath: string, source: string, depth: number): Promise<void> => {
    if (depth >= MAX_DEPTH) {
      return;
    }
    const fromDir = path.dirname(filePath);
    const imports = getRelativeImports(source);
    const resolved = await Promise.all(
      imports.map(({ specifier }) => resolveRelative(resolve, fromDir, specifier)),
    );
    importsByFile.set(
      filePath,
      imports.map((relativeImport, index) => ({
        ...relativeImport,
        resolvedPath: resolved[index],
      })),
    );
    const fresh: string[] = [];
    for (const file of resolved) {
      if (!file || visited.has(file)) {
        continue;
      }
      visited.add(file);
      if (EXTRA_FILE_EXTENSIONS.has(path.extname(file))) {
        fresh.push(file);
      }
    }
    const sources = await Promise.all(fresh.map((file) => fs.readFile(file, 'utf8')));

    // Keep import order deterministic for insertion order and collision renames.
    fresh.forEach((file, index) => {
      addDependency(file);
      let displayName = path.basename(file).replace(/^_/, '');
      if (displayName === path.basename(entryPath) || displayName in collectedFiles) {
        displayName = `${path.basename(path.dirname(file))}/${displayName}`;
      }
      displayNames.set(file, displayName);
      collectedFiles[displayName] = { filePath: file, source: sources[index] };
    });
    for (let index = 0; index < fresh.length; index += 1) {
      if (JS_EXTENSIONS.test(fresh[index])) {
        // eslint-disable-next-line no-await-in-loop -- traversal order is part of the output
        await collect(fresh[index], sources[index], depth + 1);
      }
    }
  };
  await collect(entryPath, entrySource, 0);
  const sourceGraphMark = performanceMeasure(
    startMark,
    { mark: 'Source Graph Loaded', measure: 'Source Graph Loading' },
    performanceContext,
  );
  const extraFiles = Object.fromEntries(
    Object.entries(collectedFiles).map(([displayName, { filePath, source }]) => [
      displayName,
      toVariantFile(filePath, source, importsByFile.get(filePath), displayNames, emphasisOptions),
    ]),
  );

  const variant = {
    fileName: path.basename(entryPath),
    ...toVariantFile(
      entryPath,
      entrySource,
      importsByFile.get(entryPath),
      displayNames,
      emphasisOptions,
    ),
    ...(Object.keys(extraFiles).length > 0 ? { extraFiles } : {}),
  };
  performanceMeasure(
    sourceGraphMark,
    { mark: 'Syntax Highlighted', measure: 'Syntax Highlighting' },
    performanceContext,
  );
  return variant;
}

function truncateHast(root: ParseSourceRoot, maxLines: number): ParseSourceRoot {
  let lines = 0;
  const children: ParseSourceRoot['children'] = [];
  for (const frame of root.children) {
    if (lines >= maxLines) {
      break;
    }
    if (frame.type !== 'element') {
      children.push(frame);
      continue;
    }
    const frameChildren: typeof frame.children = [];
    for (const child of frame.children) {
      if (child.type === 'element') {
        if (lines >= maxLines) {
          break;
        }
        lines += 1;
      }
      frameChildren.push(child);
    }
    children.push({ ...frame, children: frameChildren });
  }
  return { ...root, children };
}

function splitDeferredSources(variants: Record<string, Variant>): {
  visible: Record<string, VisibleVariant>;
  deferred: DeferredSources | null;
} {
  const visible: Record<string, VisibleVariant> = {};
  const deferred: DeferredSources = {};
  for (const [variantName, variant] of Object.entries(variants)) {
    const { source, extraFiles, ...meta } = variant;
    const deferredEntry: DeferredSources[string] = {};
    const entry: VisibleVariant = { ...meta, html: '' };
    if (variant.totalLines <= SSR_VISIBLE_LINES) {
      entry.html = toHtml(source);
    } else {
      entry.html = toHtml(truncateHast(source, SSR_VISIBLE_LINES));
      deferredEntry.source = toHtml(source);
    }
    if (extraFiles) {
      entry.extraFiles = {};
      deferredEntry.extraFiles = {};
      for (const [fileName, file] of Object.entries(extraFiles)) {
        const { source: fileSource, ...fileMeta } = file;
        entry.extraFiles[fileName] = fileMeta;
        deferredEntry.extraFiles[fileName] = toHtml(fileSource);
      }
    }
    if (deferredEntry.source !== undefined || deferredEntry.extraFiles !== undefined) {
      deferred[variantName] = deferredEntry;
    }
    visible[variantName] = entry;
  }
  return { visible, deferred: Object.keys(deferred).length > 0 ? deferred : null };
}

/** Webpack/Turbopack loader that appends demo source precompute metadata. */
export async function loadDemo(this: DemoLoaderContext, source: string): Promise<void> {
  this.cacheable?.();
  const callback = this.async();
  const options = this.getOptions?.() ?? {};
  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);
  const performanceNotableMs = options.performance?.notableMs ?? 100;
  const performanceShowWrapperMeasures = options.performance?.showWrapperMeasures ?? false;
  let observer: PerformanceObserver | undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures, relativePath),
    );
    observer.observe({ entryTypes: ['measure'] });
  }
  const performanceContext = [FUNCTION_NAME, relativePath];
  const startMark = nameMark(FUNCTION_NAME, 'Started', [relativePath], true);
  performance.mark(startMark);
  const finish = (error: Error | null, output?: string) => {
    performanceMeasure(
      startMark,
      { mark: 'Completed', measure: 'Complete Loading' },
      performanceContext,
      true,
    );
    observer
      ?.takeRecords()
      .forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(error, output);
  };

  try {
    const parsed = parseDemoIndex(source);
    let currentMark = performanceMeasure(
      startMark,
      { mark: 'Demo Parsed', measure: 'Demo Parsing' },
      performanceContext,
    );
    if (!parsed) {
      finish(null, source);
      return;
    }

    const demoDir = path.dirname(this.resourcePath);
    const resolve = this.getResolve({});
    const entries = await Promise.all(
      Object.entries(parsed.variants).map(
        async ([variantName, { specifier, importName }]): Promise<[string, Variant]> => {
          const variantContext = [FUNCTION_NAME, variantName, relativePath];
          const variantStartMark = nameMark(
            FUNCTION_NAME,
            'Variant Started',
            [variantName, relativePath],
            true,
          );
          performance.mark(variantStartMark);
          const entryPath = await resolveRelative(resolve, demoDir, specifier);
          const pathResolvedMark = performanceMeasure(
            variantStartMark,
            { mark: 'Path Resolved', measure: 'Path Resolution' },
            variantContext,
          );
          if (!entryPath) {
            throw new Error(
              `docs-infra: demo variant "${variantName}" imports "${specifier}", ` +
                `which does not resolve to a file from ${demoDir}.`,
            );
          }
          const variant = await loadVariant(
            entryPath,
            (file) => this.addDependency(file),
            resolve,
            options.emphasisOptions ?? {},
            pathResolvedMark,
            variantContext,
          );
          performanceMeasure(
            variantStartMark,
            { mark: 'Variant Loaded', measure: 'Variant Loading' },
            variantContext,
            true,
          );
          return [variantName, { ...variant, exportName: importName }];
        },
      ),
    );
    currentMark = performanceMeasure(
      currentMark,
      { mark: 'All Variants Loaded', measure: 'Complete Variants Loading' },
      performanceContext,
      true,
    );
    const { visible, deferred } = splitDeferredSources(Object.fromEntries(entries));
    currentMark = performanceMeasure(
      currentMark,
      { mark: 'HTML Serialized', measure: 'HTML Serialization' },
      performanceContext,
    );
    let deferredUrl: string | undefined;
    if (deferred) {
      const json = JSON.stringify(deferred);
      const hash = createHash('sha256').update(json).digest('hex').slice(0, 8);
      const scope = path.basename(path.dirname(path.dirname(demoDir)));
      const fileName = `${scope}-${path.basename(demoDir)}.${hash}.json`;
      // eslint-disable-next-line no-underscore-dangle
      const compiler = this._compiler?.name;
      if (this.emitFile && compiler) {
        const isServerCompiler = compiler === 'server' || compiler === 'edge-server';
        const climb = this.mode === 'development' || compiler === 'edge-server' ? '../' : '../../';
        const {
          emitDir = `${isServerCompiler ? climb : ''}static/demo-sources`,
          urlPrefix = '/_next/static/demo-sources/',
        } = options;
        this.emitFile(path.posix.join(emitDir, fileName), json);
        deferredUrl = `${urlPrefix}${fileName}`;
      } else {
        const { assetDir = 'public/build/demo-sources', urlPrefix = '/build/demo-sources/' } =
          options;
        const outDir = path.resolve(this.rootContext || process.cwd(), assetDir);
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, fileName), json);
        deferredUrl = `${urlPrefix}${fileName}`;
      }
      currentMark = performanceMeasure(
        currentMark,
        { mark: 'Deferred Asset Emitted', measure: 'Deferred Asset Emission' },
        performanceContext,
      );
    }
    const precompute = JSON.stringify({
      variants: visible,
      ...(deferredUrl ? { deferredUrl } : {}),
    });
    performanceMeasure(
      currentMark,
      { mark: 'Precompute Serialized', measure: 'Precompute Serialization' },
      performanceContext,
    );
    finish(
      null,
      `${source}\nObject.assign(${parsed.exportName}, { __docsInfraPrecompute: ${precompute} });\n`,
    );
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
}

export default loadDemo;
