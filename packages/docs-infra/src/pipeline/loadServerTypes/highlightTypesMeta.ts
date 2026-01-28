/**
 * Enhanced code types processing for converting plain text types to syntax-highlighted HAST.
 *
 * This module runs after highlightTypes() in the loadServerTypes pipeline and:
 * 1. Converts typeText strings to syntax-highlighted HAST (type field)
 * 2. Derives shortType HAST from the highlighted type structure
 * 3. Generates detailedType HAST with expanded type references
 * 4. Converts defaultText to syntax-highlighted HAST (default field)
 */

import type { Root as HastRoot } from 'hast';
import type { TypesMeta } from '../syncTypes/syncTypes';
import type { ComponentTypeMeta } from '../syncTypes/formatComponent';
import type { HookTypeMeta } from '../syncTypes/formatHook';
import type { FunctionTypeMeta } from '../syncTypes/formatFunction';
import type {
  ClassTypeMeta,
  FormattedMethod,
  FormattedProperty as ClassFormattedProperty,
} from '../syncTypes/formatClass';
import type { RawTypeMeta, EnumMemberMeta } from '../syncTypes/formatRaw';
import { prettyFormat, type FormattedProperty, type FormattedParameter } from '../syncTypes/format';
import {
  formatInlineTypeAsHast,
  formatDetailedTypeAsHast,
  DEFAULT_UNION_PRINT_WIDTH,
  DEFAULT_DETAILED_TYPE_PRINT_WIDTH,
  type FormatInlineTypeOptions,
} from './typeHighlighting';
import {
  getShortTypeFromHast,
  shouldShowDetailedTypeFromHast,
  replaceTypeReferences,
  collectTypeReferences,
  getHastTextContent,
} from './hastTypeUtils';

/**
 * Enhanced property with syntax-highlighted HAST fields.
 */
export interface EnhancedProperty extends FormattedProperty {
  /** Syntax-highlighted type as HAST */
  type: HastRoot;
  /** Short simplified type for table display (e.g., "Union", "function") */
  shortType?: HastRoot;
  /** Plain text version of shortType for accessibility */
  shortTypeText?: string;
  /** Default value with syntax highlighting as HAST */
  default?: HastRoot;
  /** Detailed expanded type view (only when different from basic type) */
  detailedType?: HastRoot;
}

/**
 * Enhanced class property with syntax-highlighted HAST fields.
 * Extends EnhancedProperty with class-specific modifiers.
 */
export interface EnhancedClassProperty extends EnhancedProperty {
  /** Whether this is a static property */
  isStatic?: boolean;
  /** Whether this property is readonly */
  readonly?: boolean;
}

/**
 * Enhanced parameter with syntax-highlighted HAST fields.
 */
export interface EnhancedParameter extends FormattedParameter {
  /** Syntax-highlighted type as HAST */
  type: HastRoot;
  /** Default value with syntax highlighting as HAST */
  default?: HastRoot;
  /** Detailed type with expanded type references as HAST */
  detailedType?: HastRoot;
}

/**
 * Enhanced component type metadata with highlighted types.
 */
export interface EnhancedComponentTypeMeta extends Omit<ComponentTypeMeta, 'props'> {
  props: Record<string, EnhancedProperty>;
}

/**
 * Enhanced hook type metadata with highlighted types.
 */
export interface EnhancedHookTypeMeta extends Omit<HookTypeMeta, 'parameters' | 'returnValue'> {
  parameters: Record<string, EnhancedParameter | EnhancedProperty>;
  returnValue: Record<string, EnhancedProperty> | HastRoot;
}

/**
 * Enhanced function type metadata with highlighted types.
 */
export interface EnhancedFunctionTypeMeta extends Omit<
  FunctionTypeMeta,
  'parameters' | 'returnValue'
> {
  parameters: Record<string, EnhancedParameter>;
  returnValue: HastRoot;
}

/**
 * Enhanced method with syntax-highlighted HAST fields.
 */
export interface EnhancedMethod extends Omit<
  FormattedMethod,
  'parameters' | 'returnValue' | 'returnValueDescription'
> {
  parameters: Record<string, EnhancedParameter>;
  returnValue: HastRoot;
  returnValueDescription?: HastRoot;
}

/**
 * Enhanced class type metadata with highlighted types.
 */
export interface EnhancedClassTypeMeta extends Omit<
  ClassTypeMeta,
  'constructorParameters' | 'properties' | 'methods'
> {
  constructorParameters: Record<string, EnhancedParameter>;
  properties: Record<string, EnhancedClassProperty>;
  methods: Record<string, EnhancedMethod>;
}

