import { namespaceParts, typeSuffixes } from './order';

/**
 * Base type metadata interface used for organizing exports.
 * This is a minimal interface that works with both TypesMeta and EnhancedTypesMeta.
 */
export interface BaseTypeMeta {
  name: string;
  type: 'component' | 'hook' | 'function' | 'class' | 'raw';
  slug?: string;
  data: unknown;
}

/**
 * Result of organizing types by export.
 */
export interface OrganizeTypesResult<T extends BaseTypeMeta> {
  /** Export data where each export has a main type and related additional types */
  exports: Record<string, { type: T; additionalTypes: T[] }>;
  /** Top-level non-namespaced types like InputType */
  additionalTypes: T[];
  /**
   * Maps variant names to the type names that originated from that variant.
   * Used for namespace imports (e.g., `* as Types`) to filter additionalTypes
   * to only show types from that specific module.
   */
  variantTypeNames: Record<string, string[]>;
  /**
   * Maps variant names to their per-variant typeNameMaps.
   * Used for Canonical Types annotations showing which variants contain each type.
   */
  variantTypeNameMaps: Record<string, Record<string, string>>;
}

/**
 * Organizes types data by export name and computes slugs.
 *
 * The logic categorizes types as follows:
 * - Component/hook/function types become the main `type` in their export
 * - Types ending in .Props, .State, .DataAttributes, etc. become `additionalTypes` for their export
 * - Non-namespaced types (no dot in the name) go to top-level `additionalTypes`
 *
 * Each type is also assigned a `slug` for anchor linking (e.g., "trigger" or "trigger.props").
 *
 * @param variantData - The variant data containing types per variant
 * @param typeNameMap - Optional map from flat names to dotted names
 * @returns Exports and additionalTypes organized by export name
 */
export function organizeTypesByExport<T extends BaseTypeMeta>(
  variantData: Record<string, { types: T[]; typeNameMap?: Record<string, string> }>,
  typeNameMap?: Record<string, string>,
): OrganizeTypesResult<T> {
  // Build a mapping from variant name to the type names from that variant
  const variantTypeNames: Record<string, string[]> = {};
  // Build a mapping from variant name to its typeNameMap
  const variantTypeNameMaps: Record<string, Record<string, string>> = {};
  for (const [variantName, variant] of Object.entries(variantData)) {
    if (variant.typeNameMap) {
      variantTypeNameMaps[variantName] = variant.typeNameMap;
    }
    variantTypeNames[variantName] = variant.types.map((t) => t.name);
  }

  // Collect all types from ALL variants and deduplicate by name
  const typesByName = new Map<string, T>();
  for (const variant of Object.values(variantData)) {
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
    return { exports: {}, additionalTypes: [], variantTypeNames, variantTypeNameMaps };
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

  // Helper to sort additional types by suffix order (Props, State, DataAttributes, etc.)
  const sortAdditionalTypes = (types: T[]): T[] => {
    return types.slice().sort((a, b) => {
      // Extract suffix from name (last part after dot, or full name if no dot)
      const getSuffix = (name: string): string => {
        const parts = name.split('.');
        return parts[parts.length - 1];
      };

      const aSuffix = getSuffix(a.name);
      const bSuffix = getSuffix(b.name);

      const getOrderIndex = (suffix: string): number => {
        const idx = typeSuffixes.indexOf(suffix);
        return idx === -1 ? typeSuffixes.indexOf('__EVERYTHING_ELSE__') : idx;
      };

      const aIdx = getOrderIndex(aSuffix);
      const bIdx = getOrderIndex(bSuffix);

      if (aIdx !== bIdx) {
        return aIdx - bIdx;
      }

      // Fallback to alphabetical
      return a.name.localeCompare(b.name);
    });
  };

  const exports: Record<string, { type: T; additionalTypes: T[] }> = {};
  const topLevelAdditionalTypes: T[] = [];

  // First pass: identify all main types (components, hooks, functions)
  // These are types that are NOT just type aliases for props/state/etc.
  const mainTypes = new Map<string, T>();

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

  // Second pass: categorize all types
  for (const typeMeta of allTypes) {
    const name = typeMeta.name;

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
              type: null as unknown as T, // Will be filled later
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
  let filteredAdditionalTypes = typeNameMap
    ? topLevelAdditionalTypes.filter((typeMeta) => !typeNameMap[typeMeta.name])
    : topLevelAdditionalTypes;

  // Filter out non-namespaced types when a namespaced version exists.
  // e.g., if we have both "Orientation" and "Toolbar.Orientation", keep only "Toolbar.Orientation"
  // since they represent the same type and would display with the same heading.
  if (componentPrefix) {
    const namespacedSuffixes = new Set<string>();
    for (const typeMeta of filteredAdditionalTypes) {
      if (typeMeta.name.startsWith(`${componentPrefix}.`)) {
        // Extract suffix: "Toolbar.Orientation" -> "Orientation"
        namespacedSuffixes.add(typeMeta.name.slice(componentPrefix.length + 1));
      }
    }
    // Filter out non-namespaced types that have a namespaced equivalent
    filteredAdditionalTypes = filteredAdditionalTypes.filter((typeMeta) => {
      // Keep namespaced types
      if (typeMeta.name.includes('.')) {
        return true;
      }
      // Filter out if a namespaced version exists
      return !namespacedSuffixes.has(typeMeta.name);
    });
  }

  // Sort additionalTypes arrays by suffix order (Props, State, DataAttributes, etc.)
  for (const exportData of Object.values(exports)) {
    exportData.additionalTypes = sortAdditionalTypes(exportData.additionalTypes);
  }
  const sortedAdditionalTypes = sortAdditionalTypes(filteredAdditionalTypes);

  // Sort exports by namespaceParts order (Root, Provider, Trigger, etc.)
  // Only use namespaceParts ordering if we have namespaced types (e.g., Component.Root)
  // For standalone types (e.g., Button, Input), use alphabetical order
  const getPartOrderIndex = (partName: string): number => {
    const idx = namespaceParts.indexOf(partName);
    return idx === -1 ? namespaceParts.indexOf('__EVERYTHING_ELSE__') : idx;
  };

  const sortedExportNames = Object.keys(exports).sort((a, b) => {
    if (componentPrefix) {
      // Namespaced components - sort by namespaceParts order
      const aIdx = getPartOrderIndex(a);
      const bIdx = getPartOrderIndex(b);
      if (aIdx !== bIdx) {
        return aIdx - bIdx;
      }
    }
    // Fallback to alphabetical for standalone types or items not in the order list
    return a.localeCompare(b);
  });

  const sortedExports: Record<string, { type: T; additionalTypes: T[] }> = {};
  for (const exportName of sortedExportNames) {
    sortedExports[exportName] = exports[exportName];
  }

  return {
    exports: sortedExports,
    additionalTypes: sortedAdditionalTypes,
    variantTypeNames,
    variantTypeNameMaps,
  };
}
