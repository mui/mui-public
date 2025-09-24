import * as tae from 'typescript-api-extractor';
import { formatProperties, formatParameters, formatType } from './format';

export type HookTypeMeta = {
  name: string;
  description?: string;
  parameters: Record<string, any>;
  returnValue: Record<string, any> | string;
};

export interface FormatHookOptions {
  descriptionRemoveRegex?: RegExp;
}

export async function formatHookData(
  hook: tae.ExportNode,
  exportNames: string[],
  options: FormatHookOptions = {},
): Promise<HookTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m } = options;

  const description = hook.documentation?.description?.replace(descriptionRemoveRegex, '');

  // We don't support hooks with multiple signatures yet
  const signature = (hook.type as tae.FunctionNode).callSignatures[0];
  const parameters = signature.parameters;
  let formattedParameters: Record<string, any>;
  if (
    parameters.length === 1 &&
    parameters[0].type instanceof tae.ObjectNode &&
    parameters[0].name === 'params'
  ) {
    formattedParameters = await formatProperties(parameters[0].type.properties, exportNames, []);
  } else {
    formattedParameters = formatParameters(parameters, exportNames);
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

export function isPublicHook(exportNode: tae.ExportNode) {
  return (
    exportNode.type instanceof tae.FunctionNode &&
    exportNode.name.startsWith('use') &&
    !exportNode.documentation?.hasTag('ignore') &&
    exportNode.isPublic()
  );
}
