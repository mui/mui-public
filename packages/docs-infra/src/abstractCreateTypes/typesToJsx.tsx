import type { ExportNode } from 'typescript-api-extractor';
import type { Nodes as HastNodes } from 'hast';
import * as React from 'react';
import type {
  ComponentTypeMeta,
  HookTypeMeta,
  TypesMeta,
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
} from '../pipeline/loadPrecomputedTypesMeta';
import type { HastRoot } from '../CodeHighlighter/types';
import { hastToJsx } from '../pipeline/hastUtils';

/**
 * Wraps hastToJsx output in a span to ensure proper serialization across RSC boundaries.
 * React fragments from toJsxRuntime don't serialize properly when passed
 * directly as children to client components from server components.
 */
function hastToWrappedJsx(
  hast: HastNodes,
  components?: Parameters<typeof hastToJsx>[1],
): React.ReactNode {
  return <span>{hastToJsx(hast, components)}</span>;
}

export type TypesJsxOptions = {
  components?: {
    pre?: React.ComponentType<{
      'data-precompute'?: string;
    }>;
  };
};

// Processed types with React nodes instead of HAST
export type ProcessedProperty = Omit<
  FormattedProperty,
  'type' | 'shortType' | 'description' | 'example' | 'detailedType' | 'default'
> & {
  type: React.ReactNode;
  shortType?: React.ReactNode;
  default?: React.ReactNode;
  description?: React.ReactNode;
  example?: React.ReactNode;
  detailedType?: React.ReactNode;
};

export type ProcessedEnumMember = Omit<FormattedEnumMember, 'type' | 'description'> & {
  type?: React.ReactNode;
  description?: React.ReactNode;
  default?: React.ReactNode;
};

export type ProcessedParameter = Omit<
  FormattedParameter,
  'type' | 'description' | 'example' | 'default'
> & {
  type: React.ReactNode;
  default?: React.ReactNode;
  description?: React.ReactNode;
  example?: React.ReactNode;
};

export type ProcessedComponentTypeMeta = Omit<
  ComponentTypeMeta,
  'description' | 'props' | 'dataAttributes' | 'cssVariables'
> & {
  description?: React.ReactNode;
  props: Record<string, ProcessedProperty>;
  dataAttributes: Record<string, ProcessedEnumMember>;
  cssVariables: Record<string, ProcessedEnumMember>;
};

export type ProcessedHookParameter = ProcessedParameter | ProcessedProperty;

// Discriminated union for hook return values
export type ProcessedHookReturnValue =
  | { kind: 'simple'; type: React.ReactNode; description?: React.ReactNode }
  | { kind: 'object'; properties: Record<string, ProcessedProperty> };

export type ProcessedHookTypeMeta = Omit<
  HookTypeMeta,
  'description' | 'parameters' | 'returnValue'
> & {
  description?: React.ReactNode;
  parameters: Record<string, ProcessedHookParameter>;
  returnValue?: ProcessedHookReturnValue;
};

export type ProcessedTypesMeta =
  | { type: 'component'; name: string; data: ProcessedComponentTypeMeta }
  | { type: 'hook'; name: string; data: ProcessedHookTypeMeta }
  | { type: 'other'; name: string; data: ExportNode };

/**
 * Type guard to check if a value is a HastRoot node.
 */
function isHastRoot(value: unknown): value is HastRoot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as any).type === 'root' &&
    'children' in value &&
    Array.isArray((value as any).children)
  );
}

/**
 * Converts types metadata with HAST nodes to types with React JSX nodes.
 * This function transforms precomputed HAST nodes from the webpack loader
 * into renderable React components.
 */
export function typesToJsx(
  types: TypesMeta[] | undefined,
  options?: TypesJsxOptions,
): ProcessedTypesMeta[] | undefined {
  if (!types) {
    return undefined;
  }

  return types.map((typeMeta) => {
    if (typeMeta.type === 'component') {
      return processComponentType(typeMeta.data, options?.components);
    }
    if (typeMeta.type === 'hook') {
      return processHookType(typeMeta.data, options?.components);
    }
    return typeMeta;
  });
}

