import * as tae from 'typescript-api-extractor';
import {
  formatParameters,
  formatType,
  isFunctionType,
  parseMarkdownToHast,
  FormattedParameter,
  FormatInlineTypeOptions,
  extractNamespaceGroup,
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
  /** Return value type as plain text string */
  returnValue: string;
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
 * @param exportNames - List of export names for type resolution
 * @param typeNameMap - Map for transforming type names
 * @param options - Formatting options
 * @returns Formatted function metadata with parameters and return value
 */
export async function formatFunctionData(
  func: tae.ExportNode & { type: tae.FunctionNode },
  allExports: tae.ExportNode[],
  exportNames: string[],
  typeNameMap: Record<string, string>,
  options: FormatFunctionOptions = {},
): Promise<FunctionTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m, formatting } = options;

  const descriptionText = func.documentation?.description?.replace(descriptionRemoveRegex, '');
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // We don't support functions with multiple signatures yet
  const signature = func.type.callSignatures[0];
  const parameters = signature.parameters;

  const formattedParameters = await formatParameters(parameters, exportNames, typeNameMap, {
    formatting,
  });

  // Format return value type as plain text - highlighting is deferred to loadServerTypes
  const returnValue = formatType(
    signature.returnValueType,
    false,
    undefined,
    true,
    exportNames,
    typeNameMap,
  );

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
    returnValue,
    returnValueDescription,
    returnValueDescriptionText,
  };

  // Post-process type strings to align naming across re-exports
  const namespaceGroup = extractNamespaceGroup(func.name);

  // Get inheritedFrom from this export or its parent
  let inheritedFrom = (func as tae.ExportNode & { inheritedFrom?: string }).inheritedFrom;

  if (!inheritedFrom) {
    // Try to find parent's inheritedFrom
    const parts = func.name.split('.');
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
