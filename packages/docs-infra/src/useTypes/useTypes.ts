import type { TypesContentProps } from '../abstractCreateTypes';
import type {
  ComponentTypeMeta,
  HookTypeMeta,
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
} from '../pipeline/loadPrecomputedTypesMeta';
import type { HastRoot } from '../CodeHighlighter/types';
import { hastToJsx } from '../pipeline/hastUtils';

export type UseTypesOptions = {
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
  default?: unknown;
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
  | { type: 'other'; name: string; data: any };

export type ProcessedTypesContentProps<T extends {}> = Omit<TypesContentProps<T>, 'types'> & {
  types?: ProcessedTypesMeta[];
};

/**
 * Processes types metadata and renders HAST nodes to JSX.
 * This hook is responsible for converting precomputed HAST nodes
 * from the webpack loader into renderable React components.
 * ```ts
 * console.log('test')
 * ```
 */
export function useTypes<T extends {}>(
  contentProps: TypesContentProps<T>,
  options?: UseTypesOptions,
): ProcessedTypesContentProps<T> {
  const { types, ...rest } = contentProps;

  if (!types) {
    return { ...rest };
  }

  // Process types to render HAST nodes
  const processedTypes: ProcessedTypesMeta[] = types.map((typeMeta) => {
    if (typeMeta.type === 'component') {
      return processComponentType(typeMeta.data, options?.components);
    }
    if (typeMeta.type === 'hook') {
      return processHookType(typeMeta.data, options?.components);
    }
    return typeMeta;
  });

  return {
    ...rest,
    types: processedTypes,
  };
}

function processComponentType(
  component: ComponentTypeMeta,
  components?: UseTypesOptions['components'],
): ProcessedTypesMeta {
  return {
    type: 'component',
    name: component.name,
    data: {
      ...component,
      description: component.description ? hastToJsx(component.description, components) : undefined,
      props: Object.fromEntries(
        Object.entries(component.props).map(([key, prop]) => [
          key,
          {
            ...prop,
            type: hastToJsx(prop.type, components),
            shortType: prop.shortType ? hastToJsx(prop.shortType, components) : undefined,
            default: prop.default ? hastToJsx(prop.default, components) : undefined,
            description: prop.description ? hastToJsx(prop.description, components) : undefined,
            example: prop.example ? hastToJsx(prop.example, components) : undefined,
            detailedType: prop.detailedType ? hastToJsx(prop.detailedType, components) : undefined,
          },
        ]),
      ),
      dataAttributes: Object.fromEntries(
        Object.entries(component.dataAttributes).map(([key, attr]) => {
          let processedType: React.ReactNode | undefined;
          if (attr.type) {
            processedType =
              typeof attr.type === 'string' ? attr.type : hastToJsx(attr.type, components);
          }
          return [
            key,
            {
              type: processedType,
              description: attr.description ? hastToJsx(attr.description, components) : undefined,
            },
          ];
        }),
      ),
      cssVariables: Object.fromEntries(
        Object.entries(component.cssVariables).map(([key, cssVar]) => {
          let processedType: React.ReactNode | undefined;
          if (cssVar.type) {
            processedType =
              typeof cssVar.type === 'string' ? cssVar.type : hastToJsx(cssVar.type, components);
          }
          return [
            key,
            {
              type: processedType,
              description: cssVar.description
                ? hastToJsx(cssVar.description, components)
                : undefined,
            },
          ];
        }),
      ),
    },
  };
}

function processHookType(
  hook: HookTypeMeta,
  components?: UseTypesOptions['components'],
): ProcessedTypesMeta {
  // Parameters can be either FormattedParameter[] or Record<string, FormattedProperty>
  let processedParameters: Record<string, ProcessedHookParameter>;
  if (Array.isArray(hook.parameters)) {
    // Array of parameters - just pass through as strings are already rendered
    processedParameters = hook.parameters as unknown as Record<string, ProcessedHookParameter>;
  } else {
    // Object of parameters (formatted as properties or parameters)
    const entries = Object.entries(hook.parameters).map(
      ([key, param]: [string, FormattedParameter | FormattedProperty]): [
        string,
        ProcessedHookParameter,
      ] => {
        // Type can be string (FormattedParameter) or HastRoot (FormattedProperty)
        const processedType =
          typeof param.type === 'string' ? param.type : hastToJsx(param.type, components);

        // Default is always HastRoot for both FormattedParameter and FormattedProperty
        let processedDefault: React.ReactNode | undefined;
        if (param.default) {
          processedDefault = hastToJsx(param.default, components);
        }

        // Description can be string or HastRoot
        let processedDescription: React.ReactNode | undefined;
        if (param.description) {
          processedDescription =
            typeof param.description === 'string'
              ? param.description
              : hastToJsx(param.description, components);
        }

        // Example can be string (FormattedParameter) or HastRoot (FormattedProperty)
        let processedExample: React.ReactNode | undefined;
        if (param.example) {
          processedExample =
            typeof param.example === 'string'
              ? param.example
              : hastToJsx(param.example, components);
        }

        // DetailedType only exists on FormattedProperty
        let processedDetailedType: React.ReactNode | undefined;
        if ('detailedType' in param && param.detailedType) {
          processedDetailedType = hastToJsx(param.detailedType, components);
        }

        return [
          key,
          {
            ...param,
            type: processedType,
            default: processedDefault,
            description: processedDescription,
            example: processedExample,
            detailedType: processedDetailedType,
          } as ProcessedHookParameter,
        ];
      },
    );
    processedParameters = Object.fromEntries(entries);
  }

  // Process return value
  let processedReturnValue: ProcessedHookReturnValue | undefined;

  // Check if it's a simple return value (HastRoot) vs object of properties
  // HastRoot has 'type' property that equals 'root' and 'children' array
  const isHastRoot =
    typeof hook.returnValue === 'object' &&
    hook.returnValue !== null &&
    'type' in hook.returnValue &&
    (hook.returnValue as any).type === 'root' &&
    'children' in hook.returnValue &&
    Array.isArray((hook.returnValue as any).children);

  if (isHastRoot) {
    // It's a HastRoot - convert to simple discriminated union
    const hastRoot = hook.returnValue as HastRoot;
    processedReturnValue = {
      kind: 'simple',
      type: hastToJsx(hastRoot, components),
      description: undefined,
    };
  } else {
    // Object of return properties (Record<string, FormattedProperty>)
    const returnValueRecord = hook.returnValue as Record<string, FormattedProperty>;
    const entries = Object.entries(returnValueRecord).map(
      ([key, prop]: [string, FormattedProperty]): [string, ProcessedProperty] => {
        // Type is always HastRoot for return value properties
        const processedType = prop.type ? hastToJsx(prop.type, components) : undefined;

        // ShortType, default, description, example, and detailedType can be HastRoot or undefined
        const processedShortType = prop.shortType
          ? hastToJsx(prop.shortType, components)
          : undefined;

        const processedDefault = prop.default ? hastToJsx(prop.default, components) : undefined;

        const processedDescription = prop.description
          ? hastToJsx(prop.description, components)
          : undefined;

        const processedExample = prop.example ? hastToJsx(prop.example, components) : undefined;

        const processedDetailedType = prop.detailedType
          ? hastToJsx(prop.detailedType, components)
          : undefined;

        return [
          key,
          {
            ...prop,
            type: processedType!,
            shortType: processedShortType,
            default: processedDefault,
            description: processedDescription,
            example: processedExample,
            detailedType: processedDetailedType,
          },
        ];
      },
    );
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
      description: hook.description ? hastToJsx(hook.description, components) : undefined,
      parameters: processedParameters,
      returnValue: processedReturnValue,
    },
  };
}