/**
 * Enhanced enum member with syntax-highlighted HAST fields.
 */
export interface EnhancedEnumMemberMeta extends Omit<EnumMemberMeta, 'description'> {
  /** Description with syntax highlighting as HAST */
  description?: HastRoot;
}

/**
 * Enhanced raw type metadata with syntax-highlighted HAST fields.
 */
export interface EnhancedRawTypeMeta extends Omit<
  RawTypeMeta,
  'description' | 'formattedCode' | 'enumMembers'
> {
  /** Description with syntax highlighting as HAST */
  description?: HastRoot;
  /** The formatted type declaration as syntax-highlighted HAST */
  formattedCode: HastRoot;
  /** For enum types, the individual members with their values and descriptions */
  enumMembers?: EnhancedEnumMemberMeta[];
}

/**
 * Enhanced TypesMeta with highlighted type fields.
 */
export type EnhancedTypesMeta =
  | {
      type: 'component';
      name: string;
      /** The anchor slug for linking to this type (e.g., "trigger" or "trigger.state") */
      slug?: string;
      data: EnhancedComponentTypeMeta;
    }
  | {
      type: 'hook';
      name: string;
      /** The anchor slug for linking to this type (e.g., "usescrolllock") */
      slug?: string;
      data: EnhancedHookTypeMeta;
    }
  | {
      type: 'function';
      name: string;
      /** The anchor slug for linking to this type (e.g., "createtheme") */
      slug?: string;
      data: EnhancedFunctionTypeMeta;
    }
  | {
      type: 'class';
      name: string;
      /** The anchor slug for linking to this type (e.g., "handle") */
      slug?: string;
      data: EnhancedClassTypeMeta;
    }
  | {
      type: 'raw';
      name: string;
      /** The anchor slug for linking to this type (e.g., "trigger.props") */
      slug?: string;
      data: EnhancedRawTypeMeta;
    };

/**
 * Options for highlightTypesMeta.
 */
export interface HighlightTypesMetaOptions {
  /** Map of export names to their highlighted HAST definitions for type expansion */
  highlightedExports?: Record<string, HastRoot>;
  /** Options for inline type formatting */
  formatting?: FormatInlineTypeOptions;
}

/**
 * Highlights TypesMeta by converting plain text type strings to syntax-highlighted HAST.
 *
 * This function processes all TypesMeta objects and:
 * - Converts typeText → type (HAST)
 * - Derives shortType from the highlighted HAST structure
 * - Generates detailedType with expanded references
 * - Converts defaultText → default (HAST)
 *
 * @param variantData - Variant data with plain text type fields
 * @param options - Options including highlightedExports map for type expansion
 * @returns Enhanced variant data with HAST type fields
 */
export async function highlightTypesMeta(
  variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }>,
  options: HighlightTypesMetaOptions = {},
): Promise<Record<string, { types: EnhancedTypesMeta[]; typeNameMap?: Record<string, string> }>> {
  const { highlightedExports = {}, formatting } = options;

  const shortTypeUnionPrintWidth =
    formatting?.shortTypeUnionPrintWidth ?? DEFAULT_UNION_PRINT_WIDTH;
  const defaultValueUnionPrintWidth =
    formatting?.defaultValueUnionPrintWidth ?? DEFAULT_UNION_PRINT_WIDTH;
  const detailedTypePrintWidth =
    formatting?.detailedTypePrintWidth ?? DEFAULT_DETAILED_TYPE_PRINT_WIDTH;

  const enhancedEntries = await Promise.all(
    Object.entries(variantData).map(async ([variantName, variant]) => {
      const enhancedTypes = await Promise.all(
        variant.types.map(async (typeMeta): Promise<EnhancedTypesMeta> => {
          if (typeMeta.type === 'component') {
            return {
              ...typeMeta,
              data: await enhanceComponentType(
                typeMeta.data,
                highlightedExports,
                shortTypeUnionPrintWidth,
                defaultValueUnionPrintWidth,
                detailedTypePrintWidth,
              ),
            };
          }
          if (typeMeta.type === 'hook') {
            return {
              ...typeMeta,
              data: await enhanceHookType(
                typeMeta.data,
                highlightedExports,
                shortTypeUnionPrintWidth,
                defaultValueUnionPrintWidth,
                detailedTypePrintWidth,
              ),
            };
          }
          if (typeMeta.type === 'function') {
            return {
              ...typeMeta,
              data: await enhanceFunctionType(
                typeMeta.data,
                highlightedExports,
                shortTypeUnionPrintWidth,
                defaultValueUnionPrintWidth,
                detailedTypePrintWidth,
              ),
            };
          }
          if (typeMeta.type === 'class') {
            return {
              ...typeMeta,
              data: await enhanceClassType(
                typeMeta.data,
                highlightedExports,
                shortTypeUnionPrintWidth,
                defaultValueUnionPrintWidth,
                detailedTypePrintWidth,
              ),
            };
          }
          if (typeMeta.type === 'raw') {
            return {
              ...typeMeta,
              data: await enhanceRawType(typeMeta.data),
            };
          }
          // This should never happen, but TypeScript needs exhaustive checking
          return typeMeta satisfies never;
        }),
      );

      return [variantName, { types: enhancedTypes, typeNameMap: variant.typeNameMap }] as const;
    }),
  );

  return Object.fromEntries(enhancedEntries);
}

