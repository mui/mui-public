import * as tae from 'typescript-api-extractor';
import {
  formatProperties,
  formatEnum,
  isComponentType,
  parseMarkdownToHast,
  rewriteTypeStringsDeep,
  type FormattedProperty,
  type FormattedEnumMember,
  type FormatInlineTypeOptions,
  type TypeRewriteContext,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';
import * as memberOrder from '../loadServerTypesText/order';

/**
 * Complete component type metadata for documentation.
 */
export type ComponentTypeMeta = {
  name: string;
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
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
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
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
  typeNameMap: Record<string, string>,
  rewriteContext: TypeRewriteContext,
  options: FormatComponentOptions = {},
): Promise<ComponentTypeMeta> {
  const {
    dataAttributesSuffix = 'DataAttributes',
    cssVariablesSuffix = 'CssVars',
    descriptionRemoveRegex = /\n\nDocumentation: .*$/m,
    formatting,
  } = options;

  const { exportNames } = rewriteContext;

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

  // Get the component's short name (e.g., "Trigger" from "AlertDialog.Trigger")
  const componentShortName = component.name.split('.').pop() || component.name;
  const dataAttributesSuffixWithShortName = `${componentShortName}${dataAttributesSuffix}`;
  const cssVariablesSuffixWithShortName = `${componentShortName}${cssVariablesSuffix}`;

  // Look for DataAttributes/CssVars by checking originalName on each export
  // First pass: exact match
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

  // Fallback: For re-exported components (like AlertDialog.Trigger which re-exports DialogTrigger),
  // the DataAttributes file uses the original component name (DialogTriggerDataAttributes).
  // If we didn't find an exact match, look for any DataAttributes ending with the component's
  // short name (e.g., "TriggerDataAttributes").
  // Priority: prefer DataAttributes whose prefix is contained in the component's namespace
  // (e.g., for AlertDialog.Trigger, prefer DialogTriggerDataAttributes over MenuTriggerDataAttributes)
  if (!dataAttributes || !cssVariables) {
    // Get the component's namespace (e.g., "AlertDialog" from "AlertDialog.Trigger")
    const componentNamespace = component.name.includes('.')
      ? component.name.substring(0, component.name.lastIndexOf('.'))
      : '';

    // Collect all matching candidates
    const dataAttributesCandidates: Array<{ node: tae.ExportNode; priority: number }> = [];
    const cssVariablesCandidates: Array<{ node: tae.ExportNode; priority: number }> = [];

    for (const node of allExports) {
      const nodeOriginalName = (node as any).originalName;
      const nodeName = nodeOriginalName || node.name;

      // Check if this export ends with the component's short name + suffix
      if (!dataAttributes && nodeName.endsWith(dataAttributesSuffixWithShortName)) {
        // Extract the prefix (e.g., "Dialog" from "DialogTriggerDataAttributes")
        const prefix = nodeName.slice(0, -dataAttributesSuffixWithShortName.length);
        // Priority: 2 if prefix is contained in namespace (related component), 1 otherwise
        const priority = componentNamespace.includes(prefix) ? 2 : 1;
        dataAttributesCandidates.push({ node, priority });
      }
      if (!cssVariables && nodeName.endsWith(cssVariablesSuffixWithShortName)) {
        const prefix = nodeName.slice(0, -cssVariablesSuffixWithShortName.length);
        const priority = componentNamespace.includes(prefix) ? 2 : 1;
        cssVariablesCandidates.push({ node, priority });
      }
    }

    // Select the highest priority candidate
    if (!dataAttributes && dataAttributesCandidates.length > 0) {
      dataAttributesCandidates.sort((a, b) => b.priority - a.priority);
      dataAttributes = dataAttributesCandidates[0].node;
    }
    if (!cssVariables && cssVariablesCandidates.length > 0) {
      cssVariablesCandidates.sort((a, b) => b.priority - a.priority);
      cssVariables = cssVariablesCandidates[0].node;
    }
  }

  const raw: ComponentTypeMeta = {
    name: component.name,
    description,
    descriptionText,
    props: sortObjectByKeys(
      await formatProperties(component.type.props, exportNames, typeNameMap, true, {
        formatting,
      }),
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
  return rewriteTypeStringsDeep(raw, rewriteContext);
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
