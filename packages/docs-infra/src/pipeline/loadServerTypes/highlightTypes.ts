import { unified } from 'unified';
import type { Root as HastRoot } from 'hast';
import transformHtmlCodeInlineHighlighted from '../transformHtmlCodeInlineHighlighted';
import { transformHtmlCodePrecomputed } from '../transformHtmlCodePrecomputed/transformHtmlCodePrecomputed';
import type { ComponentTypeMeta } from '../syncTypes/formatComponent';
import type { HookTypeMeta } from '../syncTypes/formatHook';
import type { TypesMeta } from '../syncTypes/syncTypes';
import { formatInlineTypeAsHast } from './typeHighlighting';

/**
 * Result of the highlightTypes function.
 */
export interface HighlightTypesResult {
  /** Variant data with highlighted markdown content */
  variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }>;
  /** Map of export names to their highlighted type definitions for expansion */
  highlightedExports: Record<string, HastRoot>;
}

/**
 * Applies syntax highlighting to code blocks in descriptions and examples.
 *
 * This function processes all TypesMeta objects and applies transformHtmlCodePrecomputed
 * to expand any code blocks in markdown content (descriptions and examples) with precomputed
 * syntax highlighting. It operates in parallel for maximum performance.
 *
 * Note: Type strings (typeText, defaultText) remain as plain text at this stage.
 * Highlighting of types and generation of shortType/detailedType is deferred to
 * highlightTypesMeta() which runs after this function.
 *
 * The transform is applied to:
 * - Component and hook descriptions (markdown with code blocks)
 * - Prop/parameter examples (markdown with code blocks)
 * - Prop/parameter descriptions (markdown with code blocks)
 * - Data attribute and CSS variable descriptions (markdown with code blocks)
 *
 * Additionally, this function builds a highlightedExports map that maps
 * export names to their highlighted type definitions, enabling type reference
 * expansion in highlightTypesMeta().
 *
 * @param variantData - The variant data containing TypesMeta objects to process
 * @param externalTypes - External types discovered during formatting (type name -> definition)
 * @returns Result object with transformed variant data and highlightedExports map
 */
export async function highlightTypes(
  variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }>,
  externalTypes: Record<string, string> = {},
): Promise<HighlightTypesResult> {
  const processor = unified()
    .use(transformHtmlCodeInlineHighlighted)
    .use(transformHtmlCodePrecomputed);

  const transformedEntries = await Promise.all(
    Object.entries(variantData).map(async ([variantName, variant]) => {
      const transformedTypes = await Promise.all(
        variant.types.map(async (typeMeta) => {
          if (typeMeta.type === 'component') {
            return {
              ...typeMeta,
              data: await highlightComponentType(processor, typeMeta.data),
            };
          }
          if (typeMeta.type === 'hook') {
            return {
              ...typeMeta,
              data: await highlightHookType(processor, typeMeta.data),
            };
          }
          return typeMeta;
        }),
      );

      return [variantName, { types: transformedTypes, typeNameMap: variant.typeNameMap }] as const;
    }),
  );

  const transformedVariantData = Object.fromEntries(transformedEntries);

  // Build highlightedExports map from all type metadata and external types
  // This enables type reference expansion in highlightTypesMeta
  const highlightedExports = await buildHighlightedExports(transformedVariantData, externalTypes);

  return {
    variantData: transformedVariantData,
    highlightedExports,
  };
}

/**
 * Builds a map of export names to their highlighted type definitions.
 *
 * This enables type reference expansion in highlightTypesMeta. For each component's
 * props, dataAttributes, cssVariables, and state types, we create an entry that
 * can be used to replace type references like "Checkbox.Root.State" with
 * their actual type definitions.
 *
 * External types (like `Orientation`) are also included in this map, enabling
 * their expansion in detailedType fields.
 *
 * @param variantData - The variant data containing TypesMeta objects
 * @param externalTypes - External types discovered during formatting (type name -> definition)
 * @returns Map of export names (e.g., "Checkbox.Root.Props") to highlighted HAST
 */
