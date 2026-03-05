import type * as tae from 'typescript-api-extractor';

// ============================================================================
// Type Rewriting Utilities
// ============================================================================

/**
 * Extracts the top-level namespace from an export name.
 * For "AlertDialog.Trigger" returns "AlertDialog".
 * For "Button" returns "Button".
 */
export function extractNamespaceGroup(exportName: string): string {
  const dotIndex = exportName.indexOf('.');
  if (dotIndex !== -1) {
    return exportName.substring(0, dotIndex);
  }
  return exportName;
}

/**
 * A map from original type names to their canonical export names.
 * For example: "DialogTrigger" -> "AlertDialog.Trigger"
 */
export type TypeCompatibilityMap = Map<string, string>;

/**
 * Builds a map from original type names to their canonical export names.
 *
 * This map is built from two sources:
 * 1. `reexportedFrom` - when an export is re-exported with a different name
 *    e.g., `export { DialogTrigger as Trigger }` -> "DialogTrigger" -> "AlertDialog.Trigger"
 * 2. `extendsTypes` - when an interface extends another type
 *    e.g., `interface AlertDialogRootProps extends Dialog.Props` -> "Dialog.Props" -> "AlertDialog.Root.Props"
 *
 * The map allows type references in the original namespace to be rewritten
 * to the canonical namespace in the documentation.
 */
export function buildTypeCompatibilityMap(
  allExports: tae.ExportNode[],
  _exportNames: string[],
): TypeCompatibilityMap {
  const map: TypeCompatibilityMap = new Map();

  for (const exp of allExports) {
    const exportName = exp.name;
    const exportIsDotted = exportName.includes('.');

    // Handle reexportedFrom: maps the original component name to the new export name
    // e.g., AlertDialog.Trigger with reexportedFrom: "DialogTrigger"
    //   means AlertDialog.Trigger is a re-export of DialogTrigger
    //   -> "DialogTrigger" -> "AlertDialog.Trigger"
    // Child type mappings (e.g., DialogTrigger.State -> AlertDialog.Trigger.State)
    // are handled by extendsTypes on those child exports.
    const reexportedFrom = (exp as tae.ExportNode & { reexportedFrom?: string }).reexportedFrom;
    if (reexportedFrom && reexportedFrom !== exportName) {
      const existingMapping = map.get(reexportedFrom);
      // Prefer dotted names over flat names for canonical mappings
      // e.g., prefer "Toolbar.Separator" over "ToolbarSeparator"
      if (!existingMapping || (exportIsDotted && !existingMapping.includes('.'))) {
        map.set(reexportedFrom, exportName);
      }
    }

    // Handle extendsTypes: maps the extended type names to this export
    // e.g., AlertDialogRootProps with extendsTypes: [{ name: "Dialog.Props", resolvedName: "DialogProps" }]
    //   -> "Dialog.Props" -> "AlertDialog.Root.Props"
    //   -> "DialogProps" -> "AlertDialog.Root.Props"
    const extendsTypes = (
      exp as tae.ExportNode & {
        extendsTypes?: Array<{ name: string; resolvedName?: string }>;
      }
    ).extendsTypes;
    if (extendsTypes) {
      for (const extendedType of extendsTypes) {
        // Map the written name: "Dialog.Props" -> "AlertDialog.Root.Props"
        const existingWrittenMapping = map.get(extendedType.name);
        // Prefer dotted names over flat names for canonical mappings
        if (!existingWrittenMapping || (exportIsDotted && !existingWrittenMapping.includes('.'))) {
          map.set(extendedType.name, exportName);
        }

        // Map the resolved name if different: "DialogProps" -> "AlertDialog.Root.Props"
        if (extendedType.resolvedName && extendedType.resolvedName !== extendedType.name) {
          const existingResolvedMapping = map.get(extendedType.resolvedName);
          // Prefer dotted names over flat names for canonical mappings
          if (
            !existingResolvedMapping ||
            (exportIsDotted && !existingResolvedMapping.includes('.'))
          ) {
            map.set(extendedType.resolvedName, exportName);
          }
        }
      }
    }
  }

  return map;
}

/**
 * Context for type string rewriting operations.
 */
export interface TypeRewriteContext {
  /** Map from original type names to their canonical export names */
  typeCompatibilityMap: TypeCompatibilityMap;
  /** Available export names in the current module for namespace resolution */
  exportNames: string[];
  /** Map from flat type names to dotted names (e.g., AlertDialogTriggerState -> AlertDialog.Trigger.State) */
  typeNameMap?: Record<string, string>;
}

