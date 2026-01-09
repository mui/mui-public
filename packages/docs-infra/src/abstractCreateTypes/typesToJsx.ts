import type { ExportNode } from 'typescript-api-extractor';
import type {
  EnhancedComponentTypeMeta,
  EnhancedHookTypeMeta,
  EnhancedFunctionTypeMeta,
  EnhancedTypesMeta,
  EnhancedProperty,
  EnhancedParameter,
} from '../pipeline/loadServerTypes';
import type { FormattedEnumMember } from '../pipeline/syncTypes';
import type { HastRoot } from '../CodeHighlighter/types';
import { hastToJsx } from '../pipeline/hastUtils';

export type TypesJsxOptions = {
  components?: {
    pre?: React.ComponentType<{
      'data-precompute'?: string;
    }>;
  };
  inlineComponents?: {
    pre?: React.ComponentType<{
      'data-precompute'?: string;
    }>;
  };
};

// Processed types with React nodes instead of HAST
export type ProcessedProperty = Omit<
  EnhancedProperty,
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
  EnhancedParameter,
  'type' | 'description' | 'example' | 'default'
> & {
  type: React.ReactNode;
  default?: React.ReactNode;
  description?: React.ReactNode;
  example?: React.ReactNode;
};

export type ProcessedComponentTypeMeta = Omit<
  EnhancedComponentTypeMeta,
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
  EnhancedHookTypeMeta,
  'description' | 'parameters' | 'returnValue'
> & {
  description?: React.ReactNode;
  parameters: Record<string, ProcessedHookParameter>;
  returnValue?: ProcessedHookReturnValue;
};

export type ProcessedFunctionTypeMeta = Omit<
  EnhancedFunctionTypeMeta,
  'description' | 'parameters' | 'returnValue' | 'returnValueDescription'
> & {
  description?: React.ReactNode;
  parameters: Record<string, ProcessedParameter>;
  returnValue?: React.ReactNode;
  returnValueDescription?: React.ReactNode;
};

export type ProcessedTypesMeta =
  | { type: 'component'; name: string; data: ProcessedComponentTypeMeta }
  | { type: 'hook'; name: string; data: ProcessedHookTypeMeta }
  | { type: 'function'; name: string; data: ProcessedFunctionTypeMeta }
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
  types: EnhancedTypesMeta[] | undefined,
  options?: TypesJsxOptions,
): ProcessedTypesMeta[] | undefined {
  if (!types) {
    return undefined;
  }

  return types.map((typeMeta) => {
    if (typeMeta.type === 'component') {
      return processComponentType(typeMeta.data, options?.components, options?.inlineComponents);
    }
    if (typeMeta.type === 'hook') {
      return processHookType(typeMeta.data, options?.components, options?.inlineComponents);
    }
    if (typeMeta.type === 'function') {
      return processFunctionType(typeMeta.data, options?.components, options?.inlineComponents);
    }
    return typeMeta;
  });
}

function processComponentType(
  component: EnhancedComponentTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['components'],
): ProcessedTypesMeta {
  return {
    type: 'component',
    name: component.name,
    data: {
      ...component,
      description: component.description && hastToJsx(component.description, components),
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
            type: hastToJsx(prop.type, inlineComponents || components),
          };

          if (prop.description) {
            processed.description = hastToJsx(prop.description, components);
          }
          if (prop.example) {
            processed.example = hastToJsx(prop.example, components);
          }

          if (prop.shortType) {
            processed.shortType = hastToJsx(prop.shortType, inlineComponents || components);
          }
          if (prop.default) {
            processed.default = hastToJsx(prop.default, inlineComponents || components);
          }
          if (prop.detailedType) {
            processed.detailedType = hastToJsx(prop.detailedType, inlineComponents || components);
          }

          return [key, processed];
        }),
      ) as Record<string, ProcessedProperty>,
      dataAttributes: Object.fromEntries(
        Object.entries(component.dataAttributes).map(([key, attr]: [string, any]) => {
          let processedType: React.ReactNode | undefined;
          if (attr.type) {
            processedType =
              typeof attr.type === 'string'
                ? attr.type
                : hastToJsx(attr.type, inlineComponents || components);
          }
          return [
            key,
            {
              type: processedType,
              description:
                attr.description && hastToJsx(attr.description, inlineComponents || components),
            },
          ];
        }),
      ) as Record<string, ProcessedEnumMember>,
      cssVariables: Object.fromEntries(
        Object.entries(component.cssVariables).map(([key, cssVar]: [string, any]) => {
          let processedType: React.ReactNode | undefined;
          if (cssVar.type) {
            processedType =
              typeof cssVar.type === 'string' ? cssVar.type : hastToJsx(cssVar.type, components);
          }
          return [
            key,
            {
              type: processedType,
              description: cssVar.description && hastToJsx(cssVar.description, components),
            },
          ];
        }),
      ) as Record<string, ProcessedEnumMember>,
    },
  };
}

function processHookType(
  hook: EnhancedHookTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['components'],
): ProcessedTypesMeta {
  const paramEntries = Object.entries(hook.parameters).map(([key, param]) => {
    const { type, default: defaultValue, description, example, ...rest } = param;

    const processed: ProcessedParameter = {
      ...rest,
      type: hastToJsx(param.type, inlineComponents || components),
    };

    if (param.description) {
      processed.description = hastToJsx(param.description, components);
    }
    if (param.example) {
      processed.example = hastToJsx(param.example, components);
    }
    if (param.default) {
      processed.default = hastToJsx(param.default, inlineComponents || components);
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
      type: hastToJsx(hook.returnValue, inlineComponents || components),
    };
  } else {
    const entries = Object.entries(hook.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const processedType = prop.type && hastToJsx(prop.type, inlineComponents || components);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const processedShortType =
        prop.shortType && hastToJsx(prop.shortType, inlineComponents || components);

      const processedDefault =
        prop.default && hastToJsx(prop.default, inlineComponents || components);

      const processedDescription = prop.description && hastToJsx(prop.description, components);
      const processedExample = prop.example && hastToJsx(prop.example, components);

      const processedDetailedType =
        prop.detailedType && hastToJsx(prop.detailedType, inlineComponents || components);
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
      description: hook.description && hastToJsx(hook.description, components),
      parameters: processedParameters,
      returnValue: processedReturnValue,
    },
  };
}

function processFunctionType(
  func: EnhancedFunctionTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['components'],
): ProcessedTypesMeta {
  const paramEntries = Object.entries(func.parameters).map(
    ([key, param]: [string, EnhancedParameter]) => {
      const { type, default: defaultValue, description, example, ...rest } = param;

      const processed: ProcessedParameter = {
        ...rest,
        type: hastToJsx(param.type, inlineComponents || components),
      };

      if (param.description) {
        processed.description = hastToJsx(param.description, components);
      }
      if (param.example) {
        processed.example = hastToJsx(param.example, components);
      }
      if (param.default) {
        processed.default = hastToJsx(param.default, inlineComponents || components);
      }

      return [key, processed] as const;
    },
  );
  const processedParameters = Object.fromEntries(paramEntries);

  // Process return value - always a HastRoot for functions
  const processedReturnValue = hastToJsx(func.returnValue, inlineComponents || components);

  // Process return value description
  const processedReturnValueDescription =
    func.returnValueDescription && hastToJsx(func.returnValueDescription, components);

  return {
    type: 'function',
    name: func.name,
    data: {
      ...func,
      description: func.description && hastToJsx(func.description, components),
      parameters: processedParameters,
      returnValue: processedReturnValue,
      returnValueDescription: processedReturnValueDescription,
    },
  };
}
