import * as tae from 'typescript-api-extractor';
import {
  formatProperties,
  formatParameters,
  formatType,
  isFunctionType,
  isObjectType,
  parseMarkdownToHast,
  FormattedProperty,
  FormattedParameter,
  FormatInlineTypeOptions,
  extractNamespaceGroup,
  rewriteTypeStringsDeep,
  TypeRewriteContext,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';

export type HookTypeMeta = {
  name: string;
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  parameters: Record<string, FormattedParameter | FormattedProperty>;
  returnValue: Record<string, FormattedProperty> | string;
  /** Plain text version of returnValue for markdown generation (when returnValue is string) */
  returnValueText?: string;
};

export interface FormatHookOptions {
  descriptionRemoveRegex?: RegExp;
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
}

export async function formatHookData(
  hook: tae.ExportNode & { type: tae.FunctionNode },
  allExports: tae.ExportNode[],
  exportNames: string[],
  typeNameMap: Record<string, string>,
  options: FormatHookOptions = {},
): Promise<HookTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m, formatting } = options;

  const descriptionText = hook.documentation?.description?.replace(descriptionRemoveRegex, '');
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // We don't support hooks with multiple signatures yet
  const signature = hook.type.callSignatures[0];
  const parameters = signature.parameters;
  let formattedParameters: Record<string, FormattedParameter | FormattedProperty>;
  if (
    parameters.length === 1 &&
    isObjectType(parameters[0].type) &&
    parameters[0].name === 'params'
  ) {
    formattedParameters = await formatProperties(
      parameters[0].type.properties,
      exportNames,
      typeNameMap,
      [],
      { formatting },
    );
  } else {
    formattedParameters = await formatParameters(parameters, exportNames, typeNameMap, {
      formatting,
    });
  }

  let formattedReturnValue: Record<string, FormattedProperty> | string;
  let returnValueText: string | undefined;
  if (isObjectType(signature.returnValueType)) {
    formattedReturnValue = await formatProperties(
      signature.returnValueType.properties,
      exportNames,
      typeNameMap,
      undefined,
      { formatting },
    );
  } else {
    // Format type as plain text - highlighting is deferred to loadServerTypes
    returnValueText = formatType(
      signature.returnValueType,
      false,
      undefined,
      true,
      exportNames,
      typeNameMap,
    );
    formattedReturnValue = returnValueText;
  }

  const raw: HookTypeMeta = {
    name: hook.name,
    description,
    descriptionText,
    parameters: formattedParameters,
    returnValue: formattedReturnValue,
    returnValueText,
  };

  // Post-process type strings to align naming across re-exports
  const namespaceGroup = extractNamespaceGroup(hook.name);

  // Get inheritedFrom from this export or its parent
  let inheritedFrom = (hook as tae.ExportNode & { inheritedFrom?: string }).inheritedFrom;

  if (!inheritedFrom) {
    // Try to find parent's inheritedFrom
    const parts = hook.name.split('.');
    if (parts.length >= 2) {
      for (let i = parts.length - 1; i >= 2; i -= 1) {
        const parentName = parts.slice(0, i).join('.');
        const parentExport = allExports.find((exp) => exp.name === parentName);
        if (parentExport && (parentExport as any).inheritedFrom) {
          inheritedFrom = (parentExport as any).inheritedFrom;
          break;
        }
      }
    }
  }

  const context: TypeRewriteContext = {
    namespaceGroup,
    inheritedFrom,
    exportNames,
  };
  return rewriteTypeStringsDeep(raw, context);
}

export function isPublicHook(
  exportNode: tae.ExportNode,
): exportNode is tae.ExportNode & { type: tae.FunctionNode } {
  const isPublic =
    exportNode.documentation?.visibility !== 'private' &&
    exportNode.documentation?.visibility !== 'internal';

  const hasIgnoreTag = exportNode.documentation?.tags?.some((tag) => tag.name === 'ignore');

  return (
    isFunctionType(exportNode.type) &&
    exportNode.name.startsWith('use') &&
    !hasIgnoreTag &&
    isPublic
  );
}
