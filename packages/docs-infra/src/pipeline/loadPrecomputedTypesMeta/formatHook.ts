import * as tae from 'typescript-api-extractor';
import {
  formatProperties,
  formatParameters,
  formatType,
  isFunctionType,
  parseMarkdownToHast,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';

export type HookTypeMeta = {
  name: string;
  description?: HastRoot;
  parameters: Record<string, any>;
  returnValue: Record<string, any> | string;
};

export interface FormatHookOptions {
  descriptionRemoveRegex?: RegExp;
}

export async function formatHookData(
  hook: tae.ExportNode & { type: tae.FunctionNode },
  exportNames: string[],
  options: FormatHookOptions = {},
): Promise<HookTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m } = options;

  const descriptionText = hook.documentation?.description?.replace(descriptionRemoveRegex, '');
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // We don't support hooks with multiple signatures yet
  const signature = hook.type.callSignatures[0];
  const parameters = signature.parameters;
  let formattedParameters: Record<string, any>;
  if (
    parameters.length === 1 &&
    parameters[0].type instanceof tae.ObjectNode &&
    parameters[0].name === 'params'
  ) {
    formattedParameters = await formatProperties(parameters[0].type.properties, exportNames, []);
  } else {
    formattedParameters = await formatParameters(parameters, exportNames);
  }

  let formattedReturnValue: Record<string, any> | string;
  if (signature.returnValueType instanceof tae.ObjectNode) {
    formattedReturnValue = await formatProperties(
      signature.returnValueType.properties,
      exportNames,
      [],
    );
  } else {
    formattedReturnValue = formatType(
      signature.returnValueType,
      false,
      undefined,
      true,
      exportNames,
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

  const hasIgnoreTag = exportNode.documentation?.tags.some((tag) => tag.name === 'ignore');

  return (
    isFunctionType(exportNode.type) &&
    exportNode.name.startsWith('use') &&
    !hasIgnoreTag &&
    isPublic
  );
}
