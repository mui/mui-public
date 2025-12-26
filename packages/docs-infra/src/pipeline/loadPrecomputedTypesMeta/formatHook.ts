import * as tae from 'typescript-api-extractor';
import {
  formatProperties,
  formatParameters,
  formatTypeAsHast,
  isFunctionType,
  isObjectType,
  parseMarkdownToHast,
  FormattedProperty,
  FormattedParameter,
  FormatInlineTypeOptions,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';

export type HookTypeMeta = {
  name: string;
  description?: HastRoot;
  parameters: Record<string, FormattedParameter | FormattedProperty>;
  returnValue: Record<string, FormattedProperty> | HastRoot;
};

export interface FormatHookOptions {
  descriptionRemoveRegex?: RegExp;
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
}

export async function formatHookData(
  hook: tae.ExportNode & { type: tae.FunctionNode },
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

  let formattedReturnValue: Record<string, FormattedProperty> | HastRoot;
  if (isObjectType(signature.returnValueType)) {
    formattedReturnValue = await formatProperties(
      signature.returnValueType.properties,
      exportNames,
      typeNameMap,
      undefined,
      { formatting },
    );
  } else {
    formattedReturnValue = await formatTypeAsHast(
      signature.returnValueType,
      false,
      undefined,
      true,
      exportNames,
      typeNameMap,
    );
  }

  return {
    name: hook.name,
    description,
    parameters: formattedParameters,
    returnValue: formattedReturnValue,
  };
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
