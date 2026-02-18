import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { highlightTypes } from './highlightTypes';
import {
  highlightTypesMeta,
  type EnhancedTypesMeta,
  type EnhancedComponentTypeMeta,
  type EnhancedHookTypeMeta,
  type EnhancedFunctionTypeMeta,
  type EnhancedClassTypeMeta,
  type EnhancedMethod,
  type EnhancedRawTypeMeta,
  type EnhancedEnumMemberMeta,
  type EnhancedProperty,
  type EnhancedParameter,
  type EnhancedClassProperty,
} from './highlightTypesMeta';
import { syncTypes, type SyncTypesOptions, type TypesMeta } from '../syncTypes';
import { loadServerTypesText, type TypesSourceData } from '../loadServerTypesText';
import type { FormattedProperty } from '../loadServerTypesMeta';
import type { ExportData } from '../../abstractCreateTypes';

export type {
  TypesMeta,
  EnhancedTypesMeta,
  EnhancedComponentTypeMeta,
  EnhancedHookTypeMeta,
  EnhancedFunctionTypeMeta,
  EnhancedClassTypeMeta,
  EnhancedMethod,
  EnhancedRawTypeMeta,
  EnhancedEnumMemberMeta,
  EnhancedProperty,
  EnhancedParameter,
  EnhancedClassProperty,
};

const functionName = 'Load Server Types';

export interface LoadServerTypesOptions extends SyncTypesOptions {
  /**
   * When true, calls syncTypes to extract types from TypeScript source,
   * generate markdown, and write to disk before highlighting.
   *
   * When false, loads types from an existing types.md file using
   * loadServerTypesText, skipping type extraction and markdown generation.
   *
   * @default false
   */
  sync?: boolean;
}

export interface LoadServerTypesResult {
  /** Export data where each export has a main type and related additional types */
  exports: Record<string, ExportData>;
  /** Top-level non-namespaced types like InputType */
  additionalTypes: EnhancedTypesMeta[];
  /**
   * Maps variant names to the type names that originated from that variant.
   * Used for namespace imports (e.g., `* as Types`) to filter additionalTypes
   * to only show types from that specific module.
   */
  variantTypeNames: Record<string, string[]>;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
  /**
   * Map from type names to anchor hrefs for linking type references in code.
   * Keys include both dotted names ("Accordion.Trigger") and flat names ("AccordionTrigger").
   */
  anchorMap: Record<string, string>;
}

/**
 * Server-side function for loading and processing TypeScript types.
 *
 * This function:
 * 1. Either syncs types from source (sync: true) or loads from existing types.md (sync: false)
 * 2. Applies syntax highlighting to markdown content via highlightTypes
 * 3. Highlights type fields with HAST via highlightTypesMeta
 *
 * The pipeline is:
 * - sync: true: syncTypes extracts types, formats to plain text, generates markdown
 * - sync: false: loadServerTypesText reads and parses an existing types.md file
 * - highlightTypes: highlights markdown code blocks, builds highlightedExports map
 * - highlightTypesMeta: converts type text to HAST, derives shortType/detailedType
 */
