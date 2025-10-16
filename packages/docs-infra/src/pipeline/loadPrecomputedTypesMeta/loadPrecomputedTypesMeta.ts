// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';

import { resolve } from 'import-meta-resolve';
import type { LoaderContext } from 'webpack';
import type { ExportNode } from 'typescript-api-extractor';
import { extractNameAndSlugFromUrl } from '../loaderUtils';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
} from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { loadTypescriptConfig } from './loadTypescriptConfig';
import {
  ComponentTypeMeta as ComponentType,
  formatComponentData,
  isPublicComponent,
} from './formatComponent';
import { HookTypeMeta as HookType, formatHookData, isPublicHook } from './formatHook';
import { FormattedProperty, FormattedEnumMember, FormattedParameter } from './format';
import { generateTypesMarkdown } from './generateTypesMarkdown';
import { findMetaFiles } from './findMetaFiles';
import { getWorkerManager } from './workerManager';
import { reconstructPerformanceLogs } from './performanceTracking';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { ensureStarryNightInitialized } from '../transformHtmlCodeInlineHighlighted/transformHtmlCodeInlineHighlighted';
import { highlightTypes } from './highlightTypes.js';

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
    significantDependencyCountThreshold?: number;
  };
};

export type ComponentTypeMeta = ComponentType;
export type HookTypeMeta = HookType;
export type { FormattedProperty, FormattedEnumMember, FormattedParameter };

export type TypesMeta =
  | {
      type: 'component';
      name: string;
      data: ComponentTypeMeta;
    }
  | {
      type: 'hook';
      name: string;
      data: HookTypeMeta;
    }
  | {
      type: 'other';
      name: string;
      data: ExportNode;
    };

const functionName = 'Load Precomputed Types Meta';

/**
 * Webpack loader that processes types and precomputes meta.
 *
 * Finds createTypesMeta calls, loads and processes all component types,
 * then injects the precomputed type meta back into the source.
 *
 * Supports single component syntax: createTypesMeta(import.meta.url, Component)
 * And object syntax: createTypesMeta(import.meta.url, { Component1, Component2 })
 *
 * Automatically skips processing if skipPrecompute: true is set.
 */
