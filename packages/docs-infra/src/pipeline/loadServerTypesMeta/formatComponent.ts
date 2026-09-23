import type * as tae from 'typescript-api-extractor';
import {
  formatProperties,
  formatEnum,
  parseMarkdownToHast,
  applyDescriptionReplacements,
} from './format';
import type {
  FormattedProperty,
  FormattedEnumMember,
  FormatInlineTypeOptions,
  DescriptionReplacement,
} from './format';
import { isComponentType, isEnumType } from './typeGuards';
import type { ConstantGroupTarget } from './constantGroups';
import { rewriteTypeStringsDeep } from './rewriteTypes';
import type { TypeRewriteContext } from './rewriteTypes';
import type { ExternalTypesCollector } from './externalTypes';
import type { HastRoot } from '../../CodeHighlighter/types';
import * as memberOrder from '../loadServerTypesText/order';
import type { OrderingConfig } from '../loadServerTypesText/order';

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
  /** Constant groups matched to components, keyed by export name (see `matchConstantGroups`) */
  constantGroups?: Map<string, ConstantGroupTarget>;
  /** Pattern/replacement pairs to apply to descriptions */
  descriptionReplacements?: DescriptionReplacement[];
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
  /** Collector for external types discovered during formatting */
  externalTypes?: ExternalTypesCollector;
  /** Custom ordering for props, data attributes, and CSS variables */
  ordering?: OrderingConfig;
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
  const { descriptionReplacements, formatting, externalTypes } = options;

  const { exportNames } = rewriteContext;

  const descriptionText = component.documentation?.description
    ? applyDescriptionReplacements(component.documentation.description, descriptionReplacements)
    : undefined;
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // The component's data attributes and CSS variables are the constant groups matched to it.
  let dataAttributes: tae.EnumNode | undefined;
  let cssVariables: tae.EnumNode | undefined;
  for (const node of allExports) {
    const target = options.constantGroups?.get(node.name);
    if (target?.component === component.name && isEnumType(node.type)) {
      if (target.kind === 'data-attributes') {
        dataAttributes ??= node.type;
      } else {
        cssVariables ??= node.type;
      }
    }
  }

  const raw: ComponentTypeMeta = {
    name: component.name,
    description,
    descriptionText,
    props: sortObjectByKeys(
      await formatProperties(component.type.props, {
        exportNames,
        typeNameMap,
        isComponentContext: true,
        formatting,
        externalTypes,
        descriptionReplacements,
      }),
      options.ordering?.props ?? memberOrder.props,
    ),
    dataAttributes: dataAttributes
      ? sortObjectByKeys(
          await formatEnum(dataAttributes, descriptionReplacements),
          options.ordering?.dataAttributes ?? memberOrder.dataAttributes,
        )
      : {},
    cssVariables: cssVariables
      ? sortObjectByKeys(
          await formatEnum(cssVariables, descriptionReplacements),
          options.ordering?.cssVariables ?? memberOrder.cssVariables,
        )
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