async function buildHighlightedExports(
  variantData: Record<string, { types: TypesMeta[]; typeNameMap?: Record<string, string> }>,
  externalTypes: Record<string, string> = {},
): Promise<Record<string, HastRoot>> {
  const exports: Record<string, HastRoot> = {};

  // Process all variants and collect exports
  // We use the first variant's types as they should all have the same structure
  const firstVariant = Object.values(variantData)[0];
  if (!firstVariant) {
    // Still add external types even if no variant data
    await Promise.all(
      Object.entries(externalTypes).map(async ([typeName, definition]) => {
        exports[typeName] = await formatInlineTypeAsHast(definition);
      }),
    );
    return exports;
  }

  // Collect all types that can be referenced
  await Promise.all(
    firstVariant.types.map(async (typeMeta) => {
      if (typeMeta.type === 'component') {
        // Add component's Props type if it has props
        const propsEntries = Object.entries(typeMeta.data.props);
        if (propsEntries.length > 0) {
          // Build Props type string from the component's props
          const propsType = buildObjectTypeString(
            propsEntries.map(([name, prop]) => ({
              name,
              type: prop.typeText,
              optional: !prop.required,
            })),
          );
          exports[`${typeMeta.name}.Props`] = await formatInlineTypeAsHast(propsType);
        }

        // Add component's DataAttributes type if it has data attributes
        const dataAttrEntries = Object.entries(typeMeta.data.dataAttributes);
        if (dataAttrEntries.length > 0) {
          const dataAttrType = buildObjectTypeString(
            dataAttrEntries.map(([name, attr]) => ({
              name: `'data-${name}'`,
              type: attr.type || 'string',
              optional: true,
            })),
          );
          exports[`${typeMeta.name}.DataAttributes`] = await formatInlineTypeAsHast(dataAttrType);
        }

        // Add component's CssVariables type if it has CSS variables
        const cssVarEntries = Object.entries(typeMeta.data.cssVariables);
        if (cssVarEntries.length > 0) {
          const cssVarType = buildObjectTypeString(
            cssVarEntries.map(([name, cssVar]) => ({
              name: `'${name}'`,
              type: cssVar.type || 'string',
              optional: true,
            })),
          );
          exports[`${typeMeta.name}.CssVariables`] = await formatInlineTypeAsHast(cssVarType);
        }
      }
    }),
  );

  // Add external types to the exports map
  // These are types like `Orientation` that aren't publicly exported but are used in props
  await Promise.all(
    Object.entries(externalTypes).map(async ([typeName, definition]) => {
      if (!exports[typeName]) {
        exports[typeName] = await formatInlineTypeAsHast(definition);
      }
    }),
  );

  return exports;
}

/**
 * Builds an object type string from a list of properties.
 */
function buildObjectTypeString(
  props: Array<{ name: string; type: string; optional?: boolean }>,
): string {
  if (props.length === 0) {
    return '{}';
  }

  const members = props.map((p) => {
    const optionalMark = p.optional ? '?' : '';
    return `${p.name}${optionalMark}: ${p.type}`;
  });

  return `{ ${members.join('; ')} }`;
}

/**
 * Applies syntax highlighting to code blocks in component descriptions and examples.
 * Type fields (typeText, defaultText) remain as plain text - highlighting is
 * deferred to highlightTypesMeta() for type/shortType/detailedType generation.
 */
