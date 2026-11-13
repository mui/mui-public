import type * as tae from '@mui/internal-typescript-api-extractor';

// ============================================================================
// Type Rewriting Utilities
// ============================================================================

/**
 * A map from original type names to their canonical export names.
 * For example: "DialogTrigger" -> "AlertDialog.Trigger"
 */
export type TypeCompatibilityMap = Map<string, string>;

/**
 * Builds a map from the names of extended types to the exports extending them.
 *
 * `interface AlertDialogRootProps extends Dialog.Props {}` declares a type of its own, so type
 * references keep naming `Dialog.Props`; this map rewrites them to the name of the export that
 * stands for it on the page, "Dialog.Props" -> "AlertDialog.Root.Props".
 */
export function buildTypeCompatibilityMap(
  allExports: tae.ExportNode[],
  exportNames: string[],
): TypeCompatibilityMap {
  const map: TypeCompatibilityMap = new Map();
  const exportNameSet = new Set(exportNames);

  for (const exp of allExports) {
    const exportName = exp.name;
    const exportIsDotted = exportName.includes('.');

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
        // Skip if the extended type is itself a public export.
        // e.g., ToastManagerAddOptions extends Omit<ToastObject, ...> should NOT
        // rewrite ToastObject -> ToastManagerAddOptions because ToastObject is its
        // own public type.
        if (exportNameSet.has(extendedType.name)) {
          continue;
        }

        // Map the written name: "Dialog.Props" -> "AlertDialog.Root.Props"
        const existingWrittenMapping = map.get(extendedType.name);
        // Prefer dotted names over flat names for canonical mappings
        if (!existingWrittenMapping || (exportIsDotted && !existingWrittenMapping.includes('.'))) {
          map.set(extendedType.name, exportName);
        }

        // Map the resolved name if different: "DialogProps" -> "AlertDialog.Root.Props"
        if (extendedType.resolvedName && extendedType.resolvedName !== extendedType.name) {
          // Also skip if the resolved name is a public export
          if (exportNameSet.has(extendedType.resolvedName)) {
            continue;
          }
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
  const { typeCompatibilityMap, exportNames } = context;

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

    // Skip if the text already contains the canonical name with a namespace prefix
    // e.g., if text has "Toolbar.Separator.State", don't replace "Separator.State"
    const alreadyHasDottedName = canonicalName.includes('.') && next.includes(canonicalName);

    if (canonicalNameExists && next.includes(originalName) && !alreadyHasDottedName) {
      next = replaceAtWordBoundary(next, originalName, canonicalName);
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
