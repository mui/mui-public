import * as tae from 'typescript-api-extractor';
import {
  formatProperties,
  formatEnum,
  isComponentType,
  parseMarkdownToHast,
  type FormattedProperty,
  type FormattedEnumMember,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';
import * as memberOrder from './order';

/**
 * Complete component type metadata for documentation.
 */
export type ComponentTypeMeta = {
  name: string;
  description?: HastRoot;
  props: Record<string, FormattedProperty>;
  dataAttributes: Record<string, FormattedEnumMember>;
  cssVariables: Record<string, FormattedEnumMember>;
};

/**
 * Options for customizing component data formatting.
 */
export interface FormatComponentOptions {
  /** Suffix for data attributes enum name (default: 'DataAttributes') */
  dataAttributesSuffix?: string;
  /** Suffix for CSS variables enum name (default: 'CssVars') */
  cssVariablesSuffix?: string;
  /** Regex pattern to remove from component description */
  descriptionRemoveRegex?: RegExp;
}

/**
 * Formats a TypeScript component export into structured documentation metadata.
 *
 * This function extracts and formats all relevant component information including
 * props, data attributes, and CSS variables. It also applies post-processing to
 * normalize type names across re-exports and hide internal implementation details.
 *
 * The component must be validated with `isPublicComponent()` before calling this function.
 */
export async function formatComponentData(
  component: tae.ExportNode & { type: tae.ComponentNode },
  allExports: tae.ExportNode[],
  exportNames: string[],
  typeNameMap: Record<string, string>,
  options: FormatComponentOptions = {},
): Promise<ComponentTypeMeta> {
  const {
    dataAttributesSuffix = 'DataAttributes',
    cssVariablesSuffix = 'CssVars',
    descriptionRemoveRegex = /\n\nDocumentation: .*$/m,
  } = options;

  const descriptionText = component.documentation?.description?.replace(descriptionRemoveRegex, '');
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // Find data attributes and CSS variables in a single loop
  let dataAttributes: tae.ExportNode | undefined;
  let cssVariables: tae.ExportNode | undefined;

  // For DataAttributes/CssVars lookup, use the originalName (before transformations).
  // Example for re-exported component:
  //   - Component: ContextMenu.Backdrop (transformed from MenuBackdrop)
  //   - originalName: MenuBackdrop
  //   - We look for: MenuBackdropDataAttributes (using originalName + suffix)
  //   - That export's originalName will also be MenuBackdropDataAttributes
  const originalName = (component as any).originalName;
  const componentNameForLookup = originalName || component.name.replace(/\./g, '');

  const dataAttributesName = `${componentNameForLookup}${dataAttributesSuffix}`;
  const cssVariablesName = `${componentNameForLookup}${cssVariablesSuffix}`;

  // Look for DataAttributes/CssVars by checking originalName on each export
  for (const node of allExports) {
    const nodeOriginalName = (node as any).originalName;
    const nodeName = nodeOriginalName || node.name;

    if (nodeName === dataAttributesName) {
      dataAttributes = node;
    } else if (nodeName === cssVariablesName) {
      cssVariables = node;
    }

    // Early exit if we found both
    if (dataAttributes && cssVariables) {
      break;
    }
  }

  const raw: ComponentTypeMeta = {
    name: component.name,
    description,
    props: sortObjectByKeys(
      await formatProperties(component.type.props, exportNames, typeNameMap, allExports),
      memberOrder.props,
    ),
    dataAttributes:
      dataAttributes && dataAttributes.type.kind === 'enum'
        ? sortObjectByKeys(await formatEnum(dataAttributes.type), memberOrder.dataAttributes)
        : {},
    cssVariables:
      cssVariables && cssVariables.type.kind === 'enum'
        ? sortObjectByKeys(await formatEnum(cssVariables.type), memberOrder.cssVariables)
        : {},
  };

  // Post-process type strings to align naming across re-exports and hide internal suffixes.
  const componentGroup = extractComponentGroup(component.name);
  return rewriteTypeStringsDeep(raw, componentGroup);
}

/**
 * Type guard to check if an export is a public component that should be documented.
 *
 * A component is considered public if it's a ComponentNode, doesn't have an @ignore tag,
 * and is marked as public (not @internal). Use this to filter components before passing
 * them to `formatComponentData()`.
 */
export function isPublicComponent(
  exportNode: tae.ExportNode,
): exportNode is tae.ExportNode & { type: tae.ComponentNode } {
  const isPublic =
    exportNode.documentation?.visibility !== 'private' &&
    exportNode.documentation?.visibility !== 'internal';

  const hasIgnoreTag = exportNode.documentation?.tags?.some((tag) => tag.name === 'ignore');

  return isComponentType(exportNode.type) && !hasIgnoreTag && isPublic;
}

function sortObjectByKeys<T>(obj: Record<string, T>, order: string[]): Record<string, T> {
  if (order.length === 0) {
    return obj;
  }

  const sortedObj: Record<string, T> = {};
  const everythingElse: Record<string, T> = {};

  // Gather keys that are not in the order array
  Object.keys(obj).forEach((key) => {
    if (!order.includes(key)) {
      everythingElse[key] = obj[key];
    }
  });

  // Sort the keys of everythingElse
  const sortedEverythingElseKeys = Object.keys(everythingElse).sort();

  // Populate the sorted object according to the order array
  order.forEach((key) => {
    if (key === '__EVERYTHING_ELSE__') {
      // Insert all "everything else" keys at this position, sorted
      sortedEverythingElseKeys.forEach((sortedKey) => {
        sortedObj[sortedKey] = everythingElse[sortedKey];
      });
    } else if (obj.hasOwnProperty(key)) {
      sortedObj[key] = obj[key];
    }
  });

  return sortedObj;
}

function extractComponentGroup(componentExportName: string): string {
  const match = componentExportName.match(/^[A-Z][a-z0-9]*/);
  return match ? match[0] : componentExportName;
}

function rewriteTypeValue(value: string, componentGroup: string): string {
  let next = value.replaceAll('.RootInternal', '.Root');

  // When documenting Autocomplete (which re-exports Combobox),
  // display Autocomplete.* instead of Combobox.*
  if (componentGroup === 'Autocomplete') {
    next = next.replaceAll(/\bCombobox\./g, 'Autocomplete.');
  }

  return next;
}

/**
 * Recursively rewrites type strings in a data structure.
 *
 * This function traverses objects, arrays, and primitive values, applying type name
 * transformations to all string values. Used to normalize type references after
 * component data formatting.
 *
 * The function preserves the structure of the input, only transforming string values,
 * so the output type matches the input type.
 */
function rewriteTypeStringsDeep<T>(node: T, componentGroup: string): T {
  if (node == null) {
    return node;
  }

  if (typeof node === 'string') {
    return rewriteTypeValue(node, componentGroup) as T;
  }

  if (Array.isArray(node)) {
    return node.map((item) => rewriteTypeStringsDeep(item, componentGroup)) as T;
  }

  if (typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] = rewriteTypeStringsDeep(value, componentGroup);
    }
    return result as T;
  }

  return node;
}
