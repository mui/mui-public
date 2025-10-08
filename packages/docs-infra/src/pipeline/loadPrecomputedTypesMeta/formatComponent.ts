import * as tae from 'typescript-api-extractor';
import { formatProperties, formatEnum } from './format';
import * as memberOrder from './order';

export type ComponentTypeMeta = {
  name: string;
  description?: string;
  props: Record<string, any>;
  dataAttributes: Record<string, any>;
  cssVariables: Record<string, any>;
};

export interface FormatComponentOptions {
  dataAttributesSuffix?: string;
  cssVariablesSuffix?: string;
  descriptionRemoveRegex?: RegExp;
}

export async function formatComponentData(
  component: tae.ExportNode,
  allExports: tae.ExportNode[],
  exportNames: string[],
  options: FormatComponentOptions = {},
): Promise<ComponentTypeMeta> {
  const {
    dataAttributesSuffix = 'DataAttributes',
    cssVariablesSuffix = 'CssVars',
    descriptionRemoveRegex = /\n\nDocumentation: .*$/m,
  } = options;

  const description = component.documentation?.description?.replace(descriptionRemoveRegex, '');

  // Find data attributes and CSS variables in a single loop
  let dataAttributes: tae.ExportNode | undefined;
  let cssVariables: tae.ExportNode | undefined;
  const prefixes = exportNames && exportNames.length > 0 ? exportNames : [''];
  const dataAttributesName = prefixes.map(
    (prefix) => `${prefix}${component.name}${dataAttributesSuffix}`,
  );
  const cssVariablesName = prefixes.map(
    (prefix) => `${prefix}${component.name}${cssVariablesSuffix}`,
  );

  for (const node of allExports) {
    if (dataAttributesName.includes(node.name)) {
      dataAttributes = node;
    } else if (cssVariablesName.includes(node.name)) {
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
      await formatProperties((component.type as tae.ComponentNode).props, exportNames, allExports),
      memberOrder.props,
    ),
    dataAttributes:
      dataAttributes && dataAttributes.type.kind === 'enum'
        ? sortObjectByKeys(
            formatEnum(dataAttributes.type as tae.EnumNode),
            memberOrder.dataAttributes,
          )
        : {},
    cssVariables:
      cssVariables && cssVariables.type.kind === 'enum'
        ? sortObjectByKeys(formatEnum(cssVariables.type as tae.EnumNode), memberOrder.cssVariables)
        : {},
  };

  // Post-process type strings to align naming across re-exports and hide internal suffixes.
  const componentGroup = extractComponentGroup(component.name);
  return rewriteTypeStringsDeep(raw, componentGroup);
}

export function isPublicComponent(exportNode: tae.ExportNode) {
  return (
    exportNode.type instanceof tae.ComponentNode &&
    !exportNode.documentation?.hasTag('ignore') &&
    exportNode.isPublic()
  );
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

function rewriteTypeStringsDeep(node: any, componentGroup: string): any {
  if (node == null) {
    return node;
  }

  if (typeof node === 'string') {
    return rewriteTypeValue(node, componentGroup);
  }

  if (Array.isArray(node)) {
    return node.map((item) => rewriteTypeStringsDeep(item, componentGroup));
  }

  if (typeof node === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] = rewriteTypeStringsDeep(value, componentGroup);
    }
    return result;
  }

  return node;
}
