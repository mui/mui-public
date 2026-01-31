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
  /** Description of the return value (parsed markdown as HAST) */
  returnValueDescription?: HastRoot;
  /** Plain text version of returnValueDescription for markdown generation */
  returnValueDescriptionText?: string;
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

  // Handle hook overloads: pick the signature with the most parameters,
  // then mark parameters as optional if they don't appear in all signatures.
  const callSignatures = hook.type.callSignatures;
  const signature = callSignatures.reduce((longest, current) =>
    current.parameters.length > longest.parameters.length ? current : longest,
  );
  const parameters = signature.parameters;

  // Determine which parameters are optional by checking if they exist in all overloads
  const minParamCount = Math.min(...callSignatures.map((sig) => sig.parameters.length));
  const optionalFromIndex = minParamCount;

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

    // Mark parameters as optional if they don't appear in all overloads
    parameters.forEach((param, index) => {
      if (index >= optionalFromIndex && formattedParameters[param.name]) {
        (formattedParameters[param.name] as FormattedParameter).optional = true;
      }
    });
  }

  let formattedReturnValue: Record<string, FormattedProperty> | string;
  let returnValueText: string | undefined;
  // Expand object types that have properties into a table
  // Named types without properties (like class instances) are shown as type references
  const returnType = signature.returnValueType;
  const shouldExpandReturnType =
    isObjectType(returnType) && returnType.properties && returnType.properties.length > 0;

  if (shouldExpandReturnType) {
    formattedReturnValue = await formatProperties(
      returnType.properties,
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

  // Get return value description from @returns tag
  const returnsTag = hook.documentation?.tags?.find((tag) => tag.name === 'returns');
  const returnValueDescriptionText = returnsTag?.value;
  const returnValueDescription = returnValueDescriptionText
    ? await parseMarkdownToHast(returnValueDescriptionText)
    : undefined;

  const raw: HookTypeMeta = {
    name: hook.name,
    description,
    descriptionText,
    parameters: formattedParameters,
    returnValue: formattedReturnValue,
    returnValueText,
    returnValueDescription,
    returnValueDescriptionText,
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