export async function loadPrecomputedTypesMeta(
  this: LoaderContext<LoaderOptions>,
  source: string,
): Promise<void> {
  const callback = this.async();
  this.cacheable();

  const options = this.getOptions();
  const performanceNotableMs = options.performance?.notableMs ?? 100;
  const performanceShowWrapperMeasures = options.performance?.showWrapperMeasures ?? false;

  const resourceName = extractNameAndSlugFromUrl(
    new URL('.', `file://${this.resourcePath}`).pathname,
  ).name;

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);
  const startMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(startMark);
  let currentMark = startMark;

  try {
    // Parse the source to find a single createTypesMeta call
    const typesMetaCall = await parseCreateFactoryCall(source, this.resourcePath, {
      allowExternalVariants: true,
    });

    const parsedFactoryMark = nameMark(functionName, 'Parsed Factory', [relativePath]);
    performance.mark(parsedFactoryMark);
    performance.measure(
      nameMark(functionName, 'Factory Parsing', [relativePath]),
      currentMark,
      parsedFactoryMark,
    );
    currentMark = parsedFactoryMark;

    // If no createTypesMeta call found, return the source unchanged
    if (!typesMetaCall) {
      callback(null, source);
      return;
    }

    // If skipPrecompute is true, return the source unchanged
    if (typesMetaCall.options.skipPrecompute) {
      callback(null, source);
      return;
    }

    // Resolve tsconfig.json relative to the webpack project root (rootContext),
    // with graceful fallbacks to process.cwd().
    const tsconfigCandidates = [
      this.rootContext && path.join(this.rootContext, 'tsconfig.json'),
      path.join(process.cwd(), 'tsconfig.json'),
      // TODO: what if we need to load the tsconfig.json from an external project?
    ].filter(Boolean) as string[];

    const existsResults = await Promise.all(
      tsconfigCandidates.map(async (candidate) => {
        const exists = await fs
          .access(candidate)
          .then(() => true)
          .catch(() => false);
        return exists ? candidate : null;
      }),
    );

    const tsconfigPath = existsResults.find(Boolean);
    if (!tsconfigPath) {
      throw new Error(
        `Unable to locate tsconfig.json. Looked in: ${tsconfigCandidates.join(', ')}`,
      );
    }

    const watchSourceDirectly = Boolean(typesMetaCall.structuredOptions?.watchSourceDirectly);

    const config = await loadTypescriptConfig(tsconfigPath);

    let paths: Record<string, string[]> | undefined;
    if (watchSourceDirectly && config.options.paths) {
      const optionsPaths = config.options.paths;
      Object.keys(optionsPaths).forEach((key) => {
        const regex = `^${key.replace('**', '(.+)').replace('*', '([^/]+)')}$`;
        if (!paths) {
          paths = {};
        }
        paths[regex] = optionsPaths[key].map((p) => {
          let index = 0;
          return p.replace(/\*\*|\*/g, () => {
            index = index + 1;
            return `$${index}`;
          });
        });
      });
    }

    const tsconfigLoadedMark = nameMark(functionName, 'tsconfig.json loaded', [relativePath]);
    performance.mark(tsconfigLoadedMark);
    performance.measure(
      nameMark(functionName, 'tsconfig.json loading', [relativePath]),
      currentMark,
      tsconfigLoadedMark,
    );
    currentMark = tsconfigLoadedMark;

    // Resolve all variant entry point paths using import.meta.resolve
    let globalTypes = typesMetaCall?.structuredOptions?.globalTypes?.[0].map((s: any) =>
      s.replace(/['"]/g, ''),
    );

    let resolvedVariantMap = new Map<string, string>();
    if (typesMetaCall.variants) {
      const relativeVariants: Record<string, string> = {};
      const externalVariants: Record<string, string> = {};

      const projectRoot = this.rootContext || process.cwd();
      Object.entries(typesMetaCall.variants).forEach(([variantName, variantPath]) => {
        if (variantPath.startsWith(projectRoot)) {
          relativeVariants[variantName] = variantPath;
        } else if (paths) {
          Object.keys(paths).find((key) => {
            if (!paths) {
              return false;
            }

            const regex = new RegExp(key);
            const pathMatch = variantPath.match(regex);
            if (pathMatch && pathMatch.length > 0) {
              const replacements = paths[key];
              for (const replacement of replacements) {
                let replacedPath = replacement;
                for (let i = 1; i < pathMatch.length; i += 1) {
                  replacedPath = replacedPath.replace(`$${i}`, pathMatch[i]);
                }
                if (replacedPath.startsWith('.')) {
                  let basePath = String(config.options.pathsBasePath || projectRoot);
                  basePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
                  relativeVariants[variantName] = new URL(
                    replacedPath,
                    `file://${basePath}`,
                  ).pathname;
                } else {
                  externalVariants[variantName] = replacedPath;
                }

                return true;
              }
            }

            return false;
          });
        } else {
          externalVariants[variantName] = variantPath;
        }
      });

      resolvedVariantMap = await resolveVariantPathsWithFs(relativeVariants);

      const externalVariantPromises = Object.entries(externalVariants).map(
        async ([variantName, variantPath]) => {
          // We can use this ponyfill because it behaves strangely when using native import.meta.resolve(path, parentUrl)
          const resolvedPath = resolve(variantPath, `file://${this.resourcePath}`);

          if (!typesMetaCall.structuredOptions?.watchSourceDirectly) {
            globalTypes = []; // if we are reading d.ts files directly, we shouldn't need to add any global types
            return [variantName, resolvedPath] as const;
          }

          // Lookup the source map to find the original .ts/.tsx source file
          const resolvedSourceMap = resolvedPath.replace('file://', '').replace('.js', '.d.ts.map');
          const sourceMap = await fs.readFile(resolvedSourceMap, 'utf-8').catch(() => null);
          if (!sourceMap) {
            throw new Error(
              `Missing source map for variant "${variantName}" at ${resolvedSourceMap}.`,
            );
          }

          const parsedSourceMap = JSON.parse(sourceMap);

          if (
            !('sources' in parsedSourceMap) ||
            !Array.isArray(parsedSourceMap.sources) ||
            parsedSourceMap.sources.length === 0
          ) {
            throw new Error(
              `Invalid source map for variant "${variantName}" at ${resolvedSourceMap}. Missing "sources" field.`,
            );
          }

          const basePath = parsedSourceMap.sourceRoot
            ? new URL(parsedSourceMap.sourceRoot, resolvedPath)
            : resolvedPath;
          const sourceUrl = new URL(parsedSourceMap.sources[0], basePath).toString();

          return [variantName, sourceUrl] as const;
        },
      );

      const externalVariantResults = await Promise.all(externalVariantPromises);
      externalVariantResults.forEach((result) => {
        if (result) {
          resolvedVariantMap.set(result[0], result[1]);
        }
      });

      const pathsResolvedMark = nameMark(functionName, 'Paths Resolved', [relativePath]);
      performance.mark(pathsResolvedMark);
      performance.measure(
        nameMark(functionName, 'Path Resolution', [relativePath]),
        currentMark,
        pathsResolvedMark,
      );
      currentMark = pathsResolvedMark;
    }

    // Collect all entrypoints for optimized program creation
    const resolvedEntrypoints = Array.from(resolvedVariantMap.values()).map((url) =>
      url.replace('file://', ''),
    );

    const allEntrypoints = await Promise.all(
      resolvedEntrypoints.map(async (entrypoint) => {
        return [entrypoint, ...(await findMetaFiles(entrypoint))];
      }),
    ).then((pairs) => pairs.flat());

    const metaFilesResolvedMark = nameMark(functionName, 'Meta Files Resolved', [relativePath]);
    performance.mark(metaFilesResolvedMark);
    performance.measure(
      nameMark(functionName, 'Meta Files Resolution', [relativePath]),
      currentMark,
      metaFilesResolvedMark,
    );
    currentMark = metaFilesResolvedMark;

    // Process types in worker thread
    // This offloads TypeScript operations to a worker while keeping the singleton cache
    const workerManager = getWorkerManager();
    const workerStartTime = performance.now();

    const workerResult = await workerManager.processTypes({
      projectPath: config.projectPath,
      compilerOptions: config.options,
      allEntrypoints,
      globalTypes,
      resolvedVariantMap: Array.from(resolvedVariantMap.entries()),
      namedExports: typesMetaCall.namedExports as Record<string, string> | undefined,
      dependencies: config.dependencies,
      rootContext: this.rootContext || process.cwd(),
      relativePath,
    });

    if (!workerResult.success) {
      throw new Error(workerResult.error || 'Worker failed to process types');
    }

    // Reconstruct worker performance logs in main thread
    if (workerResult.performanceLogs) {
      reconstructPerformanceLogs(workerResult.performanceLogs, workerStartTime);
    }

    const workerProcessedMark = nameMark(functionName, 'worker processed', [relativePath], true);
    performance.mark(workerProcessedMark);
    performance.measure(
      nameMark(functionName, 'worker processing', [relativePath], true),
      currentMark,
      workerProcessedMark,
    );
    currentMark = workerProcessedMark;

    const rawVariantData = workerResult.variantData || {};
    const allDependencies = workerResult.allDependencies || [];

    // Initialize inline highlighting for type formatting
    await ensureStarryNightInitialized();

    const highlightingInitializedMark = nameMark(functionName, 'highlighting initialized', [
      relativePath,
    ]);
    performance.mark(highlightingInitializedMark);
    performance.measure(
      nameMark(functionName, 'highlighting initialization', [relativePath]),
      currentMark,
      highlightingInitializedMark,
    );
    currentMark = highlightingInitializedMark;

    // Format the raw exports from the worker into TypesMeta
    const variantData: Record<string, { types: TypesMeta[] }> = {};

    // Process all variants in parallel
    await Promise.all(
      Object.entries(rawVariantData).map(async ([variantName, variantResult]) => {
        // Process all exports in parallel within each variant
        const types = await Promise.all(
          variantResult.exports.map(async (exportNode): Promise<TypesMeta> => {
            if (isPublicComponent(exportNode)) {
              const formattedData = await formatComponentData(
                exportNode,
                variantResult.allTypes,
                variantResult.namespaces,
              );
              return {
                type: 'component',
                name: exportNode.name,
                data: formattedData,
              };
            }
            if (isPublicHook(exportNode)) {
              const formattedData = await formatHookData(exportNode, variantResult.namespaces);
              return {
                type: 'hook',
                name: exportNode.name,
                data: formattedData,
              };
            }
            return {
              type: 'other',
              name: exportNode.name,
              data: exportNode,
            };
          }),
        );

        variantData[variantName] = { types };
      }),
    );

    const formattingCompleteMark = nameMark(functionName, 'formatting complete', [relativePath]);
    performance.mark(formattingCompleteMark);
    performance.measure(
      nameMark(functionName, 'type formatting', [relativePath]),
      currentMark,
      formattingCompleteMark,
    );
    currentMark = formattingCompleteMark;

    // Collect all types for markdown generation
    const allTypes = Object.values(variantData).flatMap((v) => v.types);

    // Apply transformHtmlCodePrecomputed and generate/write markdown in parallel
    const markdownFilePath = this.resourcePath.replace(/\.tsx?$/, '.md');
    const [highlightedVariantData] = await Promise.all([
      (async () => {
        const highlightStart = performance.now();
        const result = await highlightTypes(variantData);
        const highlightEnd = performance.now();
        const highlightCompleteMark = nameMark(functionName, 'HAST transformation complete', [
          relativePath,
        ]);
        performance.mark(highlightCompleteMark);
        performance.measure(nameMark(functionName, 'HAST transformation', [relativePath]), {
          start: highlightStart,
          end: highlightEnd,
        });
        return result;
      })(),
      (async () => {
        const markdownStart = performance.now();
        const markdown = await generateTypesMarkdown(resourceName, allTypes);
        await fs.writeFile(markdownFilePath, markdown, 'utf-8');
        if (process.env.NODE_ENV === 'production') {
          // during development, if this markdown file is included as a dependency,
          // it causes a second rebuild when this file is written
          // during production builds, we should already have the file in place
          // so this is not an issue and we should ensure changing this file triggers a rebuild
          allDependencies.push(markdownFilePath);
        }
        const markdownEnd = performance.now();
        const markdownCompleteMark = nameMark(
          functionName,
          'markdown generation and write complete',
          [relativePath],
        );
        performance.mark(markdownCompleteMark);
        performance.measure(
          nameMark(functionName, 'markdown generation and write', [relativePath]),
          { start: markdownStart, end: markdownEnd },
        );
      })(),
    ]);

    const parallelCompleteMark = nameMark(
      functionName,
      'highlighted and markdown generated',
      [relativePath],
      true,
    );
    performance.mark(parallelCompleteMark);
    performance.measure(
      nameMark(functionName, 'highlighting and markdown generation', [relativePath], true),
      currentMark,
      parallelCompleteMark,
    );
    currentMark = parallelCompleteMark;

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, highlightedVariantData, typesMetaCall);

    const replacedPrecomputeMark = nameMark(functionName, 'replaced precompute', [relativePath]);
    performance.mark(replacedPrecomputeMark);
    performance.measure(
      nameMark(functionName, 'precompute replacement', [relativePath]),
      currentMark,
      replacedPrecomputeMark,
    );
    currentMark = replacedPrecomputeMark;

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Strip 'file://' prefix if present before adding to webpack's dependency tracking
      this.addDependency(dep.startsWith('file://') ? dep.slice(7) : dep);
    });

    if (options.performance?.logging) {
      if (
        options.performance?.significantDependencyCountThreshold &&
        allDependencies.length > options.performance.significantDependencyCountThreshold
      ) {
        // eslint-disable-next-line no-console
        console.log(
          `[${functionName}] ${relativePath} - added ${allDependencies.length} dependencies to watch:\n\n${allDependencies.map((dep) => `- ${path.relative(config.projectPath, dep)}`).join('\n')}\n`,
        );
      }
    }

    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures),
      );
    observer?.disconnect();
    callback(null, modifiedSource);
  } catch (error) {
    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures),
      );
    observer?.disconnect();
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}