export async function loadServerTypes(
  options: LoadServerTypesOptions,
): Promise<LoadServerTypesResult> {
  const { typesMarkdownPath, rootContext, formattingOptions, sync = false } = options;

  // Derive relative path for logging
  const relativePath = path.relative(rootContext, typesMarkdownPath);

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  // Either sync types from source or load from existing markdown
  const syncResult: TypesSourceData = sync
    ? await syncTypes(options)
    : await loadServerTypesText(pathToFileURL(typesMarkdownPath).href);

  currentMark = performanceMeasure(
    currentMark,
    { mark: 'types loaded', measure: sync ? 'type syncing' : 'types.md loading' },
    [functionName, relativePath],
  );

  // Compute slugs for all types
  // Determine the common component prefix from the first dotted name (e.g., "Accordion")
  let componentPrefix = '';
  for (const exportData of Object.values(syncResult.exports)) {
    if (exportData.type.name.includes('.')) {
      componentPrefix = exportData.type.name.split('.')[0];
      break;
    }
  }

  const computeSlug = (name: string): string => {
    if (name.includes('.')) {
      const parts = name.split('.');
      if (parts[0] === componentPrefix && parts.length > 1) {
        // Strip the component prefix, keep the rest
        return parts.slice(1).join('.').toLowerCase();
      }
      // No prefix match, use the full name
      return name.replace(/\./g, '.').toLowerCase();
    }
    // Non-dotted name: use as-is
    return name.toLowerCase();
  };

  // Assign slugs to all types in exports
  for (const exportData of Object.values(syncResult.exports)) {
    exportData.type.slug = computeSlug(exportData.type.name);
    for (const addType of exportData.additionalTypes) {
      addType.slug = computeSlug(addType.name);
    }
  }
  // Assign slugs to top-level additional types
  for (const addType of syncResult.additionalTypes) {
    addType.slug = computeSlug(addType.name);
  }

  // Apply syntax highlighting and enhancement to each export's types, maintaining structure
  const highlightStart = performance.now();

  // Process each export in parallel to maintain the organized structure
  const exportEntries = Object.entries(syncResult.exports);

  // Collect ALL types to build a shared rawTypeProperties map.
  // This allows the enhancement stage to convert named return type references into property tables.
  const allTypes: TypesMeta[] = [];
  for (const [, exportData] of exportEntries) {
    allTypes.push(exportData.type, ...exportData.additionalTypes);
  }
  allTypes.push(...syncResult.additionalTypes);

  const sharedRawTypeProperties: Record<string, Record<string, FormattedProperty>> = {};
  for (const typeMeta of allTypes) {
    if (typeMeta.type === 'raw' && typeMeta.data.properties) {
      sharedRawTypeProperties[typeMeta.data.name] = typeMeta.data.properties;
    }
  }

  const processedExports = await Promise.all(
    exportEntries.map(async ([exportName, exportData]) => {
      const exportTypes = [exportData.type, ...exportData.additionalTypes];
      const highlightResult = await highlightTypes(exportTypes, syncResult.externalTypes);
      const enhancedTypes = await highlightTypesMeta(highlightResult.types, {
        highlightedExports: highlightResult.highlightedExports,
        rawTypeProperties: sharedRawTypeProperties,
        formatting: formattingOptions,
      });

      // First enhanced type is the main export type, rest are additional
      const [mainType, ...additionalEnhanced] = enhancedTypes;
      return {
        exportName,
        data: {
          type: mainType,
          additionalTypes: additionalEnhanced,
        },
      };
    }),
  );

  const exports: Record<string, ExportData> = {};
  for (const { exportName, data } of processedExports) {
    exports[exportName] = data;
  }

  // Process top-level additional types
  let additionalTypes: EnhancedTypesMeta[] = [];
  if (syncResult.additionalTypes.length > 0) {
    const highlightResult = await highlightTypes(
      syncResult.additionalTypes,
      syncResult.externalTypes,
    );
    additionalTypes = await highlightTypesMeta(highlightResult.types, {
      highlightedExports: highlightResult.highlightedExports,
      rawTypeProperties: sharedRawTypeProperties,
      formatting: formattingOptions,
    });
  }

  const highlightEnd = performance.now();
  const highlightCompleteMark = nameMark(functionName, 'types highlighted and enhanced', [
    relativePath,
  ]);
  performance.mark(highlightCompleteMark);
  performance.measure(nameMark(functionName, 'highlighting and enhancement', [relativePath]), {
    start: highlightStart,
    end: highlightEnd,
  });

  currentMark = nameMark(functionName, 'types highlighted and enhanced', [relativePath]);

  // Use variantTypeNames directly from syncResult
  const { variantTypeNames } = syncResult;

  // Build anchorMap from all types (using their computed slugs)
  const anchorMap: Record<string, string> = {};

  // Add all types from exports
  for (const exportData of Object.values(exports)) {
    if (exportData.type.slug) {
      anchorMap[exportData.type.name] = `#${exportData.type.slug}`;
    }
    for (const addType of exportData.additionalTypes) {
      if (addType.slug) {
        anchorMap[addType.name] = `#${addType.slug}`;
      }
    }
  }

  // Add top-level additional types
  for (const addType of additionalTypes) {
    if (addType.slug) {
      anchorMap[addType.name] = `#${addType.slug}`;
    }
  }

  // Add flat name mappings from typeNameMap
  if (syncResult.typeNameMap) {
    for (const [flatName, dottedName] of Object.entries(syncResult.typeNameMap)) {
      const dottedAnchor = anchorMap[dottedName];
      if (dottedAnchor) {
        anchorMap[flatName] = dottedAnchor;
      }
    }
  }

  performanceMeasure(
    currentMark,
    { mark: 'complete', measure: 'total processing' },
    [functionName, relativePath],
    true,
  );

  return {
    exports,
    additionalTypes,
    variantTypeNames,
    allDependencies: syncResult.allDependencies,
    typeNameMap: syncResult.typeNameMap,
    anchorMap,
  };
}
