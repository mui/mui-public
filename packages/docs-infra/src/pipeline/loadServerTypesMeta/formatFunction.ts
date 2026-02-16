import * as tae from 'typescript-api-extractor';
import {
  formatParameters,
  formatProperties,
  formatType,
  isAnonymousObjectType,
  isFunctionType,
  isObjectType,
  parseMarkdownToHast,
  FormattedParameter,
  FormattedProperty,
  FormatInlineTypeOptions,
  rewriteTypeStringsDeep,
  TypeRewriteContext,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';

/**
 * Formatted function metadata with plain text types and parsed markdown descriptions.
 *
 * Type highlighting (type → HAST, shortType, detailedType) is deferred to
 * the loadServerTypes stage via highlightTypesMeta() after highlightTypes().
 */
export type FunctionTypeMeta = {
  name: string;
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  parameters: Record<string, FormattedParameter>;
  /** Return value - either plain text string or object with properties (like hook return values) */
  returnValue: Record<string, FormattedProperty> | string;
  /** Plain text version of returnValue for markdown generation (when returnValue is string) */
  returnValueText?: string;
  /** Description of the return value (parsed markdown as HAST) */
  returnValueDescription?: HastRoot;
  /** Plain text version of returnValueDescription for markdown generation */
  returnValueDescriptionText?: string;
};

export interface FormatFunctionOptions {
  descriptionRemoveRegex?: RegExp;
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
}

/**
 * Formats function export data into a structured metadata object.
 *
 * @param func - The function export node from typescript-api-extractor
 * @param typeNameMap - Map for transforming type names
 * @param rewriteContext - Context for type string rewriting including type compatibility map
 * @param options - Formatting options
 * @returns Formatted function metadata with parameters and return value
 */
export async function formatFunctionData(
  func: tae.ExportNode & { type: tae.FunctionNode },
  typeNameMap: Record<string, string>,
  rewriteContext: TypeRewriteContext,
  options: FormatFunctionOptions = {},
): Promise<FunctionTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m, formatting } = options;

  const { exportNames } = rewriteContext;

  const descriptionText = func.documentation?.description?.replace(descriptionRemoveRegex, '');
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // Handle function overloads: pick the signature with the most parameters,
  // then mark parameters as optional if they don't appear in all signatures.
  const callSignatures = func.type.callSignatures;
  const signature = callSignatures.reduce((longest, current) =>
    current.parameters.length > longest.parameters.length ? current : longest,
  );
  const parameters = signature.parameters;

  // Determine which parameters are optional by checking if they exist in all overloads
  const minParamCount = Math.min(...callSignatures.map((sig) => sig.parameters.length));
  const optionalFromIndex = minParamCount;

  const formattedParameters = await formatParameters(parameters, exportNames, typeNameMap, {
    formatting,
  });

  // Mark parameters as optional if they don't appear in all overloads
  parameters.forEach((param, index) => {
    if (index >= optionalFromIndex && formattedParameters[param.name]) {
      formattedParameters[param.name].optional = true;
    }
  });

  // Format return value - either as object with properties or plain text string
  // Only expand anonymous object types into a property table.
  // Named types (like class instances `DialogHandle<Payload>`) are kept as type references.
  let formattedReturnValue: Record<string, FormattedProperty> | string;
  let returnValueText: string | undefined;
  const returnType = signature.returnValueType;
  const shouldExpandReturnType =
    isObjectType(returnType) &&
    isAnonymousObjectType(returnType) &&
    returnType.properties &&
    returnType.properties.length > 0;

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
    // Only expand anonymous objects (no type name) — named types like
    // `DialogHandle<Payload>` should be shown as type references.
    const shouldExpand = isObjectType(returnType) && isAnonymousObjectType(returnType);
    returnValueText = formatType(
      signature.returnValueType,
      false,
      undefined,
      shouldExpand,
      exportNames,
      typeNameMap,
    );
    formattedReturnValue = returnValueText;
  }

  // Get return value description from @returns tag
  const returnsTag = func.documentation?.tags?.find((tag) => tag.name === 'returns');
  const returnValueDescriptionText = returnsTag?.value;
  const returnValueDescription = returnValueDescriptionText
    ? await parseMarkdownToHast(returnValueDescriptionText)
    : undefined;

  const raw: FunctionTypeMeta = {
    name: func.name,
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

/**
 * Type guard to check if an export node is a public function (not a hook).
 *
 * @param exportNode - The export node to check
 * @returns true if the export is a public function that should be documented
 */
export function isPublicFunction(
  exportNode: tae.ExportNode,
): exportNode is tae.ExportNode & { type: tae.FunctionNode } {
  const isPublic =
    exportNode.documentation?.visibility !== 'private' &&
    exportNode.documentation?.visibility !== 'internal';

  const hasIgnoreTag = exportNode.documentation?.tags?.some((tag) => tag.name === 'ignore');

  // Functions that start with 'use' are hooks, not regular functions
  const isHook = exportNode.name.startsWith('use');

  return isFunctionType(exportNode.type) && !isHook && !hasIgnoreTag && isPublic;
}
