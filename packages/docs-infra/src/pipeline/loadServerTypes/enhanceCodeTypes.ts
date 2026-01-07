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
import type { FormattedProperty, FormattedParameter } from '../syncTypes/format';
import {
  formatInlineTypeAsHast,
  formatDetailedTypeAsHast,
  DEFAULT_UNION_PRINT_WIDTH,
  type FormatInlineTypeOptions,
} from './typeHighlighting';
import {
  getShortTypeFromHast,
  shouldShowDetailedTypeFromHast,
  replaceTypeReferences,
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
 * Enhanced parameter with syntax-highlighted HAST fields.
 */
export interface EnhancedParameter extends FormattedParameter {
  /** Syntax-highlighted type as HAST */
  type: HastRoot;
  /** Default value with syntax highlighting as HAST */
  default?: HastRoot;
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
 * Enhanced TypesMeta with highlighted type fields.
 */
export type EnhancedTypesMeta =
  | {
      type: 'component';
      name: string;
      data: EnhancedComponentTypeMeta;
    }
  | {
      type: 'hook';
      name: string;
      data: EnhancedHookTypeMeta;
    }
  | {
      type: 'other';
      name: string;
      data: any;
      reExportOf?: string;
    };

/**
 * Options for enhanceCodeTypes.
 */
export interface EnhanceCodeTypesOptions {
  /** Map of export names to their highlighted HAST definitions for type expansion */
  highlightedExports?: Record<string, HastRoot>;
  /** Options for inline type formatting */
  formatting?: FormatInlineTypeOptions;
}

/**
 * Enhances code types by converting plain text type strings to syntax-highlighted HAST.
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
export async function enhanceCodeTypes(
  variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }>,
  options: EnhanceCodeTypesOptions = {},
): Promise<Record<string, { types: EnhancedTypesMeta[]; typeNameMap?: Record<string, string> }>> {
  const { highlightedExports = {}, formatting } = options;

  const shortTypeUnionPrintWidth =
    formatting?.shortTypeUnionPrintWidth ?? DEFAULT_UNION_PRINT_WIDTH;
  const defaultValueUnionPrintWidth =
    formatting?.defaultValueUnionPrintWidth ?? DEFAULT_UNION_PRINT_WIDTH;

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
              ),
            };
          }
          return typeMeta;
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
): Promise<EnhancedComponentTypeMeta> {
  const enhancedPropsEntries = await Promise.all(
    Object.entries(data.props).map(async ([propName, prop]) => {
      const enhanced = await enhanceProperty(
        propName,
        prop,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
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
 * Enhances a single property with syntax-highlighted HAST.
 */
async function enhanceProperty(
  name: string,
  prop: FormattedProperty | FormattedParameter,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
): Promise<EnhancedProperty | EnhancedParameter> {
  // Convert typeText to highlighted HAST
  const type = await formatInlineTypeAsHast(prop.typeText);

  // Derive shortType from the highlighted HAST structure
  const shortTypeText = getShortTypeFromHast(name, type);
  const shortType = shortTypeText
    ? await formatInlineTypeAsHast(shortTypeText, shortTypeUnionPrintWidth)
    : undefined;

  // Generate detailedType if needed
  let detailedType: HastRoot | undefined;
  if (shouldShowDetailedTypeFromHast(name, type)) {
    // Create a detailed type with expanded references
    const expanded = replaceTypeReferences(type, highlightedExports);

    // Only include detailedType if it differs from the basic type
    // (i.e., if any references were actually expanded)
    const expandedText = JSON.stringify(expanded);
    const originalText = JSON.stringify(type);
    if (expandedText !== originalText) {
      // Use the detailed format (pre > code with line numbers)
      detailedType = await formatDetailedTypeAsHast(prop.typeText);
    }
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
