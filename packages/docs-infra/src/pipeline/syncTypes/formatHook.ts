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
  typeNameMap: Record<string, string>,
  rewriteContext: TypeRewriteContext,
  options: FormatHookOptions = {},
): Promise<HookTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m, formatting } = options;

  const { exportNames } = rewriteContext;

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
      false,
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
      false,
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
  return rewriteTypeStringsDeep(raw, rewriteContext);
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
