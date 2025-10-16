import { unified } from 'unified';
import { transformHtmlCodePrecomputed } from '../transformHtmlCodePrecomputed/transformHtmlCodePrecomputed.js';
import type { ComponentTypeMeta } from './formatComponent';
import type { HookTypeMeta } from './formatHook';
import type { TypesMeta } from './loadPrecomputedTypesMeta';

/**
 * Applies syntax highlighting to all HAST nodes in the variant data.
 *
 * This function processes all TypesMeta objects and applies transformHtmlCodePrecomputed
 * to expand any code blocks with precomputed syntax highlighting. It operates in parallel
 * for maximum performance.
 *
 * The transform is applied to:
 * - Component descriptions, props (type, description, example, detailedType), data attributes, and CSS variables
 * - Hook descriptions and parameters
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
 * Applies syntax highlighting to all HAST nodes in a component type.
 */
async function highlightComponentType(
  processor: any,
  data: ComponentTypeMeta,
): Promise<ComponentTypeMeta> {
  // Transform all HAST nodes in parallel
  const [description, propsEntries, dataAttributesEntries, cssVariablesEntries] = await Promise.all(
    [
      // Transform description
      data.description ? processor.run(data.description) : Promise.resolve(data.description),

      // Transform props
      Promise.all(
        Object.entries(data.props).map(async ([propName, prop]) => {
          const [type, propDescription, example, detailedType] = await Promise.all([
            prop.type ? processor.run(prop.type) : Promise.resolve(prop.type),
            prop.description ? processor.run(prop.description) : Promise.resolve(prop.description),
            prop.example ? processor.run(prop.example) : Promise.resolve(prop.example),
            prop.detailedType
              ? processor.run(prop.detailedType)
              : Promise.resolve(prop.detailedType),
          ]);

          return [
            propName,
            {
              ...prop,
              type,
              description: propDescription,
              example,
              detailedType,
            },
          ] as const;
        }),
      ),

      // Transform data attributes
      Promise.all(
        Object.entries(data.dataAttributes).map(async ([attrName, attr]) => {
          const attrDescription = attr.description
            ? await processor.run(attr.description)
            : attr.description;

          return [attrName, { ...attr, description: attrDescription }] as const;
        }),
      ),

      // Transform CSS variables
      Promise.all(
        Object.entries(data.cssVariables).map(async ([varName, cssVar]) => {
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
    props: Object.fromEntries(propsEntries),
    dataAttributes: Object.fromEntries(dataAttributesEntries),
    cssVariables: Object.fromEntries(cssVariablesEntries),
  };
}

/**
 * Applies syntax highlighting to all HAST nodes in a hook type.
 */
async function highlightHookType(processor: any, data: HookTypeMeta): Promise<HookTypeMeta> {
  // Transform all HAST nodes in parallel
  const [description, parametersEntries, returnValue] = await Promise.all([
    // Transform description
    data.description ? processor.run(data.description) : Promise.resolve(data.description),

    // Transform parameters (only description is HastRoot, type is string)
    Promise.all(
      Object.entries(data.parameters).map(async ([paramName, param]) => {
        const paramDescription = param.description
          ? await processor.run(param.description)
          : param.description;

        return [paramName, { ...param, description: paramDescription }] as const;
      }),
    ),

    // Transform returnValue (if it's an object with properties, transform each property)
    (async () => {
      if (typeof data.returnValue === 'string' || !data.returnValue) {
        return data.returnValue;
      }

      // returnValue is an object with FormattedProperty values
      const returnValueEntries = await Promise.all(
        Object.entries(data.returnValue).map(async ([propName, prop]) => {
          const [type, propDescription, example, detailedType] = await Promise.all([
            prop.type ? processor.run(prop.type) : Promise.resolve(prop.type),
            prop.description ? processor.run(prop.description) : Promise.resolve(prop.description),
            prop.example ? processor.run(prop.example) : Promise.resolve(prop.example),
            prop.detailedType
              ? processor.run(prop.detailedType)
              : Promise.resolve(prop.detailedType),
          ]);

          return [
            propName,
            {
              ...prop,
              type,
              description: propDescription,
              example,
              detailedType,
            },
          ] as const;
        }),
      );

      return Object.fromEntries(returnValueEntries);
    })(),
  ]);

  return {
    ...data,
    description,
    parameters: Object.fromEntries(parametersEntries),
    returnValue,
  };
}
