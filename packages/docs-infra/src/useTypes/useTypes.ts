import type { Root as HastRoot } from 'hast';

import type { TypesContentProps } from '../abstractCreateTypes';
import type {
  ComponentTypeMeta,
  HookTypeMeta,
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
} from '../pipeline/loadPrecomputedTypesMeta';
import { hastToJsx } from '../pipeline/hastUtils';

export type UseTypesOptions = {
  components?: {
    Pre?: React.ComponentType<{ children: React.ReactNode }>;
  };
};

// Processed types with React nodes instead of HAST
export type ProcessedProperty = Omit<
  FormattedProperty,
  'type' | 'description' | 'example' | 'detailedType'
> & {
  type: React.ReactNode;
  description?: React.ReactNode;
  example?: React.ReactNode;
  detailedType?: React.ReactNode;
};

export type ProcessedEnumMember = Omit<FormattedEnumMember, 'type' | 'description'> & {
  type?: React.ReactNode;
  description?: React.ReactNode;
  default?: unknown;
};

export type ProcessedParameter = Omit<FormattedParameter, 'type' | 'description'> & {
  type: React.ReactNode;
  description?: React.ReactNode;
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

export type ProcessedHookTypeMeta = Omit<
  HookTypeMeta,
  'description' | 'parameters' | 'returnValue'
> & {
  description?: React.ReactNode;
  parameters: Record<string, any>; // Can be array or object depending on hook format
  returnValue?:
    | Record<string, any>
    | string
    | { type: React.ReactNode; description?: React.ReactNode };
};

export type ProcessedTypesMeta =
  | { type: 'component'; name: string; data: ProcessedComponentTypeMeta }
  | { type: 'hook'; name: string; data: ProcessedHookTypeMeta }
  | { type: 'other'; name: string; data: any };

export type ProcessedTypesContentProps<T extends {}> = Omit<TypesContentProps<T>, 'types'> & {
  types?: ProcessedTypesMeta[];
};

/**
 * Processes types metadata and renders HAST nodes to JSX.
 * This hook is responsible for converting precomputed HAST nodes
 * from the webpack loader into renderable React components.
 */
export function useTypes<T extends {}>(
  contentProps: TypesContentProps<T>,
  _options?: UseTypesOptions,
): ProcessedTypesContentProps<T> {
  const { types, ...rest } = contentProps;

  if (!types) {
    return { ...rest };
  }

  // Process types to render HAST nodes
  const processedTypes: ProcessedTypesMeta[] = types.map((typeMeta) => {
    if (typeMeta.type === 'component') {
      return processComponentType(typeMeta.data);
    }
    if (typeMeta.type === 'hook') {
      return processHookType(typeMeta.data);
    }
    return typeMeta;
  });

  return {
    ...rest,
    types: processedTypes,
  };
}

function processComponentType(component: ComponentTypeMeta): ProcessedTypesMeta {
  return {
    type: 'component',
    name: component.name,
    data: {
      ...component,
      description: component.description ? hastToJsx(component.description) : undefined,
      props: Object.fromEntries(
        Object.entries(component.props).map(([key, prop]) => [
          key,
          {
            ...prop,
            type: hastToJsx(prop.type),
            description: prop.description ? hastToJsx(prop.description) : undefined,
            example: prop.example ? hastToJsx(prop.example) : undefined,
            detailedType: prop.detailedType ? hastToJsx(prop.detailedType) : undefined,
          },
        ]),
      ),
      dataAttributes: Object.fromEntries(
        Object.entries(component.dataAttributes).map(([key, attr]) => {
          let processedType: React.ReactNode | undefined;
          if (attr.type) {
            processedType = typeof attr.type === 'string' ? attr.type : hastToJsx(attr.type);
          }
          return [
            key,
            {
              type: processedType,
              description: attr.description ? hastToJsx(attr.description) : undefined,
            },
          ];
        }),
      ),
      cssVariables: Object.fromEntries(
        Object.entries(component.cssVariables).map(([key, cssVar]) => {
          let processedType: React.ReactNode | undefined;
          if (cssVar.type) {
            processedType = typeof cssVar.type === 'string' ? cssVar.type : hastToJsx(cssVar.type);
          }
          return [
            key,
            {
              type: processedType,
              description: cssVar.description ? hastToJsx(cssVar.description) : undefined,
            },
          ];
        }),
      ),
    },
  };
}

function processHookType(hook: HookTypeMeta): ProcessedTypesMeta {
  const returnValue =
    typeof hook.returnValue === 'string'
      ? { type: hook.returnValue, description: undefined }
      : hook.returnValue;

  // Parameters can be either FormattedParameter[] or Record<string, FormattedProperty>
  let processedParameters: Record<string, any>;
  if (Array.isArray(hook.parameters)) {
    // Array of parameters - just pass through as strings are already rendered
    processedParameters = hook.parameters;
  } else {
    // Object of parameters (formatted as properties)
    processedParameters = Object.fromEntries(
      Object.entries(hook.parameters).map(([key, param]: [string, any]) => [
        key,
        {
          ...param,
          type: hastToJsx(param.type as HastRoot),
          description: param.description ? hastToJsx(param.description) : undefined,
          example: param.example ? hastToJsx(param.example) : undefined,
          detailedType: param.detailedType ? hastToJsx(param.detailedType) : undefined,
        },
      ]),
    );
  }

  // Process return value
  let processedReturnValue: any;
  if (typeof returnValue === 'string') {
    processedReturnValue = returnValue;
  } else if (returnValue.type) {
    // Single return value with type
    processedReturnValue = {
      type: hastToJsx(returnValue.type as HastRoot),
      description: returnValue.description ? hastToJsx(returnValue.description) : undefined,
    };
  } else {
    // Object of return properties
    processedReturnValue = Object.fromEntries(
      Object.entries(returnValue).map(([key, prop]: [string, any]) => [
        key,
        {
          ...prop,
          type: hastToJsx(prop.type as HastRoot),
          description: prop.description ? hastToJsx(prop.description) : undefined,
          example: prop.example ? hastToJsx(prop.example) : undefined,
          detailedType: prop.detailedType ? hastToJsx(prop.detailedType) : undefined,
        },
      ]),
    );
  }

  return {
    type: 'hook',
    name: hook.name,
    data: {
      ...hook,
      description: hook.description ? hastToJsx(hook.description) : undefined,
      parameters: processedParameters,
      returnValue: processedReturnValue,
    },
  };
}
