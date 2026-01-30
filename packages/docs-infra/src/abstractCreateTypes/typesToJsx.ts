import type { Nodes as HastNodes } from 'hast';
import type { PluggableList } from 'unified';
import { unified } from 'unified';
import type {
  EnhancedComponentTypeMeta,
  EnhancedHookTypeMeta,
  EnhancedFunctionTypeMeta,
  EnhancedClassTypeMeta,
  EnhancedRawTypeMeta,
  EnhancedEnumMemberMeta,
  EnhancedTypesMeta,
  EnhancedProperty,
  EnhancedParameter,
  EnhancedMethod,
  EnhancedClassProperty,
} from '../pipeline/loadServerTypes';
import type { FormattedEnumMember } from '../pipeline/syncTypes';
import type { HastRoot } from '../CodeHighlighter/types';
import { hastToJsx as hastToJsxBase } from '../pipeline/hastUtils';

export type TypesJsxOptions = {
  components?: {
    pre?: React.ComponentType<{
      'data-precompute'?: string;
    }>;
  };
  inlineComponents?: {
    pre?: React.ComponentType<{ children: React.ReactNode }>;
  };
  /**
   * Rehype plugins to run on HAST before converting to JSX.
   * These are applied to each HAST node during processing.
   */
  enhancers?: PluggableList;
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

export type ProcessedClassProperty = Omit<
  EnhancedClassProperty,
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
  'type' | 'shortType' | 'description' | 'example' | 'default' | 'detailedType'
> & {
  type: React.ReactNode;
  shortType?: React.ReactNode;
  default?: React.ReactNode;
  description?: React.ReactNode;
  example?: React.ReactNode;
  detailedType?: React.ReactNode;
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

export type ProcessedMethod = Omit<
  EnhancedMethod,
  'description' | 'parameters' | 'returnValue' | 'returnValueDescription'
> & {
  description?: React.ReactNode;
  parameters: Record<string, ProcessedParameter>;
  returnValue?: React.ReactNode;
  returnValueDescription?: React.ReactNode;
};

export type ProcessedClassTypeMeta = Omit<
  EnhancedClassTypeMeta,
  'description' | 'constructorParameters' | 'properties' | 'methods'
> & {
  description?: React.ReactNode;
  constructorParameters: Record<string, ProcessedParameter>;
  properties: Record<string, ProcessedClassProperty>;
  methods: Record<string, ProcessedMethod>;
};

export type ProcessedRawEnumMember = Omit<EnhancedEnumMemberMeta, 'description'> & {
  description?: React.ReactNode;
};

export type ProcessedRawTypeMeta = Omit<
  EnhancedRawTypeMeta,
  'description' | 'formattedCode' | 'enumMembers'
> & {
  description?: React.ReactNode;
  formattedCode: React.ReactNode;
  enumMembers?: ProcessedRawEnumMember[];
};

export type ProcessedTypesMeta =
  | { type: 'component'; name: string; slug?: string; data: ProcessedComponentTypeMeta }
  | { type: 'hook'; name: string; slug?: string; data: ProcessedHookTypeMeta }
  | { type: 'function'; name: string; slug?: string; data: ProcessedFunctionTypeMeta }
  | { type: 'class'; name: string; slug?: string; data: ProcessedClassTypeMeta }
  | { type: 'raw'; name: string; slug?: string; data: ProcessedRawTypeMeta };

/**
 * Processed export data with JSX nodes instead of HAST.
 */
export interface ProcessedExportData {
  /** The main component/hook/function type for this export */
  type: ProcessedTypesMeta;
  /** Related types like .Props, .State, .ChangeEventDetails for this export */
  additionalTypes: ProcessedTypesMeta[];
}

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
 * Apply enhancers to HAST and convert to JSX.
 * If no enhancers are provided or the array is empty, skips enhancement.
 */
function hastToJsx(
  hast: HastNodes,
  components?: TypesJsxOptions['components'] | TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): React.ReactNode {
  if (!enhancers || enhancers.length === 0) {
    return hastToJsxBase(hast, components);
  }

  // Deep clone the HAST tree to avoid mutating the original (which may be cached/reused)
  const clonedHast = structuredClone(hast);

  // Apply enhancers to the cloned HAST tree
  const processor = unified().use(enhancers);
  const enhanced = processor.runSync(clonedHast as HastRoot) as HastNodes;
  return hastToJsxBase(enhanced, components);
}

function processComponentType(
  component: EnhancedComponentTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): ProcessedTypesMeta {
  return {
    type: 'component',
    name: component.name,
    data: {
      ...component,
      description: component.description && hastToJsx(component.description, components, enhancers),
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
            type: hastToJsx(prop.type, inlineComponents || components, enhancers),
          };

          if (prop.description) {
            processed.description = hastToJsx(prop.description, components, enhancers);
          }
          if (prop.example) {
            processed.example = hastToJsx(prop.example, components, enhancers);
          }

          if (prop.shortType) {
            processed.shortType = hastToJsx(prop.shortType, inlineComponents || components);
          }
          if (prop.default) {
            processed.default = hastToJsx(prop.default, inlineComponents || components, enhancers);
          }
          if (prop.detailedType) {
            processed.detailedType = hastToJsx(
              prop.detailedType,
              inlineComponents || components,
              enhancers,
            );
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
                : hastToJsx(attr.type, inlineComponents || components, enhancers);
          }
          return [
            key,
            {
              type: processedType,
              description:
                attr.description &&
                hastToJsx(attr.description, inlineComponents || components, enhancers),
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
                : hastToJsx(cssVar.type, components, enhancers);
          }
          return [
            key,
            {
              type: processedType,
              description:
                cssVar.description && hastToJsx(cssVar.description, components, enhancers),
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
  inlineComponents?: TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): ProcessedTypesMeta {
  const paramEntries = Object.entries(hook.parameters).map(([key, param]) => {
    const {
      type,
      default: defaultValue,
      description,
      example,
      detailedType,
      shortType,
      ...rest
    } = param;

    const processed: ProcessedParameter = {
      ...rest,
      type: hastToJsx(param.type, inlineComponents || components, enhancers),
    };

    if (param.description) {
      processed.description = hastToJsx(param.description, components, enhancers);
    }
    if (param.example) {
      processed.example = hastToJsx(param.example, components, enhancers);
    }
    if (param.default) {
      processed.default = hastToJsx(param.default, inlineComponents || components, enhancers);
    }
    if (detailedType) {
      processed.detailedType = hastToJsx(detailedType, inlineComponents || components, enhancers);
    }
    if (shortType) {
      processed.shortType = hastToJsx(shortType, inlineComponents || components);
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
      type: hastToJsx(hook.returnValue, inlineComponents || components, enhancers),
    };
  } else {
    const entries = Object.entries(hook.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const processedType =
        prop.type && hastToJsx(prop.type, inlineComponents || components, enhancers);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const processedShortType =
        prop.shortType && hastToJsx(prop.shortType, inlineComponents || components);

      const processedDefault =
        prop.default && hastToJsx(prop.default, inlineComponents || components, enhancers);

      const processedDescription =
        prop.description && hastToJsx(prop.description, components, enhancers);
      const processedExample = prop.example && hastToJsx(prop.example, components, enhancers);

      const processedDetailedType =
        prop.detailedType &&
        hastToJsx(prop.detailedType, inlineComponents || components, enhancers);
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
      description: hook.description && hastToJsx(hook.description, components, enhancers),
      parameters: processedParameters,
      returnValue: processedReturnValue,
    },
  };
}

function processFunctionType(
  func: EnhancedFunctionTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): ProcessedTypesMeta {
  const paramEntries = Object.entries(func.parameters).map(
    ([key, param]: [string, EnhancedParameter]) => {
      const {
        type,
        default: defaultValue,
        description,
        example,
        detailedType,
        shortType,
        ...rest
      } = param;

      const processed: ProcessedParameter = {
        ...rest,
        type: hastToJsx(param.type, inlineComponents || components, enhancers),
      };

      if (param.description) {
        processed.description = hastToJsx(param.description, components, enhancers);
      }
      if (param.example) {
        processed.example = hastToJsx(param.example, components, enhancers);
      }
      if (param.default) {
        processed.default = hastToJsx(param.default, inlineComponents || components, enhancers);
      }
      if (param.detailedType) {
        processed.detailedType = hastToJsx(
          param.detailedType,
          inlineComponents || components,
          enhancers,
        );
      }
      if (shortType) {
        processed.shortType = hastToJsx(shortType, inlineComponents || components);
      }

      return [key, processed] as const;
    },
  );
  const processedParameters = Object.fromEntries(paramEntries);

  // Process return value - always a HastRoot for functions
  const processedReturnValue = hastToJsx(
    func.returnValue,
    inlineComponents || components,
    enhancers,
  );

  // Process return value description
  const processedReturnValueDescription =
    func.returnValueDescription && hastToJsx(func.returnValueDescription, components, enhancers);

  return {
    type: 'function',
    name: func.name,
    data: {
      ...func,
      description: func.description && hastToJsx(func.description, components, enhancers),
      parameters: processedParameters,
      returnValue: processedReturnValue,
      returnValueDescription: processedReturnValueDescription,
    },
  };
}

function processClassType(
  classData: EnhancedClassTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): ProcessedTypesMeta {
  // Process constructor parameters
  const paramEntries = Object.entries(classData.constructorParameters).map(
    ([key, param]: [string, EnhancedParameter]) => {
      const {
        type,
        default: defaultValue,
        description,
        example,
        detailedType,
        shortType,
        ...rest
      } = param;

      const processed: ProcessedParameter = {
        ...rest,
        type: hastToJsx(param.type, inlineComponents || components, enhancers),
      };

      if (param.description) {
        processed.description = hastToJsx(param.description, components, enhancers);
      }
      if (param.example) {
        processed.example = hastToJsx(param.example, components, enhancers);
      }
      if (param.default) {
        processed.default = hastToJsx(param.default, inlineComponents || components, enhancers);
      }
      if (param.detailedType) {
        processed.detailedType = hastToJsx(
          param.detailedType,
          inlineComponents || components,
          enhancers,
        );
      }
      if (shortType) {
        processed.shortType = hastToJsx(shortType, inlineComponents || components);
      }

      return [key, processed] as const;
    },
  );
  const processedConstructorParameters = Object.fromEntries(paramEntries);

  // Process methods
  const methodEntries = Object.entries(classData.methods).map(
    ([methodName, method]: [string, EnhancedMethod]) => {
      // Process method parameters
      const methodParamEntries = Object.entries(method.parameters).map(
        ([paramKey, param]: [string, EnhancedParameter]) => {
          const {
            type,
            default: defaultValue,
            description,
            example,
            detailedType,
            shortType,
            ...rest
          } = param;

          const processed: ProcessedParameter = {
            ...rest,
            type: hastToJsx(param.type, inlineComponents || components, enhancers),
          };

          if (param.description) {
            processed.description = hastToJsx(param.description, components, enhancers);
          }
          if (param.example) {
            processed.example = hastToJsx(param.example, components, enhancers);
          }
          if (param.default) {
            processed.default = hastToJsx(param.default, inlineComponents || components, enhancers);
          }
          if (param.detailedType) {
            processed.detailedType = hastToJsx(
              param.detailedType,
              inlineComponents || components,
              enhancers,
            );
          }
          if (shortType) {
            processed.shortType = hastToJsx(shortType, inlineComponents || components);
          }

          return [paramKey, processed] as const;
        },
      );

      const processedMethod: ProcessedMethod = {
        ...method,
        description: method.description && hastToJsx(method.description, components, enhancers),
        parameters: Object.fromEntries(methodParamEntries),
        returnValue: hastToJsx(method.returnValue, inlineComponents || components, enhancers),
        returnValueDescription:
          method.returnValueDescription &&
          hastToJsx(method.returnValueDescription, components, enhancers),
      };

      return [methodName, processedMethod] as const;
    },
  );
  const processedMethods = Object.fromEntries(methodEntries);

  // Process properties
  const propertyEntries = Object.entries(classData.properties).map(
    ([propName, prop]: [string, EnhancedProperty]) => {
      const {
        type,
        default: defaultValue,
        description,
        shortType,
        detailedType,
        example,
        ...rest
      } = prop;

      const processed: ProcessedProperty = {
        ...rest,
        type: hastToJsx(prop.type, inlineComponents || components, enhancers),
      };

      if (prop.shortType) {
        processed.shortType = hastToJsx(prop.shortType, inlineComponents || components);
      }
      if (prop.detailedType) {
        processed.detailedType = hastToJsx(
          prop.detailedType,
          inlineComponents || components,
          enhancers,
        );
      }
      if (prop.description) {
        processed.description = hastToJsx(prop.description, components, enhancers);
      }
      if (prop.example) {
        processed.example = hastToJsx(prop.example, components, enhancers);
      }
      if (prop.default) {
        processed.default = hastToJsx(prop.default, inlineComponents || components, enhancers);
      }

      return [propName, processed] as const;
    },
  );
  const processedProperties = Object.fromEntries(propertyEntries);

  return {
    type: 'class',
    name: classData.name,
    data: {
      ...classData,
      description: classData.description && hastToJsx(classData.description, components, enhancers),
      constructorParameters: processedConstructorParameters,
      properties: processedProperties,
      methods: processedMethods,
    },
  };
}

function processRawType(
  raw: EnhancedRawTypeMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): ProcessedTypesMeta {
  // Process enum members if present
  const processedEnumMembers = raw.enumMembers?.map(
    (member): ProcessedRawEnumMember => ({
      ...member,
      description: member.description && hastToJsx(member.description, components, enhancers),
    }),
  );

  return {
    type: 'raw',
    name: raw.name,
    data: {
      ...raw,
      description: raw.description && hastToJsx(raw.description, components, enhancers),
      formattedCode: hastToJsx(raw.formattedCode, inlineComponents || components, enhancers),
      enumMembers: processedEnumMembers,
    },
  };
}

/**
 * Helper to convert a single EnhancedTypesMeta to ProcessedTypesMeta.
 */
function processTypeMeta(
  typeMeta: EnhancedTypesMeta,
  components?: TypesJsxOptions['components'],
  inlineComponents?: TypesJsxOptions['inlineComponents'],
  enhancers?: PluggableList,
): ProcessedTypesMeta {
  let result: ProcessedTypesMeta;
  if (typeMeta.type === 'component') {
    result = processComponentType(typeMeta.data, components, inlineComponents, enhancers);
  } else if (typeMeta.type === 'hook') {
    result = processHookType(typeMeta.data, components, inlineComponents, enhancers);
  } else if (typeMeta.type === 'function') {
    result = processFunctionType(typeMeta.data, components, inlineComponents, enhancers);
  } else if (typeMeta.type === 'class') {
    result = processClassType(typeMeta.data, components, inlineComponents, enhancers);
  } else if (typeMeta.type === 'raw') {
    result = processRawType(typeMeta.data, components, inlineComponents, enhancers);
  } else {
    // This should never happen, but TypeScript needs exhaustive checking
    return typeMeta satisfies never;
  }
  // Add slug if present on the source type
  if (typeMeta.slug) {
    result.slug = typeMeta.slug;
  }
  return result;
}

/**
 * Process a single export's type data to JSX.
 * More efficient when you only need one export.
 * @param exportData The export's type and namespaced additional types (undefined when only type exports exist)
 * @param globalAdditionalTypes Top-level non-namespaced types (only included for single component mode)
 * @param options JSX component options
 * @param includeGlobalAdditionalTypes Whether to include global additional types (default: true for createTypes, false for createMultipleTypes)
 */
export function typeToJsx(
  exportData: { type: EnhancedTypesMeta; additionalTypes: EnhancedTypesMeta[] } | undefined,
  globalAdditionalTypes: EnhancedTypesMeta[] | undefined,
  options?: TypesJsxOptions,
  includeGlobalAdditionalTypes: boolean = true,
): { type: ProcessedTypesMeta | undefined; additionalTypes: ProcessedTypesMeta[] } {
  const components = options?.components;
  const inlineComponents = options?.inlineComponents;
  const enhancers = options?.enhancers;

  // Handle case where there's no main export (only type exports like loader-utils)
  if (!exportData) {
    // Only include global additional types if requested
    if (includeGlobalAdditionalTypes) {
      const processedGlobalAdditionalTypes = (globalAdditionalTypes ?? []).map((t) =>
        processTypeMeta(t, components, inlineComponents, enhancers),
      );
      return {
        type: undefined,
        additionalTypes: processedGlobalAdditionalTypes,
      };
    }
    return {
      type: undefined,
      additionalTypes: [],
    };
  }

  const processedExport: ProcessedExportData = {
    type: processTypeMeta(exportData.type, components, inlineComponents, enhancers),
    additionalTypes: exportData.additionalTypes.map((t) =>
      processTypeMeta(t, components, inlineComponents, enhancers),
    ),
  };

  // Only include global additional types for single component mode (createTypes)
  if (includeGlobalAdditionalTypes) {
    const processedGlobalAdditionalTypes = (globalAdditionalTypes ?? []).map((t) =>
      processTypeMeta(t, components, inlineComponents, enhancers),
    );
    return {
      type: processedExport.type,
      additionalTypes: [...processedExport.additionalTypes, ...processedGlobalAdditionalTypes],
    };
  }

  return {
    type: processedExport.type,
    additionalTypes: processedExport.additionalTypes,
  };
}

/**
 * Process only additional types to JSX.
 * Used for the AdditionalTypes component that only renders top-level non-namespaced types.
 */
export function additionalTypesToJsx(
  additionalTypes: EnhancedTypesMeta[] | undefined,
  options?: TypesJsxOptions,
): ProcessedTypesMeta[] {
  const components = options?.components;
  const inlineComponents = options?.inlineComponents;
  const enhancers = options?.enhancers;

  if (!additionalTypes || additionalTypes.length === 0) {
    return [];
  }

  return additionalTypes.map((t) => processTypeMeta(t, components, inlineComponents, enhancers));
}
