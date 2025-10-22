// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { writeFile } from 'fs/promises';
import type { LoaderContext } from 'webpack';
import type { ExportNode } from 'typescript-api-extractor';
import { extractNameAndSlugFromUrl } from '../loaderUtils';
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
        watchSourceDirectly: typesMetaCall.structuredOptions?.watchSourceDirectly,
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
    const resolvedEntrypoints = Array.from(resolvedVariantMap.values()).map((url) =>
      url.replace('file://', ''),
    );

    const allEntrypoints = await Promise.all(
      resolvedEntrypoints.map(async (entrypoint) => {
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
                variantResult.allTypes, // Use allTypes to find DataAttributes/CssVars enums
                variantResult.namespaces,
                {
                  // Only pass namespaceName if it's not the default variant name
                  // For single exports without namespace, namespaceName is 'Default' but we don't want to use it
                  namespaceName:
                    variantResult.namespaceName === 'Default'
                      ? undefined
                      : variantResult.namespaceName,
                },
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

            // For namespace members (e.g., Button.Root.Temp), resolve external type references
            let resolvedExportNode = exportNode;
            const isNamespaceMember =
              (exportNode as ExportNode & { isNamespaceMember?: boolean }).isNamespaceMember ||
              exportNode.name.includes('.');

            if (
              isNamespaceMember &&
              exportNode.type.kind === 'external' &&
              'typeName' in exportNode.type &&
              exportNode.type.typeName
            ) {
              const typeNameToFind = exportNode.type.typeName.name;
              const referencedExport = variantResult.allTypes.find(
                (exportItem) => exportItem.name === typeNameToFind,
              );
              if (referencedExport) {
                // Create a new export node with the resolved type, preserving the isPublic method
                const originalIsPublic = exportNode.isPublic.bind(exportNode);
                resolvedExportNode = Object.assign(
                  Object.create(Object.getPrototypeOf(exportNode)),
                  {
                    ...exportNode,
                    type: referencedExport.type,
                  },
                );
                // Ensure the isPublic method is preserved
                resolvedExportNode.isPublic = originalIsPublic;
              }
            }

            return {
              type: 'other',
              name: exportNode.name,
              data: resolvedExportNode,
            };
          }),
        );

        variantData[variantName] = { types };
      }),
    );

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'formatting complete', measure: 'type formatting' },
      [functionName, relativePath],
    );

    // Collect all types for markdown generation
    let allTypes = Object.values(variantData).flatMap((v) => v.types);

    // Mark namespace types that are re-exports (e.g., Component.Props re-exports component props)
    allTypes = allTypes.map((typeMeta) => {
      // Only check namespace members (contain a dot)
      if (!typeMeta.name.includes('.')) {
        return typeMeta;
      }

      // Extract component name and suffix
      const lastDotIndex = typeMeta.name.lastIndexOf('.');
      const componentName = typeMeta.name.substring(0, lastDotIndex);
      const suffix = typeMeta.name.substring(lastDotIndex + 1);

      // Only check Props and State suffixes
      if (suffix !== 'Props' && suffix !== 'State') {
        return typeMeta;
      }

      // Check if there's a component with this name that already documents these
      const correspondingComponent = allTypes.find(
        (t) => t.name === componentName && t.type === 'component',
      );

      if (!correspondingComponent || correspondingComponent.type !== 'component') {
        return typeMeta; // Keep as-is if there's no corresponding component
      }

      // Check if Props is a re-export of the component's props
      if (suffix === 'Props' && correspondingComponent.data.props) {
        const hasProps = Object.keys(correspondingComponent.data.props).length > 0;
        if (hasProps) {
          // Mark this as a re-export - preserve all properties using proper type assertion
          if (typeMeta.type === 'other') {
            return {
              type: 'other' as const,
              name: typeMeta.name,
              data: typeMeta.data,
              reExportOf: componentName,
            };
          }
        }
      }

      // Note: We don't mark State as re-export because components don't have a "state" table
      // State types are always useful to show separately

      return typeMeta;
    });

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

        const markdown = await generateTypesMarkdown(resourceName, allTypes);
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
