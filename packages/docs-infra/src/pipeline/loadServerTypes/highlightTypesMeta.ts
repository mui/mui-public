/**
 * Highlighted code types processing for converting plain text types to syntax-highlighted HAST.
 *
 * This module runs after highlightTypes() in the loadServerTypes pipeline and:
 * 1. Converts typeText strings to syntax-highlighted HAST (type field)
 * 2. Derives shortType HAST from the highlighted type structure
 * 3. Generates detailedType HAST with expanded type references
 * 4. Converts defaultText to syntax-highlighted HAST (default field)
 */

import type { Root as HastRoot } from 'hast';
import { unified } from 'unified';
import { transformHtmlCodeBlock } from '../transformHtmlCodeBlock/transformHtmlCodeBlock';
import transformHtmlCodeInline from '../transformHtmlCodeInline';
import {
  type TypesMeta,
  type ComponentTypeMeta,
  type HookTypeMeta,
  type FunctionTypeMeta,
  type ClassTypeMeta,
  type RawTypeMeta,
  type FormattedProperty,
  type FormattedParameter,
} from '../loadServerTypesMeta';
import { prettyFormat, parseMarkdownToHast } from '../loadServerTypesMeta/format';
import type {
  FormattedProperty as ClassFormattedProperty,
  FormattedMethod,
} from '../loadServerTypesMeta/formatClass';
import type { EnumMemberMeta } from '../loadServerTypesMeta/formatRaw';
import {
  formatInlineTypeAsHast,
  formatDetailedTypeAsHast,
  wrapInlineTypeInPre,
  DEFAULT_UNION_PRINT_WIDTH,
  DEFAULT_TYPE_PRINT_WIDTH,
  type FormatInlineTypeOptions,
} from './typeHighlighting';
import {
  getShortTypeFromHast,
  shouldShowDetailedTypeFromHast,
  replaceTypeReferences,
  collectTypeReferences,
  getHastTextContent,
  resolveSerializer,
  type SerializedHastRoot,
  type SerializedHastGzip,
  type TypesOutputFormat,
} from './hastTypeUtils';
import { extractTypeProps as extractTypePropsFromCode } from './extractTypeProps';

/** A HAST root or its serialized/compressed wrapper. */
type HastField = HastRoot | SerializedHastRoot | SerializedHastGzip;

/**
 * Strips generic type arguments from a type string.
 * e.g., `useRender.Parameters<Record<string, unknown>, Element>` → `useRender.Parameters`
 */
function stripGenericArgs(typeText: string): string {
  const idx = typeText.indexOf('<');
  return idx === -1 ? typeText : typeText.slice(0, idx);
}

/**
 * Looks up a type name in rawTypeProperties, falling back to stripping
 * generic arguments when an exact match isn't found.
 */
function lookupRawTypeProperties(
  typeText: string,
  rawTypeProperties: Record<string, Record<string, FormattedProperty>>,
): { name: string; properties: Record<string, FormattedProperty> } | undefined {
  const exact = rawTypeProperties[typeText];
  if (exact && Object.keys(exact).length > 0) {
    return { name: typeText, properties: exact };
  }
  const stripped = stripGenericArgs(typeText);
  if (stripped !== typeText) {
    const fallback = rawTypeProperties[stripped];
    if (fallback && Object.keys(fallback).length > 0) {
      return { name: stripped, properties: fallback };
    }
  }
  return undefined;
}

/** A FormattedProperty where description/example may have been pre-serialized. */
type PreProcessedProperty = Omit<FormattedProperty, 'description' | 'example'> & {
  description?: HastField;
  example?: HastField;
};

/**
 * Processes raw type properties' `description` and `example` HAST through
 * `transformHtmlCodeBlock` and `transformHtmlCodeInline`.
 *
 * Raw type properties skip `highlightTypes` (which only handles component/hook/function types),
 * so their HAST fields need processing when they're expanded into a props table.
 *
 * Returns new property objects — does not mutate the originals (they may be
 * reused across multiple expansion sites).
 */