/**
 * Enhances a component's type metadata with syntax-highlighted HAST.
 */
async function enhanceComponentType(
  data: ComponentTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  detailedTypePrintWidth: number,
): Promise<EnhancedComponentTypeMeta> {
  const enhancedPropsEntries = await Promise.all(
    Object.entries(data.props).map(async ([propName, prop]) => {
      const enhanced = await enhanceProperty(
        propName,
        prop,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
        detailedTypePrintWidth,
      );
      return [propName, enhanced] as const;
    }),
  );

  return {
    ...data,
    props: Object.fromEntries(enhancedPropsEntries),
  };
}

/**
 * Enhances a hook's type metadata with syntax-highlighted HAST.
 */
async function enhanceHookType(
  data: HookTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  detailedTypePrintWidth: number,
): Promise<EnhancedHookTypeMeta> {
  // Enhance parameters
  const enhancedParametersEntries = await Promise.all(
    Object.entries(data.parameters).map(async ([paramName, param]) => {
      // Parameters can be either FormattedParameter or FormattedProperty
      const enhanced = await enhanceProperty(
        paramName,
        param as FormattedProperty,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
        detailedTypePrintWidth,
      );
      return [paramName, enhanced] as const;
    }),
  );

  // Enhance returnValue
  let enhancedReturnValue: Record<string, EnhancedProperty> | HastRoot;
  if (typeof data.returnValue === 'string') {
    // It's a plain text type string - convert to HAST
    enhancedReturnValue = await formatInlineTypeAsHast(data.returnValue);
  } else {
    // It's an object with FormattedProperty values
    const returnValueEntries = await Promise.all(
      Object.entries(data.returnValue as Record<string, FormattedProperty>).map(
        async ([propName, prop]) => {
          const enhanced = await enhanceProperty(
            propName,
            prop,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            detailedTypePrintWidth,
          );
          return [propName, enhanced] as const;
        },
      ),
    );
    enhancedReturnValue = Object.fromEntries(returnValueEntries);
  }

  return {
    ...data,
    parameters: Object.fromEntries(enhancedParametersEntries),
    returnValue: enhancedReturnValue,
  };
}

/**
 * Enhances a function's type metadata with syntax-highlighted HAST.
 */
async function enhanceFunctionType(
  data: FunctionTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  detailedTypePrintWidth: number,
): Promise<EnhancedFunctionTypeMeta> {
  // Enhance parameters
  const enhancedParametersEntries = await Promise.all(
    Object.entries(data.parameters).map(async ([paramName, param]) => {
      const enhanced = await enhanceProperty(
        paramName,
        param,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
        detailedTypePrintWidth,
      );
      return [paramName, enhanced] as const;
    }),
  );

  // Enhance returnValue - always a string type for functions
  const enhancedReturnValue = await formatInlineTypeAsHast(data.returnValue);

  return {
    ...data,
    parameters: Object.fromEntries(enhancedParametersEntries) as Record<string, EnhancedParameter>,
    returnValue: enhancedReturnValue,
  };
}

/**
 * Enhances a class's type metadata with syntax-highlighted HAST.
 */
