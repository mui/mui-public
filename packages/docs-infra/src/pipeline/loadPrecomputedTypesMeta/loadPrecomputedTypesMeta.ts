// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { writeFile, readFile, stat } from 'fs/promises';
import type { LoaderContext } from 'webpack';
import type { ExportNode } from 'typescript-api-extractor';
import { extractNameAndSlugFromUrl } from '../loaderUtils';
import { parseImportsAndComments } from '../loaderUtils/parseImportsAndComments';
import { fileUrlToPortablePath, portablePathToFileUrl } from '../loaderUtils/fileUrlToPortablePath';
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
import {
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
  FormatInlineTypeOptions,
} from './format';
import { generateTypesMarkdown } from './generateTypesMarkdown';
import { findMetaFiles } from './findMetaFiles';
import { getWorkerManager } from './workerManager';
import { reconstructPerformanceLogs } from './performanceTracking';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { ensureStarryNightInitialized } from '../transformHtmlCodeInlineHighlighted';
import { highlightTypes } from './highlightTypes';
import { TypesTableMeta } from '../../abstractCreateTypes';

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
    significantDependencyCountThreshold?: number;
  };
  /** Options for formatting types in tables */
  formatting?: FormatInlineTypeOptions;
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
    new URL('.', portablePathToFileUrl(this.resourcePath)).pathname,
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
        watchSourceDirectly: Boolean(typesMetaCall.structuredOptions?.watchSourceDirectly),
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
      fileUrlToPortablePath(url),
    );

    // Parse exports from library source files to find re-exported directories
    // This helps us discover DataAttributes/CssVars files from re-exported components
    const reExportedDirs = new Set<string>();

    await Promise.all(
      resolvedEntrypoints.map(async (entrypoint) => {
        try {
          const sourceCode = await readFile(entrypoint, 'utf-8');
          const parsed = await parseImportsAndComments(sourceCode, entrypoint);

          // Look for relative exports (e.g., '../menu/', './Button', etc.)
          await Promise.all(
            Object.keys(parsed.relative || {}).map(async (exportPath) => {
              if (exportPath.startsWith('..') || exportPath.startsWith('.')) {
                // Resolve to absolute path first
                const absolutePath = path.resolve(path.dirname(entrypoint), exportPath);

                // Check if this path exists as a directory
                // If not, it might be a module reference (e.g., '../menu/backdrop/MenuBackdrop' -> MenuBackdrop.tsx)
                // In that case, we want to add the parent directory
                try {
                  const stats = await stat(absolutePath);
                  if (stats.isDirectory()) {
                    // It's a directory, add it directly
                    reExportedDirs.add(absolutePath);
                  }
                } catch {
                  // Path doesn't exist as-is. Check if it exists with common extensions
                  const extensions = ['.tsx', '.ts', '.jsx', '.js'];

                  for (const ext of extensions) {
                    try {
                      // eslint-disable-next-line no-await-in-loop
                      const fileStats = await stat(absolutePath + ext);
                      if (fileStats.isFile()) {
                        // It's a file reference, add the parent directory
                        const parentDir = path.dirname(absolutePath);
                        reExportedDirs.add(parentDir);
                        break;
                      }
                    } catch {
                      // Continue checking other extensions
                    }
                  }

                  // If not found as file or directory, it might be a bare module reference - skip it
                }
              }
            }),
          );
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

    // Collect ALL dotted export names from ALL variants to use for filtering
    // This ensures we can filter out less-namespaced duplicates across variants
    const allDottedExportNames = Object.values(rawVariantData)
      .flatMap((v) => v.exports.filter((exp) => exp.name.includes('.')).map((exp) => exp.name))
      // Deduplicate
      .filter((name, index, arr) => arr.indexOf(name) === index);

    // Pre-filter exports for ALL variants to build a global typeNameMap
    // This ensures cross-variant type references work correctly
    const allFilteredExports = Object.values(rawVariantData).flatMap((variantResult) =>
      variantResult.exports.filter((exp) => {
        const lastDotIndex = exp.name.lastIndexOf('.');
        if (lastDotIndex === -1) {
          for (const dottedName of allDottedExportNames) {
            const flatEquivalent = dottedName.replace(/\./g, '');
            if (flatEquivalent === exp.name) {
              return false;
            }
          }
          return true;
        }
        const expFlat = exp.name.replace(/\./g, '');
        for (const dottedName of allDottedExportNames) {
          if (dottedName === exp.name) {
            continue;
          }
          const dottedFlat = dottedName.replace(/\./g, '');
          if (dottedFlat === expFlat && dottedName.split('.').length > exp.name.split('.').length) {
            return false;
          }
        }
        return true;
      }),
    );

    // Build GLOBAL typeNameMap from ALL filtered exports
    // This ensures type references across variants work correctly
    const globalTypeNameMap: Record<string, string> = {};
    for (const exp of allFilteredExports) {
      if (exp.name.includes('.')) {
        const flatName = exp.name.replace(/\./g, '');
        const existing = globalTypeNameMap[flatName];
        if (!existing || exp.name.split('.').length > existing.split('.').length) {
          globalTypeNameMap[flatName] = exp.name;
        }
      }
    }

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

    // Prepare formatting options from loader config
    const formattingOptions = options.formatting;

    // Process all variants in parallel
    await Promise.all(
      Object.entries(rawVariantData).map(async ([variantName, variantResult]) => {
        // Filter out exports that have a "better" (more namespaced) equivalent
        // e.g., if we have "Component.Root.Props", filter out "ComponentRoot.Props"
        // because the latter is a less namespaced version of the same export
        // NOTE: We use allDottedExportNames from ALL variants, not just this one

        const filteredExports = variantResult.exports.filter((exp) => {
          // For each export, check if there's a "better" version (more dots / deeper namespace)
          // e.g., for "ComponentRoot.Props", check if "Component.Root.Props" exists
          // by checking if any dotted export ends with the same suffix but has more namespaces

          // Get the suffix after the last dot (e.g., "Props" from "ComponentRoot.Props")
          const lastDotIndex = exp.name.lastIndexOf('.');
          if (lastDotIndex === -1) {
            // No dots - this is a root-level export like "ComponentRoot"
            // Check if there's a namespaced version like "Component.Root"
            for (const dottedName of allDottedExportNames) {
              const flatEquivalent = dottedName.replace(/\./g, '');
              if (flatEquivalent === exp.name) {
                // Found a better version
                return false;
              }
            }
            return true;
          }

          // Has dots - check if there's a more deeply nested version
          // e.g., for "ComponentRoot.Props", check if "Component.Root.Props" exists
          const expFlat = exp.name.replace(/\./g, '');
          for (const dottedName of allDottedExportNames) {
            // Skip self
            if (dottedName === exp.name) {
              continue;
            }

            // Check if this dotted export is a better version of our export
            const dottedFlat = dottedName.replace(/\./g, '');
            if (
              dottedFlat === expFlat &&
              dottedName.split('.').length > exp.name.split('.').length
            ) {
              // Found a better (more deeply nested) version
              return false;
            }
          }
          return true;
        });

        // Process all exports in parallel within each variant
        // Use the global typeNameMap for cross-variant type references
        const types = await Promise.all(
          filteredExports.map(async (exportNode): Promise<TypesMeta> => {
            if (isPublicComponent(exportNode)) {
              const formattedData = await formatComponentData(
                exportNode,
                variantResult.allTypes,
                variantResult.namespaces,
                globalTypeNameMap,
                { formatting: formattingOptions },
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
                globalTypeNameMap,
                { formatting: formattingOptions },
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

        // Transform flat type names to dotted versions using exact matching only
        // e.g., "ComponentPart" -> "Component.Part"
        const transformedTypes = types.map((typeMeta) => {
          // Exact match: flat name exists in typeNameMap
          if (globalTypeNameMap[typeMeta.name]) {
            return {
              ...typeMeta,
              name: globalTypeNameMap[typeMeta.name],
            };
          }

          return typeMeta;
        });

        variantData[variantName] = {
          types: transformedTypes,
          typeNameMap: globalTypeNameMap,
        };
      }),
    );

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'formatting complete', measure: 'type formatting' },
      [functionName, relativePath],
    );

    // Collect all types for markdown generation
    let allTypes = Object.values(variantData).flatMap((v) => v.types);

    // Deduplicate types by name - can happen when same component is exported from multiple entrypoints
    // (e.g., DirectionProvider exported from both index.ts and DirectionProvider.tsx)
    // Prefer components/hooks over other types when there are duplicates
    const typesByName = new Map<string, TypesMeta>();
    allTypes.forEach((typeMeta) => {
      const existing = typesByName.get(typeMeta.name);
      if (!existing) {
        typesByName.set(typeMeta.name, typeMeta);
      } else if (typeMeta.type === 'component' || typeMeta.type === 'hook') {
        // Prefer components/hooks over other types
        typesByName.set(typeMeta.name, typeMeta);
      }
      // else: keep existing entry (don't replace with 'other' type)
    });
    allTypes = Array.from(typesByName.values());

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

        const markdownEnd = performance.now();
        const markdownCompleteMark = nameMark(functionName, 'markdown generated', [relativePath]);
        performance.mark(markdownCompleteMark);
        performance.measure(nameMark(functionName, 'markdown generation', [relativePath]), {
          start: markdownStart,
          end: markdownEnd,
        });

        const writeStart = performance.now();
        await writeFile(markdownFilePath, markdown, 'utf-8');

        if (process.env.NODE_ENV === 'production') {
          // during development, if this markdown file is included as a dependency,
          // it causes a second rebuild when this file is written
          // during production builds, we should already have the file in place
          // so this is not an issue and we should ensure changing this file triggers a rebuild
          allDependencies.push(markdownFilePath);
        }

        const writeEnd = performance.now();
        const writeCompleteMark = nameMark(functionName, 'markdown written', [relativePath]);
        performance.mark(writeCompleteMark);
        performance.measure(nameMark(functionName, 'markdown write', [relativePath]), {
          start: writeStart,
          end: writeEnd,
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

    // Determine if the factory was written with a single component or multiple components (object form)
    // createTypes(import.meta.url, Checkbox) => 'Checkbox'
    // createTypes(import.meta.url, { Checkbox, Button }) => undefined
    const singleComponentName =
      typeof typesMetaCall.structuredVariants === 'string'
        ? typesMetaCall.structuredVariants
        : undefined;

    const precompute: TypesTableMeta['precompute'] = {
      exports: highlightedVariantData,
      singleComponentName,
    };

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, precompute, typesMetaCall);

    performanceMeasure(
      currentMark,
      { mark: 'replaced precompute', measure: 'precompute replacement' },
      [functionName, relativePath],
    );

    // Add all dependencies to webpack's watch list
    // Dependencies are already paths from TypeScript's program.getSourceFiles()
    allDependencies.forEach((dep) => {
      this.addDependency(dep);
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