async function highlightRawProperties(
  properties: Record<string, FormattedProperty>,
  output: TypesOutputFormat,
): Promise<Record<string, PreProcessedProperty>> {
  const s = resolveSerializer(output);
  const processor = unified().use(transformHtmlCodeInline).use(transformHtmlCodeBlock);

  const entries = await Promise.all(
    Object.entries(properties).map(async ([name, prop]) => {
      const [description, example] = await Promise.all([
        prop.description
          ? (processor.run(prop.description) as Promise<HastRoot>).then((h) => s(h))
          : undefined,
        prop.example
          ? (processor.run(prop.example) as Promise<HastRoot>).then((h) => s(h))
          : undefined,
      ]);
      return [
        name,
        {
          ...prop,
          ...(description !== undefined && { description }),
          ...(example !== undefined && { example }),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, PreProcessedProperty>;
}

/**
 * Highlighted property with syntax-highlighted HAST fields.
 */
export interface HighlightedProperty extends Omit<
  FormattedProperty,
  'description' | 'example' | 'see'
> {
  /** Description with syntax highlighting as HAST */
  description?: HastField;
  /** Example with syntax highlighting as HAST */
  example?: HastField;
  /** See-also links as HAST */
  see?: HastField;
  /** Syntax-highlighted type as HAST */
  type: HastField;
  /** Short simplified type for table display (e.g., "Union", "function") */
  shortType?: HastField;
  /** Plain text version of shortType for accessibility */
  shortTypeText?: string;
  /** Default value with syntax highlighting as HAST */
  default?: HastField;
  /** Detailed expanded type view (only when different from basic type) */
  detailedType?: HastField;
}

/**
 * Highlighted class property with syntax-highlighted HAST fields.
 * Extends HighlightedProperty with class-specific modifiers.
 */
export interface HighlightedClassProperty extends HighlightedProperty {
  /** Whether this is a static property */
  isStatic?: boolean;
  /** Whether this property is readonly */
  readonly?: boolean;
}

/**
 * Highlighted parameter with syntax-highlighted HAST fields.
 */
export interface HighlightedParameter extends Omit<
  FormattedParameter,
  'description' | 'example' | 'see'
> {
  /** Description with syntax highlighting as HAST */
  description?: HastField;
  /** Example with syntax highlighting as HAST */
  example?: HastField;
  /** See-also links as HAST */
  see?: HastField;
  /** Syntax-highlighted type as HAST */
  type: HastField;
  /** Short simplified type for table display (e.g., "Union", "function") */
  shortType?: HastField;
  /** Plain text version of shortType for accessibility */
  shortTypeText?: string;
  /** Default value with syntax highlighting as HAST */
  default?: HastField;
  /** Detailed type with expanded type references as HAST */
  detailedType?: HastField;
}

/**
 * Highlighted component type metadata with highlighted types.
 */
export interface HighlightedComponentTypeMeta extends Omit<ComponentTypeMeta, 'props'> {
  props: Record<string, HighlightedProperty>;
}

/**
 * Highlighted hook type metadata with highlighted types.
 */
export interface HighlightedHookTypeMeta extends Omit<
  HookTypeMeta,
  'parameters' | 'expandedProperties' | 'returnValue' | 'returnValueDescription'
> {
  parameters?: HighlightedParameter[];
  returnValue: Record<string, HighlightedProperty> | HastField;
  /** Expanded return type with resolved type references (only when returnValue is HastRoot) */
  returnValueDetailedType?: HastField;
  /** Description of the return value as HAST */
  returnValueDescription?: HastField;
  /** Original type name when return value was expanded from a named type reference */
  returnValueTypeName?: string;
  /** Expanded properties from a single-parameter type (anonymous or named) */
  expandedProperties?: Record<string, HighlightedProperty>;
  /** Type name of the expanded properties, when they came from a named type reference */
  expandedTypeName?: string;
}

/**
 * Highlighted function type metadata with highlighted types.
 */
export interface HighlightedFunctionTypeMeta extends Omit<
  FunctionTypeMeta,
  'parameters' | 'expandedProperties' | 'returnValue' | 'returnValueDescription'
> {
  parameters?: HighlightedParameter[];
  returnValue: Record<string, HighlightedProperty> | HastField;
  /** Expanded return type with resolved type references (only when returnValue is HastRoot) */
  returnValueDetailedType?: HastField;
  /** Description of the return value as HAST */
  returnValueDescription?: HastField;
  /** Original type name when return value was expanded from a named type reference */
  returnValueTypeName?: string;
  /** Expanded properties from a single-parameter type (anonymous or named) */
  expandedProperties?: Record<string, HighlightedProperty>;
  /** Type name of the expanded properties, when they came from a named type reference */
  expandedTypeName?: string;
}

/**
 * Highlighted method with syntax-highlighted HAST fields.
 */
export interface HighlightedMethod extends Omit<
  FormattedMethod,
  'parameters' | 'returnValue' | 'returnValueDescription' | 'description'
> {
  /** Description with syntax highlighting as HAST */
  description?: HastField;
  parameters: HighlightedParameter[];
  returnValue: HastField;
  returnValueDescription?: HastField;
}

/**
 * Highlighted class type metadata with highlighted types.
 */
export interface HighlightedClassTypeMeta extends Omit<
  ClassTypeMeta,
  'constructorParameters' | 'properties' | 'methods' | 'description'
> {
  /** Description with syntax highlighting as HAST */
  description?: HastField;
  constructorParameters: HighlightedParameter[];
  properties: Record<string, HighlightedClassProperty>;
  methods: Record<string, HighlightedMethod>;
}

/**
 * Highlighted enum member with syntax-highlighted HAST fields.
 */
export interface HighlightedEnumMemberMeta extends Omit<EnumMemberMeta, 'description'> {
  /** Description with syntax highlighting as HAST */
  description?: HastField;
}

/**
 * Highlighted raw type metadata with syntax-highlighted HAST fields.
 */
export interface HighlightedRawTypeMeta extends Omit<
  RawTypeMeta,
  'description' | 'formattedCode' | 'enumMembers' | 'properties'
> {
  /** Description with syntax highlighting as HAST */
  description?: HastField;
  /** The formatted type declaration as syntax-highlighted HAST */
  formattedCode: HastField;
  /** For enum types, the individual members with their values and descriptions */
  enumMembers?: HighlightedEnumMemberMeta[];
  /**
   * Highlighted properties extracted from the type.
   * JSDoc comments are extracted from the formattedCode via `extractTypeProps`
   * and added here with syntax-highlighted HAST fields.
   * Property paths use dot-notation for nested objects (e.g., `appearance.theme`).
   */
  properties?: Record<string, HighlightedProperty>;
}

/**
 * Highlighted TypesMeta with highlighted type fields.
 */
export type HighlightedTypesMeta =
  | {
      type: 'component';
      name: string;
      /** The anchor slug for linking to this type (e.g., "trigger" or "trigger.state") */
      slug?: string;
      /** Alternative names this type can be looked up by (e.g., flat export name like "AccordionRootProps") */
      aliases?: string[];
      data: HighlightedComponentTypeMeta;
    }
  | {
      type: 'hook';
      name: string;
      /** The anchor slug for linking to this type (e.g., "usescrolllock") */
      slug?: string;
      /** Alternative names this type can be looked up by */
      aliases?: string[];
      data: HighlightedHookTypeMeta;
    }
  | {
      type: 'function';
      name: string;
      /** The anchor slug for linking to this type (e.g., "createtheme") */
      slug?: string;
      /** Alternative names this type can be looked up by */
      aliases?: string[];
      data: HighlightedFunctionTypeMeta;
    }
  | {
      type: 'class';
      name: string;
      /** The anchor slug for linking to this type (e.g., "handle") */
      slug?: string;
      /** Alternative names this type can be looked up by */
      aliases?: string[];
      data: HighlightedClassTypeMeta;
    }
  | {
      type: 'raw';
      name: string;
      /** The anchor slug for linking to this type (e.g., "trigger.props") */
      slug?: string;
      /** Alternative names this type can be looked up by (e.g., flat export name like "AccordionRootState") */
      aliases?: string[];
      data: HighlightedRawTypeMeta;
    };

/**
 * Options for highlightTypesMeta.
 */
export interface HighlightTypesMetaOptions {
  /** Map of export names to their highlighted HAST definitions for type expansion */
  highlightedExports?: Record<string, HastRoot>;
  /** Map of type names to their structured properties from raw types */
  rawTypeProperties?: Record<string, Record<string, FormattedProperty>>;
  /** Options for inline type formatting */
  formatting?: FormatInlineTypeOptions;
  /**
   * When true, replaces every HastRoot field in the output with
   * `{ hastJson: string }` (typed as HastRoot to keep the interface stable).
   * This defers tree allocation to render time and provides a free deep clone
   * via `JSON.parse`, eliminating the need for `structuredClone`.
   */
  output?: TypesOutputFormat;
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
 * @param types - Types array with plain text type fields
 * @param options - Options including highlightedExports map for type expansion
 * @returns Highlighted types array with HAST type fields
 */
export async function highlightTypesMeta(
  types: TypesMeta[],
  options: HighlightTypesMetaOptions = {},
): Promise<HighlightedTypesMeta[]> {
  const { highlightedExports = {}, rawTypeProperties = {}, formatting } = options;

  const shortTypeUnionPrintWidth =
    formatting?.shortTypeUnionPrintWidth ?? DEFAULT_UNION_PRINT_WIDTH;
  const defaultValueUnionPrintWidth =
    formatting?.defaultValueUnionPrintWidth ?? DEFAULT_UNION_PRINT_WIDTH;
  const typePrintWidth = formatting?.typePrintWidth ?? DEFAULT_TYPE_PRINT_WIDTH;
  const topLevelTypePrintWidth = formatting?.topLevelTypePrintWidth;
  const output = options.output ?? 'hast';

  const highlightedTypes = await Promise.all(
    types.map(async (typeMeta): Promise<HighlightedTypesMeta> => {
      if (typeMeta.type === 'component') {
        return {
          ...typeMeta,
          data: await highlightComponentTypeMeta(
            typeMeta.data,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            output,
          ),
        };
      }
      if (typeMeta.type === 'hook') {
        return {
          ...typeMeta,
          data: await highlightHookTypeMeta(
            typeMeta.data,
            highlightedExports,
            rawTypeProperties,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            topLevelTypePrintWidth,
            output,
          ),
        };
      }
      if (typeMeta.type === 'function') {
        return {
          ...typeMeta,
          data: await highlightFunctionTypeMeta(
            typeMeta.data,
            highlightedExports,
            rawTypeProperties,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            topLevelTypePrintWidth,
            output,
          ),
        };
      }
      if (typeMeta.type === 'class') {
        return {
          ...typeMeta,
          data: await highlightClassTypeMeta(
            typeMeta.data,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            topLevelTypePrintWidth,
            output,
          ),
        };
      }
      if (typeMeta.type === 'raw') {
        return {
          ...typeMeta,
          data: await highlightRawTypeMeta(
            typeMeta.data,
            highlightedExports,
            typePrintWidth,
            topLevelTypePrintWidth,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            output,
          ),
        };
      }
      // This should never happen, but TypeScript needs exhaustive checking
      return typeMeta satisfies never;
    }),
  );

  return highlightedTypes;
}

/**
 * Highlights a component's type metadata with syntax-highlighted HAST.
 */
async function highlightComponentTypeMeta(
  data: ComponentTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  typePrintWidth: number,
  output: TypesOutputFormat,
): Promise<HighlightedComponentTypeMeta> {
  const highlightedPropsEntries = await Promise.all(
    Object.entries(data.props).map(async ([propName, prop]) => {
      const highlighted = await highlightPropertyMeta(
        propName,
        prop,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
        typePrintWidth,
        output,
      );
      return [propName, highlighted] as const;
    }),
  );

  return {
    ...data,
    props: Object.fromEntries(highlightedPropsEntries),
  };
}

/**
 * Highlights a hook's type metadata with syntax-highlighted HAST.
 */
async function highlightHookTypeMeta(
  data: HookTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  rawTypeProperties: Record<string, Record<string, FormattedProperty>>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  typePrintWidth: number,
  topLevelTypePrintWidth: number | undefined,
  output: TypesOutputFormat,
): Promise<HighlightedHookTypeMeta> {
  const s = resolveSerializer(output);

  // Highlight parameters or expanded properties
  let highlightedParameters: HighlightedParameter[] | undefined;
  let expandedProperties: Record<string, HighlightedProperty> | undefined;
  let expandedTypeName: string | undefined;

  if (data.expandedProperties) {
    // Anonymous object parameter was expanded at format time
    const expandedEntries = await Promise.all(
      Object.entries(data.expandedProperties).map(async ([propName, prop]) => {
        const highlighted = await highlightPropertyMeta(
          propName,
          prop,
          highlightedExports,
          shortTypeUnionPrintWidth,
          defaultValueUnionPrintWidth,
          typePrintWidth,
          output,
        );
        return [propName, highlighted] as const;
      }),
    );
    expandedProperties = Object.fromEntries(expandedEntries);
  } else if (data.parameters) {
    // Highlight each parameter
    highlightedParameters = await Promise.all(
      data.parameters.map(async (param) => {
        const highlighted = await highlightPropertyMeta(
          param.name,
          param,
          highlightedExports,
          shortTypeUnionPrintWidth,
          defaultValueUnionPrintWidth,
          typePrintWidth,
          output,
        );
        return { name: param.name, ...highlighted };
      }),
    );

    // Check if there's a single parameter whose type matches a raw type with properties.
    // If so, expand it into a property table (like component props).
    if (data.parameters.length === 1) {
      const param = data.parameters[0];
      // Strip '| undefined' suffix from optional parameters before matching
      const paramTypeText = param.typeText.replace(/\s*\|\s*undefined$/, '');
      const paramMatch = lookupRawTypeProperties(paramTypeText, rawTypeProperties);
      if (paramMatch) {
        expandedTypeName = paramMatch.name;
        const highlightedProps = await highlightRawProperties(paramMatch.properties, output);
        const propEntries = await Promise.all(
          Object.entries(highlightedProps).map(async ([propName, prop]) => {
            const highlighted = await highlightPropertyMeta(
              propName,
              prop,
              highlightedExports,
              shortTypeUnionPrintWidth,
              defaultValueUnionPrintWidth,
              typePrintWidth,
              output,
            );
            return [propName, highlighted] as const;
          }),
        );
        expandedProperties = Object.fromEntries(propEntries);
      }
    }
  }

  // Enhance returnValue
  let highlightedReturnValue: Record<string, HighlightedProperty> | HastField;
  let returnValueDetailedType: HastField | undefined;
  let returnValueTypeName: string | undefined;
  if (typeof data.returnValue === 'string') {
    // Check if the return type name matches a raw type with structured properties.
    // If so, expand it into a property table instead of a plain code reference.
    const returnMatch = lookupRawTypeProperties(data.returnValue, rawTypeProperties);
    if (returnMatch) {
      returnValueTypeName = returnMatch.name;
      const highlightedProps = await highlightRawProperties(returnMatch.properties, output);
      const returnValueEntries = await Promise.all(
        Object.entries(highlightedProps).map(async ([propName, prop]) => {
          const highlighted = await highlightPropertyMeta(
            propName,
            prop,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            output,
          );
          return [propName, highlighted] as const;
        }),
      );
      highlightedReturnValue = Object.fromEntries(returnValueEntries);
    } else {
      // It's a plain text type string - format with prettier and convert to HAST
      let formattedReturnValue = data.returnValue;
      if (topLevelTypePrintWidth !== undefined) {
        formattedReturnValue = await prettyFormat(
          data.returnValue,
          undefined,
          topLevelTypePrintWidth,
        );
      }
      if (formattedReturnValue.endsWith(';')) {
        formattedReturnValue = formattedReturnValue.slice(0, -1);
      }
      highlightedReturnValue = s(
        wrapInlineTypeInPre(await formatInlineTypeAsHast(formattedReturnValue)),
      );

      // Check if the return type references types that can be expanded
      const expanded = await expandReturnValueType(
        data.returnValue,
        highlightedExports,
        typePrintWidth,
      );
      if (expanded) {
        returnValueDetailedType = s(expanded);
      }
    }
  } else {
    // It's an object with FormattedProperty values
    const returnValueEntries = await Promise.all(
      Object.entries(data.returnValue).map(async ([propName, prop]) => {
        const highlighted = await highlightPropertyMeta(
          propName,
          prop,
          highlightedExports,
          shortTypeUnionPrintWidth,
          defaultValueUnionPrintWidth,
          typePrintWidth,
          output,
        );
        return [propName, highlighted] as const;
      }),
    );
    highlightedReturnValue = Object.fromEntries(returnValueEntries);
  }

  // Destructure fields that are replaced in the highlighted version
  const { parameters, expandedProperties: ep, returnValue: rv, ...restData } = data;
  const result: HighlightedHookTypeMeta = {
    ...restData,
    ...(restData.returnValueDescription && {
      returnValueDescription: s(restData.returnValueDescription),
    }),
    ...(highlightedParameters && { parameters: highlightedParameters }),
    ...(expandedProperties && { expandedProperties }),
    ...(expandedTypeName && { expandedTypeName }),
    returnValue: highlightedReturnValue,
  };
  if (returnValueDetailedType) {
    result.returnValueDetailedType = returnValueDetailedType;
  }
  if (returnValueTypeName) {
    result.returnValueTypeName = returnValueTypeName;
  }
  return result;
}

/**
 * Highlights a function's type metadata with syntax-highlighted HAST.
 */
async function highlightFunctionTypeMeta(
  data: FunctionTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  rawTypeProperties: Record<string, Record<string, FormattedProperty>>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  typePrintWidth: number,
  topLevelTypePrintWidth: number | undefined,
  output: TypesOutputFormat,
): Promise<HighlightedFunctionTypeMeta> {
  const s = resolveSerializer(output);

  // Highlight parameters or expanded properties
  let highlightedParameters: HighlightedParameter[] | undefined;
  let expandedProperties: Record<string, HighlightedProperty> | undefined;
  let expandedTypeName: string | undefined;

  if (data.expandedProperties) {
    // Anonymous object parameter was expanded at format time
    const expandedEntries = await Promise.all(
      Object.entries(data.expandedProperties).map(async ([propName, prop]) => {
        const highlighted = await highlightPropertyMeta(
          propName,
          prop,
          highlightedExports,
          shortTypeUnionPrintWidth,
          defaultValueUnionPrintWidth,
          typePrintWidth,
          output,
        );
        return [propName, highlighted] as const;
      }),
    );
    expandedProperties = Object.fromEntries(expandedEntries);
  } else if (data.parameters) {
    // Highlight each parameter
    highlightedParameters = await Promise.all(
      data.parameters.map(async (param) => {
        const highlighted = await highlightPropertyMeta(
          param.name,
          param,
          highlightedExports,
          shortTypeUnionPrintWidth,
          defaultValueUnionPrintWidth,
          typePrintWidth,
          output,
        );
        return { name: param.name, ...highlighted };
      }),
    );

    // Check if there's a single parameter whose type matches a raw type with properties.
    // If so, expand it into a property table (like component props).
    if (data.parameters.length === 1) {
      const param = data.parameters[0];
      // Strip '| undefined' suffix from optional parameters before matching
      const paramTypeText = param.typeText.replace(/\s*\|\s*undefined$/, '');
      const funcParamMatch = lookupRawTypeProperties(paramTypeText, rawTypeProperties);
      if (funcParamMatch) {
        expandedTypeName = funcParamMatch.name;
        const highlightedProps = await highlightRawProperties(funcParamMatch.properties, output);
        const propEntries = await Promise.all(
          Object.entries(highlightedProps).map(async ([propName, prop]) => {
            const highlighted = await highlightPropertyMeta(
              propName,
              prop,
              highlightedExports,
              shortTypeUnionPrintWidth,
              defaultValueUnionPrintWidth,
              typePrintWidth,
              output,
            );
            return [propName, highlighted] as const;
          }),
        );
        expandedProperties = Object.fromEntries(propEntries);
      }
    }
  }

  // Enhance returnValue - either object with properties or plain text string
  let highlightedReturnValue: Record<string, HighlightedProperty> | HastField;
  let returnValueDetailedType: HastField | undefined;
  let returnValueTypeName: string | undefined;
  if (typeof data.returnValue === 'string') {
    // Check if the return type name matches a raw type with structured properties.
    const funcReturnMatch = lookupRawTypeProperties(data.returnValue, rawTypeProperties);
    if (funcReturnMatch) {
      returnValueTypeName = funcReturnMatch.name;
      const highlightedProps = await highlightRawProperties(funcReturnMatch.properties, output);
      const returnValueEntries = await Promise.all(
        Object.entries(highlightedProps).map(async ([propName, prop]) => {
          const highlighted = await highlightPropertyMeta(
            propName,
            prop,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            output,
          );
          return [propName, highlighted] as const;
        }),
      );
      highlightedReturnValue = Object.fromEntries(returnValueEntries);
    } else {
      // It's a plain text type string - format with prettier and convert to HAST
      let formattedReturnValue = data.returnValue;
      if (topLevelTypePrintWidth !== undefined) {
        formattedReturnValue = await prettyFormat(
          data.returnValue,
          undefined,
          topLevelTypePrintWidth,
        );
      }
      if (formattedReturnValue.endsWith(';')) {
        formattedReturnValue = formattedReturnValue.slice(0, -1);
      }
      highlightedReturnValue = s(
        wrapInlineTypeInPre(await formatInlineTypeAsHast(formattedReturnValue)),
      );

      // Check if the return type references types that can be expanded
      const expanded = await expandReturnValueType(
        data.returnValue,
        highlightedExports,
        typePrintWidth,
      );
      if (expanded) {
        returnValueDetailedType = s(expanded);
      }
    }
  } else {
    // It's an object with FormattedProperty values
    const returnValueEntries = await Promise.all(
      Object.entries(data.returnValue).map(async ([propName, prop]) => {
        const highlighted = await highlightPropertyMeta(
          propName,
          prop,
          highlightedExports,
          shortTypeUnionPrintWidth,
          defaultValueUnionPrintWidth,
          typePrintWidth,
          output,
        );
        return [propName, highlighted] as const;
      }),
    );
    highlightedReturnValue = Object.fromEntries(returnValueEntries);
  }

  // Destructure fields that are replaced in the highlighted version
  const { parameters, expandedProperties: ep, returnValue: rv, ...restData } = data;
  const result: HighlightedFunctionTypeMeta = {
    ...restData,
    // description is already serialized by highlightTypes
    // returnValueDescription bypasses highlightTypes — serialize here
    ...(restData.returnValueDescription && {
      returnValueDescription: s(restData.returnValueDescription),
    }),
    ...(highlightedParameters && { parameters: highlightedParameters }),
    ...(expandedProperties && { expandedProperties }),
    ...(expandedTypeName && { expandedTypeName }),
    returnValue: highlightedReturnValue,
  };
  if (returnValueDetailedType) {
    result.returnValueDetailedType = returnValueDetailedType;
  }
  if (returnValueTypeName) {
    result.returnValueTypeName = returnValueTypeName;
  }
  return result;
}

/**
 * Highlights a class's type metadata with syntax-highlighted HAST.
 */
async function highlightClassTypeMeta(
  data: ClassTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  typePrintWidth: number,
  topLevelTypePrintWidth: number | undefined,
  output: TypesOutputFormat,
): Promise<HighlightedClassTypeMeta> {
  const s = resolveSerializer(output);

  // Enhance constructor parameters
  const highlightedConstructorParams = await Promise.all(
    data.constructorParameters.map(async (param) => {
      const highlighted = await highlightPropertyMeta(
        param.name,
        param,
        highlightedExports,
        shortTypeUnionPrintWidth,
        defaultValueUnionPrintWidth,
        typePrintWidth,
        output,
      );
      return { ...highlighted, name: param.name };
    }),
  );

  // Enhance properties
  const highlightedPropertiesEntries = await Promise.all(
    Object.entries(data.properties).map(async ([propName, prop]) => {
      const highlighted = await highlightClassPropertyMeta(
        propName,
        prop,
        highlightedExports,
        shortTypeUnionPrintWidth,
        typePrintWidth,
        output,
      );
      return [propName, highlighted] as const;
    }),
  );

  // Enhance methods
  const highlightedMethodsEntries = await Promise.all(
    Object.entries(data.methods).map(async ([methodName, method]) => {
      // Enhance method parameters
      const highlightedMethodParams = await Promise.all(
        method.parameters.map(async (param) => {
          const highlighted = await highlightPropertyMeta(
            param.name,
            param,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            output,
          );
          return { ...highlighted, name: param.name };
        }),
      );

      // Enhance return value - format with prettier before highlighting
      let formattedReturnValue = method.returnValue;
      if (topLevelTypePrintWidth !== undefined) {
        formattedReturnValue = await prettyFormat(
          method.returnValue,
          undefined,
          topLevelTypePrintWidth,
        );
      }
      if (formattedReturnValue.endsWith(';')) {
        formattedReturnValue = formattedReturnValue.slice(0, -1);
      }
      const highlightedReturnValue = s(
        wrapInlineTypeInPre(await formatInlineTypeAsHast(formattedReturnValue)),
      );

      const highlightedMethod: HighlightedMethod = {
        ...method,
        // Class types bypass highlightTypes — serialize description/returnValueDescription here
        ...(method.description && { description: s(method.description) }),
        ...(method.returnValueDescription && {
          returnValueDescription: s(method.returnValueDescription),
        }),
        parameters: highlightedMethodParams,
        returnValue: highlightedReturnValue,
      };
      return [methodName, highlightedMethod] as const;
    }),
  );

  return {
    ...data,
    // Class types bypass highlightTypes — serialize description here
    ...(data.description && { description: s(data.description) }),
    constructorParameters: highlightedConstructorParams,
    properties: Object.fromEntries(highlightedPropertiesEntries),
    methods: Object.fromEntries(highlightedMethodsEntries),
  };
}

/**
 * Expands a return value type string by resolving type references from highlightedExports.
 *
 * When a hook/function returns a named type like `AutocompleteFilter`, this function
 * checks if that type reference can be expanded from the highlightedExports map.
 * If so, it produces a detailed HAST representation (similar to detailedType for properties).
 *
 * @param returnValueText - The plain text return type string
 * @param highlightedExports - Map of type names to their highlighted HAST definitions
 * @param typePrintWidth - Print width for formatting the expanded type
 * @returns Expanded HAST if references were resolved, undefined otherwise
 */
async function expandReturnValueType(
  returnValueText: string,
  highlightedExports: Record<string, HastRoot>,
  typePrintWidth: number,
): Promise<HastRoot | undefined> {
  const typeHast = await formatInlineTypeAsHast(returnValueText);
  const typeRefs = collectTypeReferences(typeHast);
  const hasExpandableRefs = typeRefs.some((ref) => highlightedExports[ref.name] !== undefined);

  if (!hasExpandableRefs) {
    return undefined;
  }

  const expanded = replaceTypeReferences(typeHast, highlightedExports);
  const expandedText = getHastTextContent(expanded);
  const originalText = getHastTextContent(typeHast);

  if (expandedText === originalText) {
    return undefined;
  }

  let formattedExpandedText = await prettyFormat(expandedText, undefined, typePrintWidth);
  if (formattedExpandedText.endsWith(';')) {
    formattedExpandedText = formattedExpandedText.slice(0, -1);
  }

  return formatDetailedTypeAsHast(formattedExpandedText);
}

/**
 * Highlights a single property with syntax-highlighted HAST.
 */
async function highlightPropertyMeta(
  name: string,
  prop: FormattedProperty | FormattedParameter | PreProcessedProperty,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  typePrintWidth: number,
  output: TypesOutputFormat,
): Promise<HighlightedProperty> {
  const s = resolveSerializer(output);
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
      let formattedExpandedText = await prettyFormat(expandedText, undefined, typePrintWidth);
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
    let formattedTypeText = await prettyFormat(prop.typeText, undefined, typePrintWidth);
    // Strip trailing semicolon added by prettier
    if (formattedTypeText.endsWith(';')) {
      formattedTypeText = formattedTypeText.slice(0, -1);
    }
    type = await formatDetailedTypeAsHast(formattedTypeText);
  } else {
    // Format with prettier before highlighting to ensure consistent output
    let formattedTypeText = await prettyFormat(prop.typeText, undefined, typePrintWidth);
    if (formattedTypeText.endsWith(';')) {
      formattedTypeText = formattedTypeText.slice(0, -1);
    }
    type = wrapInlineTypeInPre(await formatInlineTypeAsHast(formattedTypeText));
  }

  // Convert defaultText to highlighted HAST
  const defaultValue = prop.defaultText
    ? await formatInlineTypeAsHast(prop.defaultText, defaultValueUnionPrintWidth)
    : undefined;

  const highlighted: HighlightedProperty = {
    ...prop,
    // description and example are already serialized by highlightTypes (or highlightRawProperties)
    // see bypasses highlightTypes — serialize here
    ...('see' in prop && prop.see !== undefined ? { see: s(prop.see) } : {}),
    type: s(type),
  };

  if (shortType && shortTypeText) {
    highlighted.shortType = s(shortType);
    highlighted.shortTypeText = shortTypeText;
  }

  if (defaultValue) {
    highlighted.default = s(defaultValue);
  }

  if (detailedType) {
    highlighted.detailedType = s(detailedType);
  }

  return highlighted;
}

/**
 * Highlights a class property with syntax-highlighted HAST.
 * Class properties have a different structure than component props.
 */
async function highlightClassPropertyMeta(
  name: string,
  prop: ClassFormattedProperty,
  highlightedExports: Record<string, HastRoot>,
  shortTypeUnionPrintWidth: number,
  typePrintWidth: number,
  output: TypesOutputFormat,
): Promise<HighlightedClassProperty> {
  const s = resolveSerializer(output);
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
        typePrintWidth,
      );
      if (formattedExpandedText.endsWith(';')) {
        formattedExpandedText = formattedExpandedText.slice(0, -1);
      }
      detailedType = await formatDetailedTypeAsHast(formattedExpandedText);
    }
  }

  // Format the base type with prettier before highlighting
  let formattedTypeText = await prettyFormat(prop.typeText, undefined, typePrintWidth);
  if (formattedTypeText.endsWith(';')) {
    formattedTypeText = formattedTypeText.slice(0, -1);
  }
  const type = wrapInlineTypeInPre(await formatInlineTypeAsHast(formattedTypeText));

  const highlighted: HighlightedClassProperty = {
    typeText: prop.typeText,
    type: s(type),
  };

  if (!prop.optional) {
    highlighted.required = true;
  }

  if (prop.descriptionText) {
    highlighted.descriptionText = prop.descriptionText;
  }
  // Class types bypass highlightTypes — serialize description here
  if (prop.description) {
    highlighted.description = s(prop.description);
  }

  if (shortType && shortTypeText) {
    highlighted.shortType = s(shortType);
    highlighted.shortTypeText = shortTypeText;
  }

  if (detailedType) {
    highlighted.detailedType = s(detailedType);
  }

  // Propagate class-specific fields
  if (prop.isStatic) {
    highlighted.isStatic = prop.isStatic;
  }
  if (prop.readonly) {
    highlighted.readonly = prop.readonly;
  }

  return highlighted;
}

/**
 * Highlights a raw type's metadata with syntax-highlighted HAST.
 * Converts the formattedCode string to highlighted HAST and expands type references.
 *
 * JSDoc comments are extracted from the highlighted HAST, wrapped in
 * `span[data-comment]` elements for CSS hiding, and returned as highlighted
 * property records on the result's `properties` field.
 */
async function highlightRawTypeMeta(
  data: RawTypeMeta,
  highlightedExports: Record<string, HastRoot>,
  typePrintWidth: number,
  topLevelTypePrintWidth: number | undefined,
  shortTypeUnionPrintWidth: number,
  defaultValueUnionPrintWidth: number,
  output: TypesOutputFormat,
): Promise<HighlightedRawTypeMeta> {
  const s = resolveSerializer(output);
  // Re-format the raw code with prettier at the configured width
  let formattedCode = data.formattedCode;
  if (topLevelTypePrintWidth !== undefined) {
    formattedCode = await prettyFormat(data.formattedCode, null, topLevelTypePrintWidth);
  }
  if (formattedCode.endsWith(';')) {
    formattedCode = formattedCode.slice(0, -1);
  }

  // Highlight the formatted code
  const initialHast = await formatDetailedTypeAsHast(formattedCode);

  // Check if any type references can be expanded
  const typeRefs = collectTypeReferences(initialHast);
  const hasExpandableRefs = typeRefs.some((ref) => highlightedExports[ref.name] !== undefined);

  let formattedCodeHast: HastRoot;
  if (hasExpandableRefs) {
    // Expand type references and re-format with prettier
    const expanded = replaceTypeReferences(initialHast, highlightedExports);
    let formattedText = getHastTextContent(expanded);
    if (topLevelTypePrintWidth !== undefined) {
      formattedText = await prettyFormat(formattedText, null, topLevelTypePrintWidth);
    }
    // Strip trailing semicolon added by prettier
    if (formattedText.endsWith(';')) {
      formattedText = formattedText.slice(0, -1);
    }
    formattedCodeHast = await formatDetailedTypeAsHast(formattedText);
  } else {
    // No expansion needed - use already-formatted code directly
    formattedCodeHast = initialHast;
  }

  // Extract JSDoc comments from the highlighted HAST
  // Comments are wrapped in span[data-comment] for CSS hiding
  let extractedProperties: Record<string, HighlightedProperty> | undefined;
  {
    const { hast: annotatedHast, properties: extractedComments } =
      extractTypePropsFromCode(formattedCodeHast);
    formattedCodeHast = annotatedHast;

    // Convert extracted comments to highlighted properties
    if (Object.keys(extractedComments).length > 0) {
      const highlightedEntries = await Promise.all(
        Object.entries(extractedComments).map(async ([path, comment]) => {
          // Build a FormattedProperty from the extracted comment
          // Descriptions/examples are created here via parseMarkdownToHast — serialize immediately
          const description = comment.description
            ? s(await parseMarkdownToHast(comment.description))
            : undefined;

          const example =
            comment.example !== undefined
              ? s(await parseMarkdownToHast(comment.example))
              : undefined;

          // see is NOT serialized here — enhanceProperty handles it
          const see =
            comment.see && comment.see.length > 0
              ? await parseMarkdownToHast(comment.see.join('\n'))
              : undefined;

          const formattedProp: PreProcessedProperty = {
            typeText: comment.typeText,
            ...(description && { description }),
            ...(comment.description && { descriptionText: comment.description }),
            ...(!comment.optional && { required: true as const }),
            ...(comment.defaultValue !== undefined && { defaultText: comment.defaultValue }),
            ...(example && {
              example,
              exampleText: comment.example,
            }),
            ...(see && {
              see,
              seeText: comment.see!.join('\n'),
            }),
          };

          const highlighted = await highlightPropertyMeta(
            path,
            formattedProp,
            highlightedExports,
            shortTypeUnionPrintWidth,
            defaultValueUnionPrintWidth,
            typePrintWidth,
            output,
          );
          return [path, highlighted] as const;
        }),
      );
      extractedProperties = Object.fromEntries(highlightedEntries);
    }
  }

  // Enhance enum members if present
  const highlightedEnumMembers = data.enumMembers
    ? data.enumMembers.map(
        (member): HighlightedEnumMemberMeta => ({
          ...member,
          ...(member.description && { description: s(member.description) }),
        }),
      )
    : undefined;

  // Destructure `properties` out of data to avoid spreading FormattedProperty
  // into a field that expects HighlightedProperty — raw properties are replaced by
  // the structured `extractedProperties` produced from `extractTypeProps` above.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { properties: _rawProperties, ...restData } = data;
  const result: HighlightedRawTypeMeta = {
    ...restData,
    // Raw types bypass highlightTypes — serialize description here
    ...(restData.description && { description: s(restData.description) }),
    formattedCode: s(formattedCodeHast),
    enumMembers: highlightedEnumMembers,
  };

  if (extractedProperties) {
    result.properties = extractedProperties;
  }

  return result;
}
