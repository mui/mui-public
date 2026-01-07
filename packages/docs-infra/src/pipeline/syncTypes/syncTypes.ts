// Can use node: imports here since this is server-only code
import path from 'node:path';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ExportNode } from 'typescript-api-extractor';
import { parseImportsAndComments } from '../loaderUtils/parseImportsAndComments';
import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
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
import { highlightTypes } from './highlightTypes';
import type { ParsedCreateFactory } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';

/** @deprecated Use ParsedCreateFactory instead */
export type CreateFactoryCall = ParsedCreateFactory;

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

const functionName = 'Sync Types';

export interface SyncTypesOptions {
  /** Absolute path to the resource being processed */
  resourcePath: string;
  /** Name of the resource (for display purposes) */
  resourceName: string;
  /** Root context directory (workspace root) */
  rootContext: string;
  /** Relative path from rootContext to resourcePath */
  relativePath: string;
  /** Parsed createTypesMeta call information */
  typesMetaCall: ParsedCreateFactory;
  /** Options for formatting types in tables */
  formattingOptions?: FormatInlineTypeOptions;
  /**
   * Directory path for socket and lock files used for IPC between workers.
   * Useful for Windows where the default temp directory may not support Unix domain sockets.
   */
  socketDir?: string;
  /** Enable performance logging */
  performanceLogging?: boolean;
}

export interface SyncTypesResult {
  /** Highlighted variant data ready for precompute injection */
  highlightedVariantData: Record<
    string,
    { types: TypesMeta[]; typeNameMap?: Record<string, string> }
  >;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** All processed types for external use */
  allTypes: TypesMeta[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
}

/**
 * Core server-side logic for processing TypeScript types.
 *
 * This function handles:
 * - Loading TypeScript configuration
 * - Resolving library source files
 * - Finding meta files (DataAttributes, CssVars)
 * - Processing types via worker thread
 * - Formatting component and hook types
 * - Generating markdown documentation
 * - Highlighting types for HAST output
 *
 * This is separated from the webpack loader to allow reuse in other contexts.
 */
export async function syncTypes(options: SyncTypesOptions): Promise<SyncTypesResult> {
  const {
    resourcePath,
    resourceName,
    rootContext,
    relativePath,
    typesMetaCall,
    formattingOptions,
    socketDir,
  } = options;

  // Ensure rootContext always ends with / for correct URL resolution
  const rootContextDir = rootContext.endsWith('/') ? rootContext : `${rootContext}/`;

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  const config = await loadTypescriptConfig(path.join(rootContext, 'tsconfig.json'));

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
    // Ensure pathsBasePath ends with / for correct URL resolution (if defined)
    const pathsBasePath = config.options.pathsBasePath
      ? String(config.options.pathsBasePath)
      : undefined;
    const pathsBaseDir =
      pathsBasePath && (pathsBasePath.endsWith('/') ? pathsBasePath : `${pathsBasePath}/`);
    const result = await resolveLibrarySourceFiles({
      variants: typesMetaCall.variants,
      resourcePath,
      rootContextDirUrl: pathToFileURL(rootContextDir).href,
      tsconfigPaths: config.options.paths,
      pathsBaseDir,
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
  // These are file:// URLs from resolveLibrarySourceFiles
  const resolvedEntrypointUrls = Array.from(resolvedVariantMap.values());

  // Parse exports from library source files to find re-exported directories
  // This helps us discover DataAttributes/CssVars files from re-exported components
  const reExportedDirUrls = new Set<string>();

  await Promise.all(
    resolvedEntrypointUrls.map(async (entrypointUrl) => {
      try {
        // Convert file:// URL to filesystem path for Node.js fs APIs
        const fsEntrypoint = fileURLToPath(entrypointUrl);
        const sourceCode = await readFile(fsEntrypoint, 'utf-8');
        const parsed = await parseImportsAndComments(sourceCode, entrypointUrl);

        // Look for relative exports (e.g., '../menu/', './Button', etc.)
        await Promise.all(
          Object.keys(parsed.relative || {}).map(async (exportPath) => {
            if (exportPath.startsWith('..') || exportPath.startsWith('.')) {
              // Resolve to absolute filesystem path
              const absoluteFsPath = path.resolve(path.dirname(fsEntrypoint), exportPath);

              // Check if this path exists as a directory
              // If not, it might be a module reference (e.g., '../menu/backdrop/MenuBackdrop' -> MenuBackdrop.tsx)
              // In that case, we want to add the parent directory
              try {
                const stats = await stat(absoluteFsPath);
                if (stats.isDirectory()) {
                  // It's a directory, add it directly as file:// URL
                  reExportedDirUrls.add(pathToFileURL(absoluteFsPath).href);
                }
              } catch {
                // Path doesn't exist as-is. Check if it exists with common extensions
                const extensions = ['.tsx', '.ts', '.jsx', '.js'];

                for (const ext of extensions) {
                  try {
                    // eslint-disable-next-line no-await-in-loop
                    const fileStats = await stat(absoluteFsPath + ext);
                    if (fileStats.isFile()) {
                      // It's a file reference, add the parent directory as file:// URL
                      const parentDir = path.dirname(absoluteFsPath);
                      reExportedDirUrls.add(pathToFileURL(parentDir).href);
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
          `[Main] Failed to parse exports from ${entrypointUrl}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );

  // Find meta files from the library source directories and re-exported directories
  // Convert file:// URLs to filesystem paths for findMetaFiles
  const allPathsToSearch = [
    ...resolvedEntrypointUrls.map((url) => fileURLToPath(url)),
    ...Array.from(reExportedDirUrls).map((url) => fileURLToPath(url)),
  ];

  // findMetaFiles accepts filesystem paths and returns filesystem paths
  const allEntrypoints = await Promise.all(
    allPathsToSearch.map(async (fsPath) => {
      return [fsPath, ...(await findMetaFiles(fsPath))];
    }),
  ).then((pairs) => pairs.flat());

  currentMark = performanceMeasure(
    currentMark,
    { mark: 'Meta Files Resolved', measure: 'Meta Files Resolution' },
    [functionName, relativePath],
  );

  // Process types in worker thread
  // This offloads TypeScript operations to a worker while keeping the singleton cache
  const workerManager = getWorkerManager(socketDir);
  const workerStartTime = performance.now();

  const workerResult = await workerManager.processTypes({
    projectPath: config.projectPath,
    compilerOptions: config.options,
    allEntrypoints,
    globalTypes,
    resolvedVariantMap: Array.from(resolvedVariantMap.entries()),
    namedExports: typesMetaCall.namedExports as Record<string, string> | undefined,
    dependencies: config.dependencies,
    rootContextDir,
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

  // Format the raw exports from the worker into TypesMeta
  const variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }> =
    {};

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
              variantResult.typeNameMap || {},
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
      const hasDataAttributes = Object.keys(correspondingComponent.data.dataAttributes).length > 0;
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
  const markdownFilePath = resourcePath.replace(/\.tsx?$/, '.md');
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

  performanceMeasure(
    currentMark,
    {
      mark: 'highlighted and markdown generated',
      measure: 'highlighting and markdown generation',
    },
    [functionName, relativePath],
    true,
  );

  return {
    highlightedVariantData,
    allDependencies,
    allTypes,
    typeNameMap,
  };
}