function processComponentType(
  component: ComponentTypeMeta,
  components?: TypesJsxOptions['components'],
): ProcessedTypesMeta {
  return {
    type: 'component',
    name: component.name,
    data: {
      ...component,
      description: component.description && hastToWrappedJsx(component.description, components),
      props: Object.fromEntries(
        Object.entries(component.props).map(([key, prop]: [string, any]) => {
          // Destructure to exclude HAST fields that need to be converted
          const {
            type,
            shortType,
            default: defaultValue,
            description,
            example,
            detailedType,
            ...rest
          } = prop;

          const processed: ProcessedProperty = {
            ...rest,
            type: hastToWrappedJsx(prop.type, components),
          };

          if (prop.shortType) {
            processed.shortType = hastToWrappedJsx(prop.shortType, components);
          }
          if (prop.default) {
            processed.default = hastToWrappedJsx(prop.default, components);
          }
          if (prop.description) {
            processed.description = hastToWrappedJsx(prop.description, components);
          }
          if (prop.example) {
            processed.example = hastToWrappedJsx(prop.example, components);
          }
          if (prop.detailedType) {
            processed.detailedType = hastToWrappedJsx(prop.detailedType, components);
          }

          return [key, processed];
        }),
      ) as Record<string, ProcessedProperty>,
      dataAttributes: Object.fromEntries(
        Object.entries(component.dataAttributes).map(([key, attr]: [string, any]) => {
          let processedType: React.ReactNode | undefined;
          if (attr.type) {
            processedType =
              typeof attr.type === 'string' ? attr.type : hastToWrappedJsx(attr.type, components);
          }
          return [
            key,
            {
              type: processedType,
              description: attr.description && hastToWrappedJsx(attr.description, components),
            },
          ];
        }),
      ) as Record<string, ProcessedEnumMember>,
      cssVariables: Object.fromEntries(
        Object.entries(component.cssVariables).map(([key, cssVar]: [string, any]) => {
          let processedType: React.ReactNode | undefined;
          if (cssVar.type) {
            processedType =
              typeof cssVar.type === 'string'
                ? cssVar.type
                : hastToWrappedJsx(cssVar.type, components);
          }
          return [
            key,
            {
              type: processedType,
              description: cssVar.description && hastToWrappedJsx(cssVar.description, components),
            },
          ];
        }),
      ) as Record<string, ProcessedEnumMember>,
    },
  };
}

function processHookType(
  hook: HookTypeMeta,
  components?: TypesJsxOptions['components'],
): ProcessedTypesMeta {
  const paramEntries = Object.entries(hook.parameters).map(([key, param]) => {
    const { type, default: defaultValue, description, example, ...rest } = param;

    const processed: ProcessedParameter = {
      ...rest,
      type: hastToWrappedJsx(param.type, components),
    };

    if (param.default) {
      processed.default = hastToWrappedJsx(param.default, components);
    }
    if (param.description) {
      processed.description = hastToWrappedJsx(param.description, components);
    }
    if (param.example) {
      processed.example = hastToWrappedJsx(param.example, components);
    }

    return [key, processed] as const;
  });
  const processedParameters = Object.fromEntries(paramEntries);

  // Process return value
  let processedReturnValue: ProcessedHookReturnValue | undefined;

  // Check if it's a simple return value (HastRoot) vs object of properties
  if (isHastRoot(hook.returnValue)) {
    // It's a HastRoot - convert to simple discriminated union
    processedReturnValue = {
      kind: 'simple',
      type: hastToWrappedJsx(hook.returnValue, components),
    };
  } else {
    const entries = Object.entries(hook.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const processedType = prop.type && hastToWrappedJsx(prop.type, components);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const processedShortType = prop.shortType && hastToWrappedJsx(prop.shortType, components);

      const processedDefault = prop.default && hastToWrappedJsx(prop.default, components);

      const processedDescription =
        prop.description && hastToWrappedJsx(prop.description, components);
      const processedExample = prop.example && hastToWrappedJsx(prop.example, components);

      const processedDetailedType =
        prop.detailedType && hastToWrappedJsx(prop.detailedType, components);
      // Destructure to exclude HAST fields that need to be converted
      const {
        type,
        shortType,
        default: defaultValue,
        description,
        example,
        detailedType,
        ...rest
      } = prop;

      const processed: ProcessedProperty = {
        ...rest,
        type: processedType,
      };

      if (processedShortType) {
        processed.shortType = processedShortType;
      }
      if (processedDefault) {
        processed.default = processedDefault;
      }
      if (processedDescription) {
        processed.description = processedDescription;
      }
      if (processedExample) {
        processed.example = processedExample;
      }
      if (processedDetailedType) {
        processed.detailedType = processedDetailedType;
      }

      return [key, processed];
    });
    processedReturnValue = {
      kind: 'object',
      properties: Object.fromEntries(entries),
    };
  }

  return {
    type: 'hook',
    name: hook.name,
    data: {
      ...hook,
      description: hook.description && hastToWrappedJsx(hook.description, components),
      parameters: processedParameters,
      returnValue: processedReturnValue,
    },
  };
}