async function enhanceClassType(
  data: ClassTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  detailedTypePrintWidth: number,
): Promise<EnhancedClassTypeMeta> {
  // Enhance constructor parameters
  const enhancedParametersEntries = await Promise.all(
    Object.entries(data.constructorParameters).map(async ([paramName, param]) => {
      const enhanced = await enhanceProperty(
        paramName,
        param,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
        detailedTypePrintWidth,
      );
      return [paramName, enhanced] as const;
    }),
  );

  // Enhance properties
  const enhancedPropertiesEntries = await Promise.all(
    Object.entries(data.properties).map(async ([propName, prop]) => {
      const enhanced = await enhanceClassProperty(
        propName,
        prop,
        highlightedExports,
        shortTypeUnionPrintWidth,
        detailedTypePrintWidth,
      );
      return [propName, enhanced] as const;
    }),
  );

  // Enhance methods
  const enhancedMethodsEntries = await Promise.all(
    Object.entries(data.methods).map(async ([methodName, method]) => {
      // Enhance method parameters
      const enhancedMethodParams = await Promise.all(
        Object.entries(method.parameters).map(async ([paramName, param]) => {
          const enhanced = await enhanceProperty(
            paramName,
            param,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            detailedTypePrintWidth,
          );
          return [paramName, enhanced] as const;
        }),
      );

      // Enhance return value
      const enhancedReturnValue = await formatInlineTypeAsHast(method.returnValue);

      const enhancedMethod: EnhancedMethod = {
        ...method,
        parameters: Object.fromEntries(enhancedMethodParams) as Record<string, EnhancedParameter>,
        returnValue: enhancedReturnValue,
      };
      return [methodName, enhancedMethod] as const;
    }),
  );

  return {
    ...data,
    constructorParameters: Object.fromEntries(enhancedParametersEntries) as Record<
      string,
      EnhancedParameter
    >,
    properties: Object.fromEntries(enhancedPropertiesEntries) as Record<string, EnhancedProperty>,
    methods: Object.fromEntries(enhancedMethodsEntries) as Record<string, EnhancedMethod>,
  };
}

/**
 * Enhances a single property with syntax-highlighted HAST.
 */
async function enhanceProperty(
  name: string,
  prop: FormattedProperty | FormattedParameter,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  detailedTypePrintWidth: number,
): Promise<EnhancedProperty | EnhancedParameter> {
  // For shortType derivation, strip trailing `| undefined` from optional props
  // since required/optional status is shown separately (required props have *)
  const isOptional = !('required' in prop && prop.required);
  const strippedUndefined = isOptional && prop.typeText.endsWith(' | undefined');
  const shortTypeInputText = strippedUndefined
    ? prop.typeText.slice(0, -' | undefined'.length)
    : prop.typeText;
  const shortTypeInput = await formatInlineTypeAsHast(shortTypeInputText);

  // Derive shortType from the highlighted HAST structure (without | undefined for optional)
  // If we stripped | undefined, we need a shortType so the UI shows the clean version
  const derivedShortType = getShortTypeFromHast(name, shortTypeInput);
  const shortTypeText = derivedShortType ?? (strippedUndefined ? shortTypeInputText : undefined);
  const shortType = shortTypeText
    ? await formatInlineTypeAsHast(shortTypeText, shortTypeUnionPrintWidth)
    : undefined;

  // Generate detailedType if needed
  // Two cases:
  // 1. The prop name/type triggers detailed display (e.g., event handlers, className)
  // 2. There are type references that can be expanded from highlightedExports (e.g., external types)
  let detailedType: HastRoot | undefined;

  // First, check if any type references can be expanded
  // Reuse shortTypeInput if we didn't strip | undefined, otherwise format the full typeText
  const typeForExpansion = strippedUndefined
    ? await formatInlineTypeAsHast(prop.typeText)
    : shortTypeInput;
  const typeRefs = collectTypeReferences(typeForExpansion);
  const hasExpandableRefs = typeRefs.some((ref) => highlightedExports[ref.name] !== undefined);

  if (shouldShowDetailedTypeFromHast(name, shortTypeInput) || hasExpandableRefs) {
    // Create a detailed type with expanded references
    const expanded = replaceTypeReferences(typeForExpansion, highlightedExports);

    // Only include detailedType if it differs from the basic type
    // (i.e., if any references were actually expanded to different text)
    const expandedText = getHastTextContent(expanded);
    const originalText = getHastTextContent(typeForExpansion);
    if (expandedText !== originalText) {
      // Format expanded type with prettier before highlighting
      let formattedExpandedText = await prettyFormat(
        expandedText,
        undefined,
        detailedTypePrintWidth,
      );
      // Strip trailing semicolon added by prettier
      if (formattedExpandedText.endsWith(';')) {
        formattedExpandedText = formattedExpandedText.slice(0, -1);
      }
      // Use the detailed format (pre > code with line numbers)
      detailedType = await formatDetailedTypeAsHast(formattedExpandedText);
    }
  }

  // Convert typeText to highlighted HAST
  // If no detailedType exists but the type needs detailed display, format with prettier
  // and use block-level format (pre > code) since prettier output is multiline
  let type: HastRoot;
  if (!detailedType && shouldShowDetailedTypeFromHast(name, shortTypeInput)) {
    let formattedTypeText = await prettyFormat(prop.typeText, undefined, detailedTypePrintWidth);
    // Strip trailing semicolon added by prettier
    if (formattedTypeText.endsWith(';')) {
      formattedTypeText = formattedTypeText.slice(0, -1);
    }
    type = await formatDetailedTypeAsHast(formattedTypeText);
  } else {
    type = await formatInlineTypeAsHast(prop.typeText);
  }

  // Convert defaultText to highlighted HAST
  const defaultValue = prop.defaultText
    ? await formatInlineTypeAsHast(prop.defaultText, defaultValueUnionPrintWidth)
    : undefined;

  const enhanced: EnhancedProperty = {
    ...prop,
    type,
  };

  if (shortType && shortTypeText) {
    enhanced.shortType = shortType;
    enhanced.shortTypeText = shortTypeText;
  }

  if (defaultValue) {
    enhanced.default = defaultValue;
  }

  if (detailedType) {
    enhanced.detailedType = detailedType;
  }

  return enhanced;
}