async function highlightComponentType(
  processor: any,
  data: ComponentTypeMeta,
): Promise<ComponentTypeMeta> {
  // Transform markdown content (descriptions and examples) in parallel
  // Type fields remain as plain text - highlighting is done in highlightTypesMeta
  const [description, propsEntries, dataAttributesEntries, cssVariablesEntries] = await Promise.all(
    [
      // Transform component description (markdown with code blocks)
      data.description ? processor.run(data.description) : Promise.resolve(data.description),

      // Transform prop descriptions and examples (markdown with code blocks)
      // Skip typeText/defaultText - highlighting is done in highlightTypesMeta
      Promise.all(
        Object.entries(data.props).map(async ([propName, prop]: [string, any]) => {
          const [propDescription, example] = await Promise.all([
            prop.description ? processor.run(prop.description) : Promise.resolve(prop.description),
            prop.example ? processor.run(prop.example) : Promise.resolve(prop.example),
          ]);

          return [
            propName,
            {
              ...prop,
              description: propDescription,
              example,
            },
          ] as const;
        }),
      ),

      // Transform data attribute descriptions (markdown with code blocks)
      Promise.all(
        Object.entries(data.dataAttributes).map(async ([attrName, attr]: [string, any]) => {
          const attrDescription = attr.description
            ? await processor.run(attr.description)
            : attr.description;

          return [attrName, { ...attr, description: attrDescription }] as const;
        }),
      ),

      // Transform CSS variable descriptions (markdown with code blocks)
      Promise.all(
        Object.entries(data.cssVariables).map(async ([varName, cssVar]: [string, any]) => {
          const varDescription = cssVar.description
            ? await processor.run(cssVar.description)
            : cssVar.description;

          return [varName, { ...cssVar, description: varDescription }] as const;
        }),
      ),
    ],
  );

  return {
    ...data,
    description,
    props: Object.fromEntries(propsEntries) as ComponentTypeMeta['props'],
    dataAttributes: Object.fromEntries(
      dataAttributesEntries,
    ) as ComponentTypeMeta['dataAttributes'],
    cssVariables: Object.fromEntries(cssVariablesEntries) as ComponentTypeMeta['cssVariables'],
  };
}

/**
 * Applies syntax highlighting to code blocks in hook descriptions and examples.
 * Type fields (typeText, defaultText) remain as plain text - highlighting is
 * deferred to highlightTypesMeta() for type/shortType/detailedType generation.
 */
async function highlightHookType(processor: any, data: HookTypeMeta): Promise<HookTypeMeta> {
  // Transform markdown content (descriptions and examples) in parallel
  // Type fields remain as plain text - highlighting is done in highlightTypesMeta
  const [description, parametersEntries, returnValue] = await Promise.all([
    // Transform hook description (markdown with code blocks)
    data.description ? processor.run(data.description) : Promise.resolve(data.description),

    // Transform parameter descriptions and examples (markdown with code blocks)
    // Skip typeText/defaultText - highlighting is done in highlightTypesMeta
    Promise.all(
      Object.entries(data.parameters).map(async ([paramName, param]: [string, any]) => {
        const [paramDescription, example] = await Promise.all([
          param.description ? processor.run(param.description) : Promise.resolve(param.description),
          param.example ? processor.run(param.example) : Promise.resolve(param.example),
        ]);

        return [paramName, { ...param, description: paramDescription, example }] as const;
      }),
    ),

    // Transform returnValue descriptions and examples
    (async () => {
      if (!data.returnValue) {
        return data.returnValue;
      }

      // Check if returnValue is a plain string (single return type)
      // This will be highlighted in highlightTypesMeta
      if (typeof data.returnValue === 'string') {
        return data.returnValue;
      }

      // returnValue is an object with FormattedProperty values
      // Transform descriptions and examples (skip typeText/defaultText - done in highlightTypesMeta)
      const returnValueEntries = await Promise.all(
        Object.entries(data.returnValue).map(async ([propName, prop]: [string, any]) => {
          const [propDescription, example] = await Promise.all([
            prop.description ? processor.run(prop.description) : Promise.resolve(prop.description),
            prop.example ? processor.run(prop.example) : Promise.resolve(prop.example),
          ]);

          return [
            propName,
            {
              ...prop,
              description: propDescription,
              example,
            },
          ] as const;
        }),
      );

      return Object.fromEntries(returnValueEntries) as Record<string, any>;
    })(),
  ]);

  return {
    ...data,
    description,
    parameters: Object.fromEntries(parametersEntries) as HookTypeMeta['parameters'],
    returnValue,
  };
}
