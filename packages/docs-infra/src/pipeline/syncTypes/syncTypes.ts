// Can use node: imports here since this is server-only code
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';

import { extractNameAndSlugFromUrl } from '../loaderUtils';
import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import {
  loadServerTypesMeta,
  type TypesMeta,
  type ClassTypeMeta,
  type ComponentTypeMeta,
  type HookTypeMeta,
  type FunctionTypeMeta,
  type RawTypeMeta,
  type FormattedProperty,
  type FormattedEnumMember,
  type FormattedParameter,
  type ReExportInfo,
  type FormatInlineTypeOptions,
  namespaceParts as namespacePartsOrder,
} from '../loadServerTypesMeta';
import { generateTypesMarkdown } from './generateTypesMarkdown';
import { syncPageIndex } from '../syncPageIndex';
import type { PageMetadata } from '../syncPageIndex/metadataToMarkdown';
import type { SyncPageIndexBaseOptions } from '../transformMarkdownMetadata/types';
import type { TypesSourceData } from '../loadServerTypesText';

export type { ClassTypeMeta, ComponentTypeMeta, HookTypeMeta, FunctionTypeMeta, RawTypeMeta };
export type { FormattedProperty, FormattedEnumMember, FormattedParameter, ReExportInfo };
export type { TypesMeta };

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

/**
 * Helper to process a single TypesMeta and add it to parts or exports.
 */
function processTypeMeta(
  typeMeta: TypesMeta,
  parts: NonNullable<PageMetadata['parts']>,
  pageExports: NonNullable<PageMetadata['exports']>,
): void {
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
      pageExports[componentName] = metadata;
    }
  } else if (typeMeta.type === 'hook' || typeMeta.type === 'function') {
    const name = typeMeta.name;
    const data = typeMeta.data;

    const paramsOrProps =
      'properties' in data && data.properties ? data.properties : (data.parameters ?? {});
    pageExports[name] = {
      parameters: Object.keys(paramsOrProps).sort(),
    };
  }
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
  organized: {
    exports: Record<string, { type: TypesMeta; additionalTypes: TypesMeta[] }>;
    additionalTypes: TypesMeta[];
  },
): PageMetadata | null {
  // Extract slug and title from the types file path
  // The types file is typically at /path/to/component/types.ts or types.md
  // We want the parent directory name as the slug
  const parentDir = path.dirname(typesMarkdownPath);
  const { name: title, slug } = extractNameAndSlugFromUrl(parentDir);

  // Build parts metadata for component types with dots in names (e.g., Accordion.Root)
  // Build exports metadata for other types (hooks, functions, components without dots)
  const parts: NonNullable<PageMetadata['parts']> = {};
  const pageExports: NonNullable<PageMetadata['exports']> = {};

  // Process main export types
  for (const { type: typeMeta } of Object.values(organized.exports)) {
    processTypeMeta(typeMeta, parts, pageExports);
  }

  // Process additional types (additionalTypes within exports and top-level)
  for (const { additionalTypes } of Object.values(organized.exports)) {
    for (const typeMeta of additionalTypes) {
      processTypeMeta(typeMeta, parts, pageExports);
    }
  }
  for (const typeMeta of organized.additionalTypes) {
    processTypeMeta(typeMeta, parts, pageExports);
  }

  // If no types were found, return null
  if (Object.keys(parts).length === 0 && Object.keys(pageExports).length === 0) {
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
    title,
    slug,
    path: `./${slug}/page.mdx`,
    parts: Object.keys(sortedParts).length > 0 ? sortedParts : undefined,
    exports: Object.keys(pageExports).length > 0 ? pageExports : undefined,
  };
}

/**
 * Syncs types for a component/hook/function.
 * - Loads and formats types via loadServerTypesMeta
 * - Generates markdown documentation
 * - Writes markdown to disk
 * - Updates parent index page (if configured)
 *
 * This is separated from the webpack loader to allow reuse in other contexts.
 */
export async function syncTypes(options: SyncTypesOptions): Promise<TypesSourceData> {
  const { typesMarkdownPath, rootContext, updateParentIndex } = options;

  // Derive relative path for logging
  const relativePath = path.relative(rootContext, typesMarkdownPath);

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  // Load and format types using loadServerTypesMeta
  const typesMetaResult = await loadServerTypesMeta({
    typesMarkdownPath: options.typesMarkdownPath,
    rootContext: options.rootContext,
    variants: options.variants,
    watchSourceDirectly: options.watchSourceDirectly,
    formattingOptions: options.formattingOptions,
    socketDir: options.socketDir,
    externalTypesPattern: options.externalTypesPattern,
  });

  const {
    allDependencies,
    typeNameMap,
    externalTypes,
    resourceName,
    exports: organizedExports,
    additionalTypes: organizedAdditionalTypes,
    variantTypeNames,
    variantTypeNameMaps,
  } = typesMetaResult;

  currentMark = performanceMeasure(
    currentMark,
    { mark: 'types meta loaded', measure: 'types meta loading' },
    [functionName, relativePath],
  );

  // Generate and write markdown
  const markdownStart = performance.now();

  const markdown = await generateTypesMarkdown({
    name: resourceName,
    organized: {
      exports: organizedExports,
      additionalTypes: organizedAdditionalTypes,
      variantTypeNames,
      variantTypeNameMaps,
    },
    typeNameMap,
    externalTypes,
    path: relativePath,
  });

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

  // Track allDependencies locally so we can add typesMarkdownPath in production
  const dependencies = [...allDependencies];

  if (process.env.NODE_ENV === 'production') {
    // during development, if this markdown file is included as a dependency,
    // it causes a second rebuild when this file is written
    // during production builds, we should already have the file in place
    // so this is not an issue and we should ensure changing this file triggers a rebuild
    dependencies.push(typesMarkdownPath);
  }

  const writeEnd = performance.now();
  const writeCompleteMark = nameMark(functionName, 'markdown written', [relativePath]);
  performance.mark(writeCompleteMark);
  performance.measure(nameMark(functionName, 'markdown write', [relativePath]), {
    start: writeStart,
    end: writeEnd,
  });

  currentMark = performanceMeasure(
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
    const pageMetadata = buildPageMetadataFromTypes(typesMarkdownPath, {
      exports: organizedExports,
      additionalTypes: organizedAdditionalTypes,
    });

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
    exports: organizedExports,
    additionalTypes: organizedAdditionalTypes,
    externalTypes,
    allDependencies: dependencies,
    typeNameMap: typeNameMap ?? {},
    variantTypeNames,
    variantTypeNameMaps,
    updated,
  };
}