/**
 * Checks if a character is an identifier character (letter, digit, or underscore).
 */
function isIdentifierChar(char: string | undefined): boolean {
  if (!char) {
    return false;
  }
  const code = char.charCodeAt(0);
  // a-z, A-Z, 0-9, _
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95
  );
}

/**
 * Replaces all occurrences of `search` with `replacement` in `text`,
 * but only when `search` appears at word boundaries (not preceded or followed by an identifier char).
 * This prevents "Dialog" from matching within "AlertDialog" and "DialogTrigger" from matching
 * within "DialogTriggerState".
 */
function replaceAtWordBoundary(text: string, search: string, replacement: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const matchIndex = text.indexOf(search, i);
    if (matchIndex === -1) {
      result += text.slice(i);
      break;
    }

    // Check if preceded by an identifier character
    const charBefore = matchIndex > 0 ? text[matchIndex - 1] : undefined;
    // Check if followed by an identifier character
    const charAfter = text[matchIndex + search.length];

    if (isIdentifierChar(charBefore) || isIdentifierChar(charAfter)) {
      // Not at word boundary, skip this occurrence
      result += text.slice(i, matchIndex + 1);
      i = matchIndex + 1;
    } else {
      // At word boundary, perform replacement
      result += text.slice(i, matchIndex) + replacement;
      i = matchIndex + search.length;
    }
  }

  return result;
}

/**
 * Rewrites a single type string value based on the rewrite context.
 * Handles internal suffix normalization and inherited namespace transformations.
 */
function rewriteTypeValue(value: string, context: TypeRewriteContext): string {
  const { typeCompatibilityMap, exportNames, typeNameMap } = context;

  let next = value.replaceAll('.RootInternal', '.Root');

  // Apply type compatibility mappings
  // Sort by key length (longest first) to avoid partial matches
  // e.g., "DialogTriggerState" should match before "DialogTrigger"
  const sortedEntries = Array.from(typeCompatibilityMap.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [originalName, canonicalName] of sortedEntries) {
    // Only apply if the canonical name exists in our exports or is a valid canonical name from the map
    // The canonical names come from extendsTypes mappings, so they are known-valid namespace paths
    // like "AlertDialog.Trigger.State" even if not directly in exportNames
    const canonicalNameExists =
      exportNames.includes(canonicalName) || typeCompatibilityMap.has(originalName);

    // Get the final dotted name that this canonical name would transform to
    // e.g., if canonicalName is "ToolbarSeparatorState" and typeNameMap has
    // "ToolbarSeparatorState" -> "Toolbar.Separator.State", use the dotted version
    const finalDottedName = typeNameMap?.[canonicalName] || canonicalName;

    // Skip if the text already contains the final dotted name with a namespace prefix
    // e.g., if text has "Toolbar.Separator.State", don't replace "Separator.State"
    // because it would create "Toolbar.ToolbarSeparatorState" which then becomes
    // "Toolbar.Toolbar.Separator.State"
    const alreadyHasDottedName = finalDottedName.includes('.') && next.includes(finalDottedName);

    if (canonicalNameExists && next.includes(originalName) && !alreadyHasDottedName) {
      next = replaceAtWordBoundary(next, originalName, canonicalName);
    }
  }

  // After applying compatibility mappings, convert flat type names to dotted names
  // e.g., "AlertDialogTriggerState" -> "AlertDialog.Trigger.State"
  if (typeNameMap) {
    // Sort by key length (longest first) to avoid partial matches
    const sortedTypeNameEntries = Object.entries(typeNameMap).sort(
      (a, b) => b[0].length - a[0].length,
    );

    for (const [flatName, dottedName] of sortedTypeNameEntries) {
      if (next.includes(flatName)) {
        next = replaceAtWordBoundary(next, flatName, dottedName);
      }
    }
  }

  return next;
}

/**
 * Recursively rewrites type strings in a data structure.
 *
 * This function traverses objects, arrays, and primitive values, applying type name
 * transformations to all string values. Used to normalize type references after
 * formatting.
 *
 * The function preserves the structure of the input, only transforming string values,
 * so the output type matches the input type.
 */
export function rewriteTypeStringsDeep<T>(node: T, context: TypeRewriteContext): T {
  if (node == null) {
    return node;
  }

  if (typeof node === 'string') {
    return rewriteTypeValue(node, context) as T;
  }

  if (Array.isArray(node)) {
    return node.map((item) => rewriteTypeStringsDeep(item, context)) as T;
  }

  if (typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] = rewriteTypeStringsDeep(value, context);
    }
    return result as T;
  }

  return node;
}
