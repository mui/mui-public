import * as tae from 'typescript-api-extractor';
import {
  formatParameters,
  formatType,
  isClassType,
  parseMarkdownToHast,
  FormattedParameter,
  FormatInlineTypeOptions,
  rewriteTypeStringsDeep,
  TypeRewriteContext,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';

/**
 * Class type from typescript-api-extractor.
 * Defined here since ClassNode may not be exported from older versions.
 */
export interface ClassNode {
  kind: 'class';
  typeName: tae.TypeName | undefined;
  constructSignatures: Array<{
    parameters: tae.Parameter[];
    documentation: tae.Documentation | undefined;
  }>;
  properties: Array<{
    name: string;
    type: tae.AnyType;
    documentation: tae.Documentation | undefined;
    optional: boolean;
    readonly: boolean;
    isStatic: boolean;
  }>;
  methods: Array<{
    name: string;
    callSignatures: Array<{
      parameters: tae.Parameter[];
      returnValueType: tae.AnyType;
    }>;
    documentation: tae.Documentation | undefined;
    isStatic: boolean;
  }>;
  typeParameters: tae.TypeName[] | undefined;
}

/**
 * Formatted class metadata with plain text types and parsed markdown descriptions.
 *
 * Type highlighting (type → HAST, shortType, detailedType) is deferred to
 * the loadServerTypes stage via highlightTypesMeta() after highlightTypes().
 */
export type ClassTypeMeta = {
  name: string;
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  /** Constructor parameters */
  constructorParameters: Record<string, FormattedParameter>;
  /** Public instance properties */
  properties: Record<string, FormattedProperty>;
  /** Public instance methods */
  methods: Record<string, FormattedMethod>;
  /** Type parameters (generics) if any */
  typeParameters?: string[];
};

/**
 * Formatted property metadata for class properties.
 */
export interface FormattedProperty {
  name: string;
  typeText: string;
  description?: HastRoot;
  descriptionText?: string;
  optional: boolean;
  readonly: boolean;
  isStatic: boolean;
}

/**
 * Formatted method metadata for class methods.
 */
export interface FormattedMethod {
  name: string;
  description?: HastRoot;
  descriptionText?: string;
  parameters: Record<string, FormattedParameter>;
  returnValue: string;
  returnValueDescription?: HastRoot;
  returnValueDescriptionText?: string;
  isStatic: boolean;
}

export interface FormatClassOptions {
  descriptionRemoveRegex?: RegExp;
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
}

/**
 * Formats class export data into a structured metadata object.
 *
 * @param classExport - The class export node from typescript-api-extractor
 * @param typeNameMap - Map for transforming type names
 * @param rewriteContext - Context for type string rewriting including type compatibility map
 * @param options - Formatting options
 * @returns Formatted class metadata with constructor and methods
 */
export async function formatClassData(
  classExport: tae.ExportNode,
  typeNameMap: Record<string, string>,
  rewriteContext: TypeRewriteContext,
  options: FormatClassOptions = {},
): Promise<ClassTypeMeta> {
  const { descriptionRemoveRegex = /\n\nDocumentation: .*$/m, formatting } = options;

  const { exportNames } = rewriteContext;

  // Cast to ClassNode since we've verified via isPublicClass
  const classType = classExport.type as unknown as ClassNode;

  const descriptionText = classExport.documentation?.description?.replace(
    descriptionRemoveRegex,
    '',
  );
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // Get the first construct signature for constructor parameters
  const constructSignature = classType.constructSignatures[0];
  const constructorParams = constructSignature?.parameters ?? [];

  const constructorParameters = await formatParameters(
    constructorParams,
    exportNames,
    typeNameMap,
    {
      formatting,
    },
  );

  // Format properties
  const propertyEntries = await Promise.all(
    classType.properties.map(async (prop) => {
      const propDescriptionText = prop.documentation?.description?.replace(
        descriptionRemoveRegex,
        '',
      );
      const propDescription = propDescriptionText
        ? await parseMarkdownToHast(propDescriptionText)
        : undefined;

      const typeText = formatType(prop.type, false, undefined, true, exportNames, typeNameMap);

      const formattedProperty: FormattedProperty = {
        name: prop.name,
        typeText,
        description: propDescription,
        descriptionText: propDescriptionText,
        optional: prop.optional,
        readonly: prop.readonly,
        isStatic: prop.isStatic ?? false,
      };

      return [prop.name, formattedProperty] as const;
    }),
  );

  const properties: Record<string, FormattedProperty> = Object.fromEntries(propertyEntries);

  // Format methods in parallel to avoid eslint no-await-in-loop
  const methodEntries = await Promise.all(
    classType.methods.map(async (method) => {
      const methodDescriptionText = method.documentation?.description?.replace(
        descriptionRemoveRegex,
        '',
      );
      const methodDescription = methodDescriptionText
        ? await parseMarkdownToHast(methodDescriptionText)
        : undefined;

      // Use the first call signature (we don't support overloads in docs yet)
      const signature = method.callSignatures?.[0];
      const methodParameters = await formatParameters(
        signature?.parameters ?? [],
        exportNames,
        typeNameMap,
        { formatting },
      );

      const returnValue = signature
        ? formatType(signature.returnValueType, false, undefined, true, exportNames, typeNameMap)
        : 'void';

      // Get return value description from @returns tag if available
      const returnsTag = method.documentation?.tags?.find(
        (tag: { name: string }) => tag.name === 'returns',
      );
      const returnValueDescriptionText = returnsTag?.value;
      const returnValueDescription = returnValueDescriptionText
        ? await parseMarkdownToHast(returnValueDescriptionText)
        : undefined;

      const formattedMethod: FormattedMethod = {
        name: method.name,
        description: methodDescription,
        descriptionText: methodDescriptionText,
        parameters: methodParameters,
        returnValue,
        returnValueDescription,
        returnValueDescriptionText,
        isStatic: method.isStatic ?? false,
      };

      return [method.name, formattedMethod] as const;
    }),
  );

  const methods: Record<string, FormattedMethod> = Object.fromEntries(methodEntries);

  // Extract type parameter names
  const typeParameters = classType.typeParameters?.map((tp) => tp.toString());

  const raw: ClassTypeMeta = {
    name: classExport.name,
    description,
    descriptionText,
    constructorParameters,
    properties,
    methods,
    typeParameters,
  };

  // Post-process type strings to align naming across re-exports
  return rewriteTypeStringsDeep(raw, rewriteContext);
}

/**
 * Type guard to check if an export node is a public class.
 *
 * @param exportNode - The export node to check
 * @returns true if the export is a public class that should be documented
 */
export function isPublicClass(exportNode: tae.ExportNode): boolean {
  const isPublic =
    exportNode.documentation?.visibility !== 'private' &&
    exportNode.documentation?.visibility !== 'internal';

  const hasIgnoreTag = exportNode.documentation?.tags?.some((tag) => tag.name === 'ignore');

  return isClassType(exportNode.type) && !hasIgnoreTag && isPublic;
}
