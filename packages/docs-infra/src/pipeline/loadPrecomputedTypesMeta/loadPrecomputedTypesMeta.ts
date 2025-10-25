// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { writeFile, readFile } from 'fs/promises';
import type { LoaderContext } from 'webpack';
import type { ExportNode } from 'typescript-api-extractor';
import { extractNameAndSlugFromUrl } from '../loaderUtils';
import { parseImportsAndComments } from '../loaderUtils/parseImportsAndComments';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
  performanceMeasure,
} from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { loadTypescriptConfig } from './loadTypescriptConfig';
import { resolveLibrarySourceFiles } from './resolveLibrarySourceFiles';
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
import { ensureStarryNightInitialized } from '../transformHtmlCodeInlineHighlighted';
import { highlightTypes } from './highlightTypes';

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
      reExportOf?: string;
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

  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures, relativePath),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  try {
    // Parse the source to find a single createTypesMeta call
    const typesMetaCall = await parseCreateFactoryCall(source, this.resourcePath, {
      allowExternalVariants: true,
    });

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Parsed Factory', measure: 'Factory Parsing' },
      [functionName, relativePath],
    );

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

    const config = await loadTypescriptConfig(path.join(this.rootContext, 'tsconfig.json'));

    // If paths are configured in tsconfig or watchSourceDirectly is explicitly set, we watch source files
    const watchSourceDirectly = Boolean(
      typesMetaCall.structuredOptions?.watchSourceDirectly || config.options.paths,
    );

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'tsconfig.json loaded', measure: 'tsconfig.json loading' },
      [functionName, relativePath],
    );

    let globalTypes = typesMetaCall?.structuredOptions?.globalTypes?.[0].map((s: any) =>
      s.replace(/['"]/g, ''),
    );

    let resolvedVariantMap = new Map<string, string>();
    if (typesMetaCall.variants) {
      const result = await resolveLibrarySourceFiles({
        variants: typesMetaCall.variants,
        resourcePath: this.resourcePath,
        rootContext: this.rootContext || process.cwd(),
        tsconfigPaths: config.options.paths,
        pathsBasePath: String(config.options.pathsBasePath || ''),
        watchSourceDirectly,
      });

      resolvedVariantMap = result.resolvedVariantMap;
      globalTypes = result.globalTypes;

      currentMark = performanceMeasure(
        currentMark,
        { mark: 'Paths Resolved', measure: 'Path Resolution' },
        [functionName, relativePath],
      );
    }

    // Collect all entrypoints for optimized program creation
    // Include both the component entrypoints and their meta files (DataAttributes, CssVars)
    const resolvedEntrypoints = Array.from(resolvedVariantMap.values()).map((url) =>
      url.replace('file://', ''),
    );

    // Parse exports from library source files to find re-exported directories
    // This helps us discover DataAttributes/CssVars files from re-exported components
    const reExportedDirs = new Set<string>();

    await Promise.all(
      resolvedEntrypoints.map(async (entrypoint) => {
        try {
          const sourceCode = await readFile(entrypoint, 'utf-8');
          const parsed = await parseImportsAndComments(sourceCode, entrypoint);

          // Look for relative exports that go up directories (e.g., '../menu/')
          Object.keys(parsed.relative || {}).forEach((exportPath) => {
            if (exportPath.startsWith('..')) {
              // For '../menu/backdrop/MenuBackdrop', we want the parent 'menu' directory
              // Split the path and take segments except the last one (the file/component name)
              const segments = exportPath.split('/');
              const parentPath = segments.slice(0, -1).join('/'); // '../menu/backdrop'

              // Resolve to absolute path
              const absoluteParentPath = path.resolve(path.dirname(entrypoint), parentPath);
              reExportedDirs.add(absoluteParentPath);
            }
          });
        } catch (error) {
          // If we can't parse a file, just skip it
          console.warn(
            `[Main] Failed to parse exports from ${entrypoint}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );

    // Find meta files from the library source directories and re-exported directories
    const allDirectoriesToSearch = [
      ...resolvedEntrypoints, // Component entrypoints themselves
      ...Array.from(reExportedDirs), // Re-exported directories (e.g., ../menu/)
    ];

    const allEntrypoints = await Promise.all(
      allDirectoriesToSearch.map(async (entrypoint) => {
        return [entrypoint, ...(await findMetaFiles(entrypoint))];
      }),
    ).then((pairs) => pairs.flat());

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Meta Files Resolved', measure: 'Meta Files Resolution' },
      [functionName, relativePath],
    );

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

    // Log debug information from worker
    if (workerResult.debug) {
      console.warn(`[Main Thread] Debug info for ${relativePath}:`);
      console.warn(
        `  - Source file paths from re-exports: ${workerResult.debug.sourceFilePaths?.length || 0}`,
      );
      if (workerResult.debug.sourceFilePaths && workerResult.debug.sourceFilePaths.length > 0) {
        console.warn(`  - First 5 paths:`, workerResult.debug.sourceFilePaths.slice(0, 5));
      }
      console.warn(`  - Meta files found: ${workerResult.debug.metaFilesCount || 0}`);
      console.warn(`  - Adjacent files count: ${workerResult.debug.adjacentFilesCount || 0}`);
    }

    // Reconstruct worker performance logs in main thread
    // Note: Worker logs already include relativePath in their names,
    // so they'll be automatically filtered by the PerformanceObserver
    if (workerResult.performanceLogs) {
      reconstructPerformanceLogs(workerResult.performanceLogs, workerStartTime);
    }

    currentMark = performanceMeasure(
      currentMark,
      { prefix: 'worker', mark: 'processed', measure: 'processing' },
      [functionName, relativePath],
      true,
    );

    const rawVariantData = workerResult.variantData || {};
    const allDependencies = workerResult.allDependencies || [];

    // Initialize inline highlighting for type formatting
    await ensureStarryNightInitialized();

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'highlighting initialized', measure: 'highlighting initialization' },
      [functionName, relativePath],
    );

    // Format the raw exports from the worker into TypesMeta
    const variantData: Record<
      string,
      { types: TypesMeta[]; typeNameMap?: Record<string, string> }
    > = {};

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
                variantResult.typeNameMap || {},
              );
              return {
                type: 'component',
                name: exportNode.name,
                data: formattedData,
              };
            }

            if (isPublicHook(exportNode)) {
              const formattedData = await formatHookData(
                exportNode,
                variantResult.namespaces,
                variantResult.typeNameMap || {},
              );

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

        variantData[variantName] = { types, typeNameMap: variantResult.typeNameMap };
      }),
    );

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'formatting complete', measure: 'type formatting' },
      [functionName, relativePath],
    );

    // Collect all types for markdown generation
    let allTypes = Object.values(variantData).flatMap((v) => v.types);

    // Detect re-exports: check if type exports (like ButtonProps) are just re-exports of component props
    allTypes = allTypes.map((typeMeta) => {
      if (typeMeta.type !== 'other') {
        return typeMeta;
      }

      // Extract component name and suffix (e.g., "ButtonProps" -> component: "Button", suffix: "Props")
      // Handle both namespaced (ContextMenu.Root.Props) and non-namespaced (ButtonProps) names
      const parts = typeMeta.name.match(/^(.+)\.(Props|State|DataAttributes)$/);
      if (!parts) {
        return typeMeta;
      }

      const [, componentName, suffix] = parts;

      // Find the corresponding component by checking both the full name and just the last part
      // e.g., for "ContextMenu.Root.Props", check both "ContextMenu.Root" and "Root"
      const correspondingComponent = allTypes.find(
        (t) =>
          t.type === 'component' &&
          (t.name === componentName || t.name.endsWith(`.${componentName}`)),
      );

      if (!correspondingComponent || correspondingComponent.type !== 'component') {
        return typeMeta;
      }

      // Check if Props is a re-export of the component's props
      if (suffix === 'Props' && correspondingComponent.data.props) {
        const hasProps = Object.keys(correspondingComponent.data.props).length > 0;
        if (hasProps) {
          // Mark this as a re-export
          return {
            type: 'other' as const,
            name: typeMeta.name,
            data: typeMeta.data,
            reExportOf: componentName,
          };
        }
      }

      // Check if DataAttributes is a re-export of the component's data attributes
      if (suffix === 'DataAttributes' && correspondingComponent.data.dataAttributes) {
        const hasDataAttributes =
          Object.keys(correspondingComponent.data.dataAttributes).length > 0;
        if (hasDataAttributes) {
          return {
            type: 'other' as const,
            name: typeMeta.name,
            data: typeMeta.data,
            reExportOf: componentName,
          };
        }
      }

      return typeMeta;
    });

    // Get typeNameMap from first variant (they should all be the same)
    const typeNameMap = Object.values(variantData)[0]?.typeNameMap;

    // Apply transformHtmlCodePrecomputed and generate/write markdown in parallel
    const markdownFilePath = this.resourcePath.replace(/\.tsx?$/, '.md');
    const [highlightedVariantData] = await Promise.all([
      (async () => {
        const highlightStart = performance.now();

        const result = await highlightTypes(variantData);

        const highlightEnd = performance.now();
        const highlightCompleteMark = nameMark(functionName, 'HAST transformed', [relativePath]);
        performance.mark(highlightCompleteMark);
        performance.measure(nameMark(functionName, 'HAST transformation', [relativePath]), {
          start: highlightStart,
          end: highlightEnd,
        });

        return result;
      })(),
      (async () => {
        const markdownStart = performance.now();

        const markdown = await generateTypesMarkdown(resourceName, allTypes, typeNameMap);
        await writeFile(markdownFilePath, markdown, 'utf-8');

        if (process.env.NODE_ENV === 'production') {
          // during development, if this markdown file is included as a dependency,
          // it causes a second rebuild when this file is written
          // during production builds, we should already have the file in place
          // so this is not an issue and we should ensure changing this file triggers a rebuild
          allDependencies.push(markdownFilePath);
        }

        const markdownEnd = performance.now();
        const markdownCompleteMark = nameMark(functionName, 'markdown generated', [relativePath]);
        performance.mark(markdownCompleteMark);
        performance.measure(nameMark(functionName, 'markdown generation', [relativePath]), {
          start: markdownStart,
          end: markdownEnd,
        });
      })(),
    ]);

    currentMark = performanceMeasure(
      currentMark,
      {
        mark: 'highlighted and markdown generated',
        measure: 'highlighting and markdown generation',
      },
      [functionName, relativePath],
      true,
    );

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, highlightedVariantData, typesMetaCall);

    performanceMeasure(
      currentMark,
      { mark: 'replaced precompute', measure: 'precompute replacement' },
      [functionName, relativePath],
    );

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
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(null, modifiedSource);
  } catch (error) {
    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}
