import path from 'node:path';
import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { highlightTypes } from './highlightTypes';
import {
  highlightTypesMeta,
  type EnhancedTypesMeta,
  type EnhancedComponentTypeMeta,
  type EnhancedHookTypeMeta,
  type EnhancedFunctionTypeMeta,
  type EnhancedRawTypeMeta,
  type EnhancedEnumMemberMeta,
  type EnhancedProperty,
  type EnhancedParameter,
} from './highlightTypesMeta';
import { syncTypes, type SyncTypesOptions, type TypesMeta } from '../syncTypes';
import type { ExportData } from '../../abstractCreateTypes';

export type {
  TypesMeta,
  EnhancedTypesMeta,
  EnhancedComponentTypeMeta,
  EnhancedHookTypeMeta,
  EnhancedFunctionTypeMeta,
  EnhancedRawTypeMeta,
  EnhancedEnumMemberMeta,
  EnhancedProperty,
  EnhancedParameter,
};

const functionName = 'Load Server Types';

export interface LoadServerTypesOptions extends SyncTypesOptions {}

export interface LoadServerTypesResult {
  /** Export data where each export has a main type and related additional types */
  exports: Record<string, ExportData>;
  /** Top-level non-namespaced types like InputType */
  additionalTypes: EnhancedTypesMeta[];
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** All processed types for external use (plain, not enhanced) */
  allTypes: TypesMeta[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
}

/**
 * Server-side function for loading and processing TypeScript types.
 *
 * This function:
 * 1. Calls syncTypes to process TypeScript types and generate markdown
 * 2. Applies syntax highlighting to markdown content via highlightTypes
 * 3. Highlights type fields with HAST via highlightTypesMeta
 *
 * The pipeline is:
 * - syncTypes: extracts types, formats to plain text, generates markdown
 * - highlightTypes: highlights markdown code blocks, builds highlightedExports map
 * - highlightTypesMeta: converts type text to HAST, derives shortType/detailedType
 */
export async function loadServerTypes(
  options: LoadServerTypesOptions,
): Promise<LoadServerTypesResult> {
  const { typesMarkdownPath, rootContext, formattingOptions } = options;

  // Derive relative path for logging
  const relativePath = path.relative(rootContext, typesMarkdownPath);

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  // Call syncTypes to process types and generate markdown
  const syncResult = await syncTypes(options);

  currentMark = performanceMeasure(currentMark, { mark: 'types synced', measure: 'type syncing' }, [
    functionName,
    relativePath,
  ]);

  // Apply syntax highlighting to markdown content and build highlightedExports map
  const highlightStart = performance.now();

  const highlightResult = await highlightTypes(syncResult.variantData, syncResult.externalTypes);

  const highlightEnd = performance.now();
  const highlightCompleteMark = nameMark(functionName, 'markdown highlighted', [relativePath]);
  performance.mark(highlightCompleteMark);
  performance.measure(nameMark(functionName, 'markdown highlighting', [relativePath]), {
    start: highlightStart,
    end: highlightEnd,
  });

  currentMark = nameMark(functionName, 'markdown highlighted', [relativePath]);

  // Enhance type fields with syntax-highlighted HAST
  const enhanceStart = performance.now();

  const enhancedVariantData = await highlightTypesMeta(highlightResult.variantData, {
    highlightedExports: highlightResult.highlightedExports,
    formatting: formattingOptions,
  });

  const enhanceEnd = performance.now();
  const enhanceCompleteMark = nameMark(functionName, 'types enhanced', [relativePath]);
  performance.mark(enhanceCompleteMark);
  performance.measure(nameMark(functionName, 'type enhancement', [relativePath]), {
    start: enhanceStart,
    end: enhanceEnd,
  });

  // Organize the enhanced data by export
  const { exports, additionalTypes } = organizeTypesByExport(enhancedVariantData);

  performanceMeasure(
    currentMark,
    { mark: 'complete', measure: 'total processing' },
    [functionName, relativePath],
    true,
  );

  return {
    exports,
    additionalTypes,
    allDependencies: syncResult.allDependencies,
    allTypes: syncResult.allTypes,
    typeNameMap: syncResult.typeNameMap,
  };
}

/**
 * Organizes enhanced types data by export name.
 *
 * The logic categorizes types as follows:
 * - Component/hook/function types become the main `type` in their export
 * - Types ending in .Props, .State, .DataAttributes, etc. become `additionalTypes` for their export
 * - Non-namespaced types (no dot in the name) go to top-level `additionalTypes`
 *
 * @param enhancedVariantData - The enhanced variant data from highlightTypesMeta
 * @returns Exports and additionalTypes organized by export name
 */
function organizeTypesByExport(
  enhancedVariantData: Record<
    string,
    { types: EnhancedTypesMeta[]; typeNameMap?: Record<string, string> }
  >,
): { exports: Record<string, ExportData>; additionalTypes: EnhancedTypesMeta[] } {
  // Collect all types from ALL variants and deduplicate by name
  const typesByName = new Map<string, EnhancedTypesMeta>();
  for (const variant of Object.values(enhancedVariantData)) {
    for (const typeMeta of variant.types) {
      const existing = typesByName.get(typeMeta.name);
      if (!existing) {
        typesByName.set(typeMeta.name, typeMeta);
      } else if (
        typeMeta.type === 'component' ||
        typeMeta.type === 'hook' ||
        typeMeta.type === 'function'
      ) {
        // Prefer components/hooks/functions over other types
        typesByName.set(typeMeta.name, typeMeta);
      }
    }
  }

  const allTypes = Array.from(typesByName.values());
  if (allTypes.length === 0) {
    return { exports: {}, additionalTypes: [] };
  }

  const exports: Record<string, ExportData> = {};
  const topLevelAdditionalTypes: EnhancedTypesMeta[] = [];

  // First pass: identify all main types (components, hooks, functions)
  // These are types that are NOT just type aliases for props/state/etc.
  const mainTypes = new Map<string, EnhancedTypesMeta>();

  for (const typeMeta of allTypes) {
    if (typeMeta.type === 'component' || typeMeta.type === 'hook' || typeMeta.type === 'function') {
      mainTypes.set(typeMeta.name, typeMeta);
    }
  }

  // Second pass: categorize all types
  for (const typeMeta of allTypes) {
    const name = typeMeta.name;

    // Check if this is a main type (component/hook/function)
    if (mainTypes.has(name)) {
      // Extract the export name (e.g., "Root" from "Component.Root" or just "DirectionProvider")
      const dotIndex = name.lastIndexOf('.');
      const exportName = dotIndex > 0 ? name.slice(dotIndex + 1) : name;

      if (!exports[exportName]) {
        exports[exportName] = {
          type: typeMeta,
          additionalTypes: [],
        };
      } else {
        // If export already exists (shouldn't happen normally), use this as the main type
        exports[exportName].type = typeMeta;
      }
    } else if (typeMeta.type === 'raw') {
      // This is a type alias (Props, State, ChangeEventDetails, etc.)
      // or a standalone type like InputType

      // Check if it's namespaced (has a dot)
      if (name.includes('.')) {
        // Namespaced type - find its parent export
        // e.g., "Component.Root.Props" -> parent is "Root"
        // e.g., "Root.Props" -> parent is "Root"
        const parts = name.split('.');

        // The export name is typically the second-to-last part for namespaced types
        // "Component.Root.Props" -> exportName = "Root"
        // "Root.Props" -> exportName = "Root"
        let exportName: string;
        if (parts.length >= 3) {
          // Full namespace: Component.Part.Suffix
          exportName = parts[parts.length - 2];
        } else if (parts.length === 2) {
          // Short namespace: Part.Suffix
          exportName = parts[0];
        } else {
          // Single part - shouldn't have a dot, but handle it
          exportName = parts[0];
        }

        // Find or create the export
        if (exports[exportName]) {
          exports[exportName].additionalTypes.push(typeMeta);
        } else {
          // Create a placeholder export (the main type might come later)
          exports[exportName] = {
            type: null as unknown as EnhancedTypesMeta, // Will be filled later
            additionalTypes: [typeMeta],
          };
        }
      } else {
        // Non-namespaced type - goes to top-level additionalTypes
        topLevelAdditionalTypes.push(typeMeta);
      }
    }
  }

  // Clean up any exports that don't have a main type
  // This shouldn't happen normally, but let's be safe
  for (const [exportName, exportData] of Object.entries(exports)) {
    if (!exportData.type) {
      // Move the additionalTypes to the top level and remove the export
      topLevelAdditionalTypes.push(...exportData.additionalTypes);
      delete exports[exportName];
    }
  }

  return { exports, additionalTypes: topLevelAdditionalTypes };
}
