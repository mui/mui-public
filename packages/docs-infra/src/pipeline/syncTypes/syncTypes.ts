// Can use node: imports here since this is server-only code
import path from 'node:path';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseImportsAndComments, extractNameAndSlugFromUrl } from '../loaderUtils';
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
  FunctionTypeMeta as FunctionType,
  formatFunctionData,
  isPublicFunction,
} from './formatFunction';
import { RawTypeMeta as RawType, formatRawData, type ReExportInfo } from './formatRaw';
import {
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
  FormatInlineTypeOptions,
  buildTypeCompatibilityMap,
  collectExternalTypesFromProps,
  collectExternalTypesFromParams,
  type TypeRewriteContext,
  type ExternalTypeMeta,
} from './format';
import { generateTypesMarkdown } from './generateTypesMarkdown';
import { findMetaFiles } from './findMetaFiles';
import { getWorkerManager } from './workerManager';
import { reconstructPerformanceLogs } from './performanceTracking';
import { namespaceParts as namespacePartsOrder } from './order';
import { syncPageIndex } from '../syncPageIndex';
import type { PageMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SyncPageIndexBaseOptions } from '../transformMarkdownMetadata/types';

export type ComponentTypeMeta = ComponentType;
export type HookTypeMeta = HookType;
export type FunctionTypeMeta = FunctionType;
export type RawTypeMeta = RawType;
export type { FormattedProperty, FormattedEnumMember, FormattedParameter, ReExportInfo };

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
      type: 'function';
      name: string;
      data: FunctionTypeMeta;
    }
  | {
      type: 'raw';
      name: string;
      data: RawTypeMeta;
    };

const functionName = 'Sync Types';

export interface SyncTypesOptions {
  /** Absolute path to the types.md file to generate */
  typesMarkdownPath: string;
  /** Root context directory (workspace root) */
  rootContext: string;
  /**
   * Map of variant name to file path (relative or package path).
   * For single component: `{ Default: './Component' }`
   * For multiple: `{ CssModules: './css-modules/Component', Tailwind: './tailwind/Component' }`
   */
  variants?: Record<string, string>;
  /**
   * When true, resolves library paths to their source files for watching.
   * Useful during development to watch the original source rather than built files.
   */
  watchSourceDirectly?: boolean;
  /** Options for formatting types in tables */
  formattingOptions?: FormatInlineTypeOptions;
  /**
   * Directory path for socket and lock files used for IPC between workers.
   * Useful for Windows where the default temp directory may not support Unix domain sockets.
   */
  socketDir?: string;
  /** Enable performance logging */
  performanceLogging?: boolean;
  /**
   * Options for updating the parent index page with component metadata.
   * When provided, will call syncPageIndex to update the parent directory's page.mdx
   * with props, dataAttributes, and cssVariables extracted from the component types.
   *
   * These options are passed through to syncPageIndex.
   */
  updateParentIndex?: SyncPageIndexBaseOptions & {
    /**
     * Name of the index file to update.
     * @default 'page.mdx'
     */
    indexFileName?: string;
  };
  /**
   * Optional regex pattern string to filter which external types to include.
   * External types are named union types (like `Orientation = 'horizontal' | 'vertical'`)
   * that are referenced in props but not exported from the component's module.
   *
   * When not provided, ALL qualifying named union types (unions of literals) will be
   * collected automatically. This is the recommended behavior for most projects.
   *
   * When provided, only external types whose names match this pattern will be collected.
   *
   * @example undefined // Collect all qualifying external types (recommended)
   * @example '^(Orientation|Alignment|Side)$' // Only include specific types
   */
  externalTypesPattern?: string;
}

export interface SyncTypesResult {
  /** Variant data (not yet highlighted) */
  variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }>;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** All processed types for external use */
  allTypes: TypesMeta[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
  /** Whether the types.md file was updated (false if unchanged) */
  updated: boolean;
  /**
   * External types discovered during formatting.
   * These are types referenced in props/params that are not publicly exported,
   * but whose definitions are useful for documentation (e.g., union types).
   * Map from type name to its definition string.
   */
  externalTypes: Record<string, string>;
}