/**
 * Enhances a class property with syntax-highlighted HAST.
 * Class properties have a different structure than component props.
 */
async function enhanceClassProperty(
  name: string,
  prop: ClassFormattedProperty,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  detailedTypePrintWidth: number,
): Promise<EnhancedClassProperty> {
  // For shortType derivation, strip trailing `| undefined` from optional props
  const strippedUndefined = prop.optional && prop.typeText.endsWith(' | undefined');
  const shortTypeInputText = strippedUndefined
    ? prop.typeText.slice(0, -' | undefined'.length)
    : prop.typeText;
  const shortTypeInput = await formatInlineTypeAsHast(shortTypeInputText);

  // Derive shortType from the highlighted HAST structure
  const derivedShortType = getShortTypeFromHast(name, shortTypeInput);
  const shortTypeText = derivedShortType ?? (strippedUndefined ? shortTypeInputText : undefined);
  const shortType = shortTypeText
    ? await formatInlineTypeAsHast(shortTypeText, shortTypeUnionPrintWidth)
    : undefined;

  // Generate detailedType if needed
  let detailedType: HastRoot | undefined;
  const typeForExpansion = strippedUndefined
    ? await formatInlineTypeAsHast(prop.typeText)
    : shortTypeInput;
  const typeRefs = collectTypeReferences(typeForExpansion);
  const hasExpandableRefs = typeRefs.some((ref) => highlightedExports[ref.name] !== undefined);

  if (shouldShowDetailedTypeFromHast(name, shortTypeInput) || hasExpandableRefs) {
    const expanded = replaceTypeReferences(typeForExpansion, highlightedExports);
    const expandedText = getHastTextContent(expanded);
    const originalText = getHastTextContent(typeForExpansion);
    if (expandedText !== originalText) {
      let formattedExpandedText = await prettyFormat(
        expandedText,
        `detailed_${name}`,
        detailedTypePrintWidth,
      );
      if (formattedExpandedText.endsWith(';')) {
        formattedExpandedText = formattedExpandedText.slice(0, -1);
      }
      detailedType = await formatDetailedTypeAsHast(formattedExpandedText);
    }
  }

  // Format the base type
  const type = await formatInlineTypeAsHast(prop.typeText);

  const enhanced: EnhancedClassProperty = {
    typeText: prop.typeText,
    type,
  };

  if (!prop.optional) {
    enhanced.required = true;
  }

  if (prop.descriptionText) {
    enhanced.descriptionText = prop.descriptionText;
  }
  if (prop.description) {
    enhanced.description = prop.description;
  }

  if (shortType && shortTypeText) {
    enhanced.shortType = shortType;
    enhanced.shortTypeText = shortTypeText;
  }

  if (detailedType) {
    enhanced.detailedType = detailedType;
  }

  // Propagate class-specific fields
  if (prop.isStatic) {
    enhanced.isStatic = prop.isStatic;
  }
  if (prop.readonly) {
    enhanced.readonly = prop.readonly;
  }

  return enhanced;
}

/**
 * Enhances a raw type's metadata with syntax-highlighted HAST.
 * Converts the formattedCode string to highlighted HAST.
 */
async function enhanceRawType(data: RawTypeMeta): Promise<EnhancedRawTypeMeta> {
  // Highlight the formattedCode string as TypeScript
  const formattedCodeHast = await formatDetailedTypeAsHast(data.formattedCode);

  // Enhance enum members if present
  const enhancedEnumMembers = data.enumMembers
    ? data.enumMembers.map(
        (member): EnhancedEnumMemberMeta => ({
          ...member,
          // description is already HastRoot from formatRawData
        }),
      )
    : undefined;

  return {
    ...data,
    formattedCode: formattedCodeHast,
    enumMembers: enhancedEnumMembers,
  };
}
