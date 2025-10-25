import { unified } from 'unified';
import { transformHtmlCodePrecomputed } from '../transformHtmlCodePrecomputed/transformHtmlCodePrecomputed';
import type { ComponentTypeMeta } from './formatComponent';
import type { HookTypeMeta } from './formatHook';
import type { TypesMeta } from './loadPrecomputedTypesMeta';

/**
 * Applies syntax highlighting to code blocks in descriptions and examples.
 *
 * This function processes all TypesMeta objects and applies transformHtmlCodePrecomputed
 * to expand any code blocks in markdown content (descriptions and examples) with precomputed
 * syntax highlighting. It operates in parallel for maximum performance.
 *
 * Note: Type strings (type, shortType, detailedType, default) are already syntax-highlighted
 * inline during formatting, so they don't need processing here.
 *
 * The transform is applied to:
 * - Component and hook descriptions (markdown with code blocks)
 * - Prop/parameter examples (markdown with code blocks)
 * - Prop/parameter descriptions (markdown with code blocks)
 * - Data attribute and CSS variable descriptions (markdown with code blocks)
 *
 * @param variantData - The variant data containing TypesMeta objects to process
 * @returns New variant data with transformed HAST nodes
 */
export async function highlightTypes(
  variantData: Record<string, { types: TypesMeta[] }>,
): Promise<Record<string, { types: TypesMeta[] }>> {
  const processor = unified().use(transformHtmlCodePrecomputed);

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

      return [variantName, { types: transformedTypes }] as const;
    }),
  );

  return Object.fromEntries(transformedEntries);
}

/**
 * Applies syntax highlighting to code blocks in component descriptions and examples.
 * Type fields (type, shortType, detailedType, default) are already highlighted inline.
 */
async function highlightComponentType(
  processor: any,
  data: ComponentTypeMeta,
): Promise<ComponentTypeMeta> {
  // Transform markdown content (descriptions and examples) in parallel
  // Type fields are already syntax-highlighted during formatting
  const [description, propsEntries, dataAttributesEntries, cssVariablesEntries] = await Promise.all(
    [
      // Transform component description (markdown with code blocks)
      data.description ? processor.run(data.description) : Promise.resolve(data.description),

      // Transform prop descriptions and examples (markdown with code blocks)
      // Skip type/shortType/detailedType/default - already highlighted inline
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
 * Type fields (type, default) are already highlighted inline.
 */
async function highlightHookType(processor: any, data: HookTypeMeta): Promise<HookTypeMeta> {
  // Transform markdown content (descriptions and examples) in parallel
  // Type fields are already syntax-highlighted during formatting
  const [description, parametersEntries, returnValue] = await Promise.all([
    // Transform hook description (markdown with code blocks)
    data.description ? processor.run(data.description) : Promise.resolve(data.description),

    // Transform parameter descriptions and examples (markdown with code blocks)
    // Skip type/default - already highlighted inline
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

      // Check if returnValue is a HastRoot (has type === 'root')
      if (
        typeof data.returnValue === 'object' &&
        'type' in data.returnValue &&
        (data.returnValue as any).type === 'root'
      ) {
        // It's a HastRoot (single return type) - transform it directly
        return processor.run(data.returnValue);
      }

      // returnValue is an object with FormattedProperty values
      // Transform descriptions and examples (skip type/detailedType/default - already highlighted)
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
