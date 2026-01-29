import path from 'node:path';
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

export interface LoadServerTypesOptions extends SyncTypesOptions {}

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
  /** All processed types for external use (plain, not enhanced) */
  allTypes: TypesMeta[];
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
  const { exports, additionalTypes, variantTypeNames, anchorMap } = organizeTypesByExport(
    enhancedVariantData,
    syncResult.typeNameMap,
  );

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
    allTypes: syncResult.allTypes,
    typeNameMap: syncResult.typeNameMap,
    anchorMap,
  };
}

/**
 * Organizes enhanced types data by export name and computes slugs.
 *
 * The logic categorizes types as follows:
 * - Component/hook/function types become the main `type` in their export
 * - Types ending in .Props, .State, .DataAttributes, etc. become `additionalTypes` for their export
 * - Non-namespaced types (no dot in the name) go to top-level `additionalTypes`
 *
 * Each type is also assigned a `slug` for anchor linking (e.g., "trigger" or "trigger.props").
 *
 * @param enhancedVariantData - The enhanced variant data from highlightTypesMeta
 * @returns Exports and additionalTypes organized by export name
 */
function organizeTypesByExport(
  enhancedVariantData: Record<
    string,
    { types: EnhancedTypesMeta[]; typeNameMap?: Record<string, string> }
  >,
  typeNameMap?: Record<string, string>,
): {
  exports: Record<string, ExportData>;
  additionalTypes: EnhancedTypesMeta[];
  variantTypeNames: Record<string, string[]>;
  anchorMap: Record<string, string>;
} {
  // Build a mapping from variant name to the type names from that variant
  const variantTypeNames: Record<string, string[]> = {};
  for (const [variantName, variant] of Object.entries(enhancedVariantData)) {
    variantTypeNames[variantName] = variant.types.map((t) => t.name);
  }

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
    return { exports: {}, additionalTypes: [], variantTypeNames, anchorMap: {} };
  }

  // Determine the common component prefix from the first dotted name
  // E.g., "Accordion.Trigger" -> "Accordion"
  let componentPrefix = '';
  for (const typeMeta of allTypes) {
    if (typeMeta.name.includes('.')) {
      componentPrefix = typeMeta.name.split('.')[0];
      break;
    }
  }

  // Helper to compute slug for a type name
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

  const exports: Record<string, ExportData> = {};
  const topLevelAdditionalTypes: EnhancedTypesMeta[] = [];

  // First pass: identify all main types (components, hooks, functions)
  // These are types that are NOT just type aliases for props/state/etc.
  const mainTypes = new Map<string, EnhancedTypesMeta>();

  for (const typeMeta of allTypes) {
    if (
      typeMeta.type === 'class' ||
      typeMeta.type === 'component' ||
      typeMeta.type === 'hook' ||
      typeMeta.type === 'function'
    ) {
      mainTypes.set(typeMeta.name, typeMeta);
    }
  }

  // Second pass: categorize all types and assign slugs
  for (const typeMeta of allTypes) {
    const name = typeMeta.name;
    // Assign slug to the type
    typeMeta.slug = computeSlug(name);

    // Check if this is a main type (class/component/hook/function)
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
        // e.g., "Component.Handle" -> this is a standalone export "Handle" (not an additional type)
        const parts = name.split('.');

        // Check if this is a 2-part name where the first part is the component prefix
        // AND the second part is actually a main type (component/hook/function).
        // This handles cases like "Accordion.Trigger" where Trigger is a real component.
        // But NOT cases like "Form.Props" where Props is just a type alias for the Form component.
        const potentialMainTypeName = `${componentPrefix}.${parts[1]}`;
        if (
          parts.length === 2 &&
          parts[0] === componentPrefix &&
          mainTypes.has(potentialMainTypeName)
        ) {
          const exportName = parts[1];
          // Create as a standalone export with the raw type as the main type
          if (!exports[exportName]) {
            exports[exportName] = {
              type: typeMeta,
              additionalTypes: [],
            };
          } else if (!exports[exportName].type) {
            // Fill in the placeholder if it was created earlier
            exports[exportName].type = typeMeta;
          } else {
            // Export already has a main type, add this as additional
            exports[exportName].additionalTypes.push(typeMeta);
          }
        } else {
          // The export name is typically the second-to-last part for namespaced types
          // "Component.Root.Props" -> exportName = "Root"
          // "Root.Props" -> exportName = "Root"
          let exportName: string;
          if (parts.length >= 3) {
            // Full namespace: Component.Part.Suffix
            exportName = parts[parts.length - 2];
          } else if (parts.length === 2) {
            // Short namespace: Part.Suffix (when componentPrefix doesn't match)
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

  // Filter out flat types from topLevelAdditionalTypes that have namespaced equivalents
  // e.g., if typeNameMap has "AccordionTriggerState" -> "Accordion.Trigger.State",
  // filter out AccordionTriggerState since Accordion.Trigger.State is already in exports
  const filteredAdditionalTypes = typeNameMap
    ? topLevelAdditionalTypes.filter((typeMeta) => !typeNameMap[typeMeta.name])
    : topLevelAdditionalTypes;

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
  for (const addType of topLevelAdditionalTypes) {
    if (addType.slug) {
      anchorMap[addType.name] = `#${addType.slug}`;
    }
  }

  // Add flat name mappings from typeNameMap
  if (typeNameMap) {
    for (const [flatName, dottedName] of Object.entries(typeNameMap)) {
      const dottedAnchor = anchorMap[dottedName];
      if (dottedAnchor) {
        anchorMap[flatName] = dottedAnchor;
      }
    }
  }

  return { exports, additionalTypes: filteredAdditionalTypes, variantTypeNames, anchorMap };
}