/**
 * Builds page metadata from the loaded types for the parent index.
 * Extracts props, dataAttributes, and cssVariables from component types.
 *
 * Component names with dots (e.g., "Accordion.Root") are converted to the parts format,
 * where the part after the dot becomes the part name (e.g., { parts: { Root: {...} } }).
 * This matches the serialized format "Accordion - Root" in the parent index.
 */
function buildPageMetadataFromTypes(
  typesMarkdownPath: string,
  allTypes: TypesMeta[],
): PageMetadata | null {
  // Extract slug and title from the types file path
  // The types file is typically at /path/to/component/types.ts or types.md
  // We want the parent directory name as the slug
  const parentDir = path.dirname(typesMarkdownPath);
  const { name: title, slug } = extractNameAndSlugFromUrl(parentDir);

  // Build parts metadata for component types with dots in names (e.g., Accordion.Root)
  // Build exports metadata for other types (hooks, functions, components without dots)
  const parts: NonNullable<PageMetadata['parts']> = {};
  const exports: NonNullable<PageMetadata['exports']> = {};

  for (const typeMeta of allTypes) {
    if (typeMeta.type === 'component') {
      const componentName = typeMeta.name;
      const componentData = typeMeta.data;

      const metadata = {
        props: Object.keys(componentData.props || {}).sort(),
        dataAttributes: Object.keys(componentData.dataAttributes || {}).sort(),
        cssVariables: Object.keys(componentData.cssVariables || {}).sort(),
      };

      // Check if this is a namespaced component (e.g., "Accordion.Root")
      if (componentName.includes('.')) {
        // Extract the part name (everything after the last dot)
        const partName = componentName.split('.').pop() || componentName;
        parts[partName] = metadata;
      } else {
        // Non-namespaced component goes into exports
        exports[componentName] = metadata;
      }
    } else if (typeMeta.type === 'hook' || typeMeta.type === 'function') {
      const name = typeMeta.name;
      const data = typeMeta.data;

      exports[name] = {
        parameters: Object.keys(data.parameters || {}).sort(),
      };
    }
  }

  // If no types were found, return null
  if (Object.keys(parts).length === 0 && Object.keys(exports).length === 0) {
    return null;
  }

  // Sort parts using the namespaceParts order
  const sortedParts: typeof parts = {};
  const partKeys = Object.keys(parts);
  partKeys.sort((a, b) => {
    const aIndex = namespacePartsOrder.indexOf(a);
    const bIndex = namespacePartsOrder.indexOf(b);
    const everythingElseIndex = namespacePartsOrder.indexOf('__EVERYTHING_ELSE__');

    // If both are in the order list, sort by their position
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    // If only a is in the list, it comes first (unless after __EVERYTHING_ELSE__)
    if (aIndex !== -1) {
      return aIndex < everythingElseIndex ? -1 : 1;
    }
    // If only b is in the list, it comes first (unless after __EVERYTHING_ELSE__)
    if (bIndex !== -1) {
      return bIndex < everythingElseIndex ? 1 : -1;
    }
    // Neither is in the list, sort alphabetically
    return a.localeCompare(b);
  });
  for (const key of partKeys) {
    sortedParts[key] = parts[key];
  }

  return {
    slug,
    path: `./${slug}/page.mdx`,
    title,
    ...(Object.keys(sortedParts).length > 0 ? { parts: sortedParts } : {}),
    ...(Object.keys(exports).length > 0 ? { exports } : {}),
  };
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
    typesMarkdownPath,
    rootContext,
    variants,
    watchSourceDirectly,
    formattingOptions,
    socketDir,
    updateParentIndex,
  } = options;

  // Derive relative path and resource name from inputs
  const relativePath = path.relative(rootContext, typesMarkdownPath);
  const resourceName = extractNameAndSlugFromUrl(
    new URL('.', pathToFileURL(typesMarkdownPath)).pathname,
  ).name;

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

  let resolvedVariantMap = new Map<string, string>();
  if (variants) {
    // Ensure pathsBasePath ends with / for correct URL resolution (if defined)
    const pathsBasePath = config.options.pathsBasePath
      ? String(config.options.pathsBasePath)
      : undefined;
    const pathsBaseDir =
      pathsBasePath && (pathsBasePath.endsWith('/') ? pathsBasePath : `${pathsBasePath}/`);
    const result = await resolveLibrarySourceFiles({
      variants,
      resourcePath: typesMarkdownPath,
      rootContextDirUrl: pathToFileURL(rootContextDir).href,
      tsconfigPaths: config.options.paths,
      pathsBaseDir,
      watchSourceDirectly: Boolean(watchSourceDirectly),
    });

    resolvedVariantMap = result.resolvedVariantMap;

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
                  // It's a directory, add it with trailing slash so path.dirname returns this directory
                  reExportedDirUrls.add(pathToFileURL(`${absoluteFsPath}/`).href);
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
                      // Add trailing slash so path.dirname returns this directory, not its parent
                      const parentDir = path.dirname(absoluteFsPath);
                      reExportedDirUrls.add(pathToFileURL(`${parentDir}/`).href);
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
  const entrypointFiles = resolvedEntrypointUrls.map((url) => fileURLToPath(url));
  const reExportedDirs = Array.from(reExportedDirUrls).map((url) => fileURLToPath(url));

  // findMetaFiles accepts filesystem paths and returns filesystem paths
  // We search both entrypoint files and re-exported directories for meta files,
  // but only include actual files (entrypoints + found meta files), not directories
  const metaFilesFromEntrypoints = await Promise.all(
    entrypointFiles.map((fsPath) => findMetaFiles(fsPath)),
  ).then((results) => results.flat());

  const metaFilesFromReExports = await Promise.all(
    reExportedDirs.map((fsPath) => findMetaFiles(fsPath)),
  ).then((results) => results.flat());

  // Meta files are DataAttributes/CssVars files that aren't imported but contain type info
  const metaFiles = [...metaFilesFromEntrypoints, ...metaFilesFromReExports];

  // All files needed for the TypeScript program (entrypoints + meta files)
  const allEntrypoints = [...entrypointFiles, ...metaFiles];

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
    metaFiles,
    resolvedVariantMap: Array.from(resolvedVariantMap.entries()),
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

  // Collect external types across all components/hooks/functions
  const collectedExternalTypes = new Map<string, ExternalTypeMeta>();

  // Parse external types pattern once if provided
  const externalTypesPatternRegex = options.externalTypesPattern
    ? new RegExp(options.externalTypesPattern)
    : undefined;

  // Build type compatibility map once from all exports across all variants
  // This map is used to rewrite type references (e.g., Dialog.Trigger.State -> AlertDialog.Trigger.State)
  const allRawExports = Object.values(rawVariantData).flatMap((v) => v.allTypes);
  const allExportNames = Array.from(new Set(allRawExports.map((exp) => exp.name)));
  const typeCompatibilityMap = buildTypeCompatibilityMap(allRawExports, allExportNames);

  // Build merged typeNameMap from all variants for type string rewriting
  // typeNameMap maps flat names like "AlertDialogTriggerState" to dotted names like "AlertDialog.Trigger.State"
  const mergedTypeNameMapForRewrite: Record<string, string> = {};
  for (const variant of Object.values(rawVariantData)) {
    if (variant.typeNameMap) {
      Object.assign(mergedTypeNameMapForRewrite, variant.typeNameMap);
    }
  }

  const rewriteContext: TypeRewriteContext = {
    typeCompatibilityMap,
    exportNames: allExportNames,
    typeNameMap:
      Object.keys(mergedTypeNameMapForRewrite).length > 0 ? mergedTypeNameMapForRewrite : undefined,
  };

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
              variantResult.typeNameMap || {},
              rewriteContext,
              { formatting: formattingOptions },
            );

            // Collect external types from component props
            // Always collect, but use pattern to filter if provided
            const componentExternals = collectExternalTypesFromProps(
              exportNode.type.props,
              variantResult.allTypes,
              externalTypesPatternRegex,
            );
            for (const [name, meta] of Array.from(componentExternals.entries())) {
              const existing = collectedExternalTypes.get(name);
              if (existing) {
                // Merge usedBy arrays
                for (const usedBy of meta.usedBy) {
                  if (!existing.usedBy.includes(usedBy)) {
                    existing.usedBy.push(usedBy);
                  }
                }
              } else {
                collectedExternalTypes.set(name, meta);
              }
            }

            return {
              type: 'component',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicHook(exportNode)) {
            const formattedData = await formatHookData(
              exportNode,
              variantResult.typeNameMap || {},
              rewriteContext,
              { formatting: formattingOptions },
            );

            // Collect external types from hook parameters
            // Always collect, but use pattern to filter if provided
            const signature = exportNode.type.callSignatures[0];
            if (signature?.parameters) {
              const hookExternals = collectExternalTypesFromParams(
                signature.parameters,
                variantResult.allTypes,
                externalTypesPatternRegex,
              );
              for (const [name, meta] of Array.from(hookExternals.entries())) {
                const existing = collectedExternalTypes.get(name);
                if (existing) {
                  for (const usedBy of meta.usedBy) {
                    if (!existing.usedBy.includes(usedBy)) {
                      existing.usedBy.push(usedBy);
                    }
                  }
                } else {
                  collectedExternalTypes.set(name, meta);
                }
              }
            }

            return {
              type: 'hook',
              name: exportNode.name,
              data: formattedData,
            };
          }

          if (isPublicFunction(exportNode)) {
            const formattedData = await formatFunctionData(
              exportNode,
              variantResult.typeNameMap || {},
              rewriteContext,
              { formatting: formattingOptions },
            );

            // Collect external types from function parameters
            // Always collect, but use pattern to filter if provided
            const funcSignature = exportNode.type.callSignatures[0];
            if (funcSignature?.parameters) {
              const funcExternals = collectExternalTypesFromParams(
                funcSignature.parameters,
                variantResult.allTypes,
                externalTypesPatternRegex,
              );
              for (const [name, meta] of Array.from(funcExternals.entries())) {
                const existing = collectedExternalTypes.get(name);
                if (existing) {
                  for (const usedBy of meta.usedBy) {
                    if (!existing.usedBy.includes(usedBy)) {
                      existing.usedBy.push(usedBy);
                    }
                  }
                } else {
                  collectedExternalTypes.set(name, meta);
                }
              }
            }

            return {
              type: 'function',
              name: exportNode.name,
              data: formattedData,
            };
          }

          // For all other types (type aliases, interfaces, enums), format as raw
          const formattedData = await formatRawData(
            exportNode,
            exportNode.name,
            variantResult.typeNameMap || {},
            rewriteContext,
            { formatting: formattingOptions },
          );

          return {
            type: 'raw',
            name: exportNode.name,
            data: formattedData,
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

  // Merge typeNameMaps from all variants for filtering
  // typeNameMap maps flat names like "AccordionItemChangeEventReason" to dotted names like "Accordion.Item.ChangeEventReason"
  // While variants typically have identical mappings (they parse the same source), merging ensures completeness
  const mergedTypeNameMap: Record<string, string> = {};
  for (const variant of Object.values(variantData)) {
    if (variant.typeNameMap) {
      Object.assign(mergedTypeNameMap, variant.typeNameMap);
    }
  }

  // Filter out flat-named types when a corresponding namespaced version exists
  // e.g., if we have "Accordion.Item.ChangeEventReason" (namespaced), filter out "AccordionItemChangeEventReason" (flat)
  // Build a set of all dotted names that exist in allTypes
  const existingDottedNames = new Set<string>();
  for (const typeMeta of allTypes) {
    if (typeMeta.name.includes('.')) {
      existingDottedNames.add(typeMeta.name);
    }
  }

  // Filter out flat types that have a namespaced equivalent
  allTypes = allTypes.filter((typeMeta) => {
    // Keep namespaced types
    if (typeMeta.name.includes('.')) {
      return true;
    }
    // Check if this flat type has a corresponding dotted name in typeNameMap
    const dottedName = mergedTypeNameMap[typeMeta.name];
    if (!dottedName) {
      // No mapping found, keep the type
      return true;
    }
    // Check if the full dotted name exists in our types
    // e.g., if typeNameMap says AccordionItemChangeEventReason → Accordion.Item.ChangeEventReason
    // and we have Accordion.Item.ChangeEventReason in existingDottedNames, filter out the flat version
    return !existingDottedNames.has(dottedName);
  });

  // Detect re-exports: check if type exports (like ButtonProps) are just re-exports of component props
  // For 'raw' types, update the data.reExportOf field
  allTypes = allTypes.map((typeMeta) => {
    if (typeMeta.type !== 'raw') {
      return typeMeta;
    }

    // Skip if already marked as a re-export
    if (typeMeta.data.reExportOf) {
      return typeMeta;
    }

    // Extract component name and suffix (e.g., "ButtonProps" -> component: "Button", suffix: "Props")
    // Handle both namespaced (ContextMenu.Root.Props) and non-namespaced (ButtonProps) names
    const parts = typeMeta.name.match(/^(.+)\.(Props|State|DataAttributes|CssVars)$/);
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
        // Extract the display name (last part after dot) for the link text
        const displayName = componentName.includes('.')
          ? componentName.split('.').pop()!
          : componentName;
        // Mark this as a re-export by updating the data
        return {
          type: 'raw' as const,
          name: typeMeta.name,
          data: {
            ...typeMeta.data,
            reExportOf: {
              name: displayName,
              slug: `#${displayName.toLowerCase()}`,
              suffix: 'props' as const,
            },
          },
        };
      }
    }

    // Check if DataAttributes is a re-export of the component's data attributes
    if (suffix === 'DataAttributes' && correspondingComponent.data.dataAttributes) {
      const hasDataAttributes = Object.keys(correspondingComponent.data.dataAttributes).length > 0;
      if (hasDataAttributes) {
        // Extract the display name (last part after dot) for the link text
        const displayName = componentName.includes('.')
          ? componentName.split('.').pop()!
          : componentName;
        return {
          type: 'raw' as const,
          name: typeMeta.name,
          data: {
            ...typeMeta.data,
            reExportOf: {
              name: displayName,
              slug: `#${displayName.toLowerCase()}`,
              suffix: 'data-attributes' as const,
            },
          },
        };
      }
    }

    // Check if CssVars is a re-export of the component's CSS variables
    if (suffix === 'CssVars' && correspondingComponent.data.cssVariables) {
      const hasCssVariables = Object.keys(correspondingComponent.data.cssVariables).length > 0;
      if (hasCssVariables) {
        // Extract the display name (last part after dot) for the link text
        const displayName = componentName.includes('.')
          ? componentName.split('.').pop()!
          : componentName;
        return {
          type: 'raw' as const,
          name: typeMeta.name,
          data: {
            ...typeMeta.data,
            reExportOf: {
              name: displayName,
              slug: `#${displayName.toLowerCase()}`,
              suffix: 'css-variables' as const,
            },
          },
        };
      }
    }

    return typeMeta;
  });

  // Update variantData with the modified types (with reExportOf set)
  // allTypes was modified by the re-export detection above, but variantData still references the old objects
  // Create a lookup map from the updated allTypes
  const updatedTypesByName = new Map<string, TypesMeta>();
  for (const typeMeta of allTypes) {
    updatedTypesByName.set(typeMeta.name, typeMeta);
  }
  // Update each variant's types array with the modified types
  for (const variant of Object.values(variantData)) {
    variant.types = variant.types.map((typeMeta) => {
      const updated = updatedTypesByName.get(typeMeta.name);
      return updated ?? typeMeta;
    });
  }

  // Get typeNameMap from first variant (they should all be the same)
  const typeNameMap = Object.values(variantData)[0]?.typeNameMap;

  // Convert collected external types to a simple Record<string, string>
  const externalTypes: Record<string, string> = {};
  for (const [name, meta] of Array.from(collectedExternalTypes.entries())) {
    externalTypes[name] = meta.definition;
  }

  // Generate and write markdown
  const markdownStart = performance.now();

  const markdown = await generateTypesMarkdown(resourceName, allTypes, typeNameMap, externalTypes);

  const markdownEnd = performance.now();
  const markdownCompleteMark = nameMark(functionName, 'markdown generated', [relativePath]);
  performance.mark(markdownCompleteMark);
  performance.measure(nameMark(functionName, 'markdown generation', [relativePath]), {
    start: markdownStart,
    end: markdownEnd,
  });

  // Check if markdown has changed before writing
  const writeStart = performance.now();
  let updated = false;

  const existingMarkdown = await readFile(typesMarkdownPath, 'utf-8').catch(() => null);
  if (existingMarkdown !== markdown) {
    await writeFile(typesMarkdownPath, markdown, 'utf-8');
    updated = true;
  }

  if (process.env.NODE_ENV === 'production') {
    // during development, if this markdown file is included as a dependency,
    // it causes a second rebuild when this file is written
    // during production builds, we should already have the file in place
    // so this is not an issue and we should ensure changing this file triggers a rebuild
    allDependencies.push(typesMarkdownPath);
  }

  const writeEnd = performance.now();
  const writeCompleteMark = nameMark(functionName, 'markdown written', [relativePath]);
  performance.mark(writeCompleteMark);
  performance.measure(nameMark(functionName, 'markdown write', [relativePath]), {
    start: writeStart,
    end: writeEnd,
  });

  performanceMeasure(
    currentMark,
    {
      mark: 'markdown generated',
      measure: 'markdown generation',
    },
    [functionName, relativePath],
    true,
  );

  // Update the parent index page with component metadata if configured
  if (updateParentIndex) {
    const pageMetadata = buildPageMetadataFromTypes(typesMarkdownPath, allTypes);

    if (pageMetadata) {
      // Derive the component's page.mdx path from the types.md file
      // types.md is at /path/to/components/checkbox/types.md
      // page.mdx is at /path/to/components/checkbox/page.mdx
      // syncPageIndex will update the parent index at /path/to/components/page.mdx
      const pagePath = path.join(path.dirname(typesMarkdownPath), 'page.mdx');

      await syncPageIndex({
        pagePath,
        metadata: pageMetadata,
        baseDir: updateParentIndex.baseDir,
        indexFileName: updateParentIndex.indexFileName,
        markerDir: updateParentIndex.markerDir,
        onlyUpdateIndexes: updateParentIndex.onlyUpdateIndexes ?? false,
        errorIfOutOfDate: updateParentIndex.errorIfOutOfDate,
        // Auto-generated title/slug from types should not override user-set values
        preserveExistingTitleAndSlug: true,
      });

      performanceMeasure(
        currentMark,
        { mark: 'parent index updated', measure: 'parent index update' },
        [functionName, relativePath],
      );
    }
  }

  return {
    variantData,
    allDependencies,
    allTypes,
    typeNameMap,
    updated,
    externalTypes,
  };
}
