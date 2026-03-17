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
import type { FormattedEnumMember } from '../pipeline/loadServerTypesMeta';
import type { HastRoot } from '../CodeHighlighter/types';
import { hastToJsx as hastToJsxBase } from '../pipeline/hastUtils';

// Broad index signature to accept MDXComponents from `mdx/types`,
// which uses `{ [key: string]: NestedMDXComponents | Component<any> }`.
type ComponentMap = Record<string, any>;

export type TypesJsxOptions = {
  components?: ComponentMap & {
    pre?: React.ComponentType<{
      'data-precompute'?: string;
    }>;
  };
  /**
   * Required pre component for type code blocks.
   * Type signatures are not precomputed, so this has a different
   * contract from `components.pre`.
   */
  TypePre: React.ComponentType<{ children: React.ReactNode }>;
  /**
   * Optional pre component for detailed type blocks.
   * Falls back to `TypePre` when not provided.
   */
  DetailedTypePre?: React.ComponentType<{ children: React.ReactNode }>;
  /**
   * Optional code component for shortType fields.
   * Falls back to `components.code` when not provided.
   */
  ShortTypeCode?: React.ComponentType<{ children?: React.ReactNode; className?: string }>;
  /**
   * Optional code component for default value fields.
   * Falls back to `components.code` when not provided.
   */
  DefaultCode?: React.ComponentType<{ children?: React.ReactNode; className?: string }>;
  /**
   * Optional pre component for raw type formatted code blocks.
   * Falls back to `DetailedTypePre`, then `TypePre` when not provided.
   */
  RawTypePre?: React.ComponentType<{ children: React.ReactNode }>;
  /**
   * Rehype plugins to run on HAST before converting to JSX.
   * These are applied to each HAST node during processing.
   */
  enhancers?: PluggableList;
  /**
   * Rehype plugins to run on inline HAST fields (shortType and default).
   * Applied instead of the full enhancers for these compact fields.
   */
  enhancersInline?: PluggableList;
};

/**
 * A processed property with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedProperty = Omit<
  EnhancedProperty,
  'type' | 'shortType' | 'description' | 'example' | 'detailedType' | 'default'
> & {
  /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  type: React.ReactNode;
  /** Compact type summary. Rendered by the `ShortTypeCode` component configured in `createTypes()`. */
  shortType?: React.ReactNode;
  /** Default value. Rendered by the `DefaultCode` component configured in `createTypes()`. */
  default?: React.ReactNode;
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Markdown example. Rendered using the `components` MDX map configured in `createTypes()`. */
  example?: React.ReactNode;
  /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
  detailedType?: React.ReactNode;
};

/**
 * A processed class property with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedClassProperty = Omit<
  EnhancedClassProperty,
  'type' | 'shortType' | 'description' | 'example' | 'detailedType' | 'default'
> & {
  /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  type: React.ReactNode;
  /** Compact type summary. Rendered by the `ShortTypeCode` component configured in `createTypes()`. */
  shortType?: React.ReactNode;
  /** Default value. Rendered by the `DefaultCode` component configured in `createTypes()`. */
  default?: React.ReactNode;
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Markdown example. Rendered using the `components` MDX map configured in `createTypes()`. */
  example?: React.ReactNode;
  /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
  detailedType?: React.ReactNode;
};

/**
 * A processed enum member (data attribute or CSS variable) with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedEnumMember = Omit<FormattedEnumMember, 'type' | 'description'> & {
  /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  type?: React.ReactNode;
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Default value. Rendered by the `DefaultCode` component configured in `createTypes()`. */
  default?: React.ReactNode;
};

/**
 * A processed function/hook parameter with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedParameter = Omit<
  EnhancedParameter,
  'type' | 'shortType' | 'description' | 'example' | 'default' | 'detailedType'
> & {
  /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  type: React.ReactNode;
  /** Compact type summary. Rendered by the `ShortTypeCode` component configured in `createTypes()`. */
  shortType?: React.ReactNode;
  /** Default value. Rendered by the `DefaultCode` component configured in `createTypes()`. */
  default?: React.ReactNode;
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Markdown example. Rendered using the `components` MDX map configured in `createTypes()`. */
  example?: React.ReactNode;
  /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
  detailedType?: React.ReactNode;
};

/**
 * Processed component type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedComponentTypeMeta = Omit<
  EnhancedComponentTypeMeta,
  'description' | 'props' | 'dataAttributes' | 'cssVariables'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  props: Record<string, ProcessedProperty>;
  dataAttributes: Record<string, ProcessedEnumMember>;
  cssVariables: Record<string, ProcessedEnumMember>;
};

export type ProcessedHookParameter = ProcessedParameter | ProcessedProperty;

/** Discriminated union for hook return values. */
export type ProcessedHookReturnValue =
  | {
      kind: 'simple';
      /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
      type: React.ReactNode;
      /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
      description?: React.ReactNode;
      /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
      detailedType?: React.ReactNode;
    }
  | { kind: 'object'; typeName?: string; properties: Record<string, ProcessedProperty> };

/**
 * Processed hook type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedHookTypeMeta = Omit<
  EnhancedHookTypeMeta,
  'description' | 'parameters' | 'properties' | 'returnValue' | 'optionsProperties'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  parameters?: Record<string, ProcessedHookParameter>;
  properties?: Record<string, ProcessedHookParameter>;
  optionsProperties?: Record<string, ProcessedProperty>;
  returnValue?: ProcessedHookReturnValue;
};

/** Discriminated union for function return values. */
export type ProcessedFunctionReturnValue =
  | {
      kind: 'simple';
      /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
      type: React.ReactNode;
      /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
      description?: React.ReactNode;
      /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
      detailedType?: React.ReactNode;
    }
  | { kind: 'object'; typeName?: string; properties: Record<string, ProcessedProperty> };

/**
 * Processed function type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedFunctionTypeMeta = Omit<
  EnhancedFunctionTypeMeta,
  | 'description'
  | 'parameters'
  | 'properties'
  | 'returnValue'
  | 'returnValueDescription'
  | 'optionsProperties'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  parameters?: Record<string, ProcessedParameter>;
  properties?: Record<string, ProcessedParameter>;
  optionsProperties?: Record<string, ProcessedProperty>;
  returnValue?: ProcessedFunctionReturnValue;
};

/**
 * A processed class method with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedMethod = Omit<
  EnhancedMethod,
  'description' | 'parameters' | 'returnValue' | 'returnValueDescription'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  parameters: Record<string, ProcessedParameter>;
  /** Return type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  returnValue?: React.ReactNode;
  /** Markdown return value description. Rendered using the `components` MDX map configured in `createTypes()`. */
  returnValueDescription?: React.ReactNode;
};

/**
 * Processed class type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedClassTypeMeta = Omit<
  EnhancedClassTypeMeta,
  'description' | 'constructorParameters' | 'properties' | 'methods'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  constructorParameters: Record<string, ProcessedParameter>;
  properties: Record<string, ProcessedClassProperty>;
  methods: Record<string, ProcessedMethod>;
};

/** A processed raw type enum member. */
export type ProcessedRawEnumMember = Omit<EnhancedEnumMemberMeta, 'description'> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
};

/**
 * Processed raw/alias type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedRawTypeMeta = Omit<
  EnhancedRawTypeMeta,
  'description' | 'formattedCode' | 'enumMembers' | 'properties'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Formatted code block. Rendered by the `RawTypePre` component configured in `createTypes()`. */
  formattedCode: React.ReactNode;
  enumMembers?: ProcessedRawEnumMember[];
  properties?: Record<string, ProcessedProperty>;
};

/**
 * Discriminated union of all processed type kinds.
 * The components rendering each field are configured in `createTypes()`.
 */
export type ProcessedTypesMeta =
  | {
      type: 'component';
      name: string;
      slug?: string;
      aliases?: string[];
      data: ProcessedComponentTypeMeta;
    }
  | { type: 'hook'; name: string; slug?: string; aliases?: string[]; data: ProcessedHookTypeMeta }
  | {
      type: 'function';
      name: string;
      slug?: string;
      aliases?: string[];
      data: ProcessedFunctionTypeMeta;
    }
  | { type: 'class'; name: string; slug?: string; aliases?: string[]; data: ProcessedClassTypeMeta }
  | { type: 'raw'; name: string; slug?: string; aliases?: string[]; data: ProcessedRawTypeMeta };

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
 * Pre-resolved component maps for different field rendering contexts.
 * Computed once from TypesJsxOptions to avoid re-creating maps per field.
 */
interface ResolvedFieldMaps {
  /** For type fields (pre = TypePre) */
  type: ComponentMap;
  /** For shortType fields (pre = TypePre, optionally code = ShortTypeCode) */
  shortType: ComponentMap;
  /** For default value fields (pre = TypePre, optionally code = DefaultCode) */
  default: ComponentMap;
  /** For detailedType fields (pre = DetailedTypePre or TypePre) */
  detailedType: ComponentMap;
  /** For raw type formattedCode (pre = RawTypePre or DetailedTypePre or TypePre) */
  rawType: ComponentMap;
}

function resolveFieldMaps(options: TypesJsxOptions): ResolvedFieldMaps {
  const base = options.components ?? {};
  const typeMap = { ...base, pre: options.TypePre };
  const detailedTypeMap = options.DetailedTypePre
    ? { ...base, pre: options.DetailedTypePre }
    : typeMap;
  return {
    type: typeMap,
    shortType: options.ShortTypeCode ? { ...typeMap, code: options.ShortTypeCode } : typeMap,
    default: options.DefaultCode ? { ...typeMap, code: options.DefaultCode } : typeMap,
    detailedType: detailedTypeMap,
    rawType: options.RawTypePre ? { ...base, pre: options.RawTypePre } : detailedTypeMap,
  };
}

/**
 * Cache unified processors by enhancers reference. During SSG, each page renders
 * hundreds of HAST fields through hastToJsx, all sharing the same enhancers array.
 * Without caching, each call creates a new unified() processor (calling plugin
 * attachers and allocating closures), causing significant GC pressure across
 * 6 parallel SSG workers. With caching, we create at most 2 processors per page
 * (one for enhancers, one for enhancersInline) instead of hundreds.
 *
 * WeakMap ensures processors are garbage collected when the enhancers array
 * (created per abstractCreateTypes call) is no longer referenced.
 */
const processorCache = new WeakMap<PluggableList, ReturnType<typeof unified>>();

function getOrCreateProcessor(enhancers: PluggableList): ReturnType<typeof unified> {
  let processor = processorCache.get(enhancers);
  if (!processor) {
    processor = unified().use(enhancers);
    processorCache.set(enhancers, processor);
  }
  return processor;
}

/**
 * Apply enhancers to HAST and convert to JSX.
 * If no enhancers are provided or the array is empty, skips enhancement.
 */
function hastToJsx(
  hast: HastNodes,
  components?: ComponentMap,
  enhancers?: PluggableList,
): React.ReactNode {
  if (!enhancers || enhancers.length === 0) {
    return hastToJsxBase(hast, components);
  }

  // Deep clone the HAST tree to avoid mutating the original (which may be cached/reused)
  const clonedHast = structuredClone(hast);

  // Reuse the unified processor for the same enhancers reference
  const processor = getOrCreateProcessor(enhancers);
  const enhanced = processor.runSync(clonedHast as HastRoot) as HastNodes;
  return hastToJsxBase(enhanced, components);
}

function processComponentType(
  component: EnhancedComponentTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
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
            type: hastToJsx(prop.type, fieldMaps.type, enhancers),
          };

          if (prop.description) {
            processed.description = hastToJsx(prop.description, components, enhancers);
          }
          if (prop.example) {
            processed.example = hastToJsx(prop.example, components, enhancers);
          }

          if (prop.shortType) {
            processed.shortType = hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);
          } else {
            // Fallback to type without full enhancers
            processed.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
          }
          if (prop.default) {
            processed.default = hastToJsx(prop.default, fieldMaps.default, enhancersInline);
          }
          if (prop.detailedType) {
            processed.detailedType = hastToJsx(
              prop.detailedType,
              fieldMaps.detailedType,
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
                : hastToJsx(attr.type, fieldMaps.type, enhancers);
          }
          return [
            key,
            {
              type: processedType,
              description:
                attr.description && hastToJsx(attr.description, fieldMaps.type, enhancers),
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
                : hastToJsx(cssVar.type, fieldMaps.type, enhancers);
          }
          return [
            key,
            {
              type: processedType,
              description:
                cssVar.description && hastToJsx(cssVar.description, fieldMaps.type, enhancers),
            },
          ];
        }),
      ) as Record<string, ProcessedEnumMember>,
    },
  };
}

/**
 * Processes a record of EnhancedProperty values into ProcessedProperty values.
 * Used for return value object properties and expanded options properties.
 */
function processPropertyRecord(
  properties: Record<string, EnhancedProperty>,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): Record<string, ProcessedProperty> {
  const entries = Object.entries(properties).map(([key, prop]) => {
    const processedType = prop.type && hastToJsx(prop.type, fieldMaps.type, enhancers);
    const processedShortType =
      prop.shortType && hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);
    const processedDefault =
      prop.default && hastToJsx(prop.default, fieldMaps.default, enhancersInline);
    const processedDescription =
      prop.description && hastToJsx(prop.description, components, enhancers);
    const processedExample = prop.example && hastToJsx(prop.example, components, enhancers);
    const processedDetailedType =
      prop.detailedType && hastToJsx(prop.detailedType, fieldMaps.detailedType, enhancers);

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
    } else {
      processed.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
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
  return Object.fromEntries(entries);
}

function processHookType(
  hook: EnhancedHookTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): ProcessedTypesMeta {
  const paramsOrProps = hook.properties ?? hook.parameters ?? {};
  const paramEntries = Object.entries(paramsOrProps).map(([key, param]) => {
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
      type: hastToJsx(param.type, fieldMaps.type, enhancers),
    };

    if (param.description) {
      processed.description = hastToJsx(param.description, components, enhancers);
    }
    if (param.example) {
      processed.example = hastToJsx(param.example, components, enhancers);
    }
    if (param.default) {
      processed.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
    }
    if (detailedType) {
      processed.detailedType = hastToJsx(detailedType, fieldMaps.detailedType, enhancers);
    }
    if (shortType) {
      processed.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
    } else {
      // Fallback to type without full enhancers
      processed.shortType = hastToJsx(param.type, fieldMaps.shortType, enhancersInline);
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
      type: hastToJsx(hook.returnValue, fieldMaps.type, enhancers),
    };
    if (hook.returnValueDetailedType) {
      processedReturnValue.detailedType = hastToJsx(
        hook.returnValueDetailedType,
        fieldMaps.detailedType,
        enhancers,
      );
    }
  } else {
    const entries = Object.entries(hook.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const processedType = prop.type && hastToJsx(prop.type, fieldMaps.type, enhancers);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const processedShortType =
        prop.shortType && hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);

      const processedDefault =
        prop.default && hastToJsx(prop.default, fieldMaps.default, enhancersInline);

      const processedDescription =
        prop.description && hastToJsx(prop.description, components, enhancers);
      const processedExample = prop.example && hastToJsx(prop.example, components, enhancers);

      const processedDetailedType =
        prop.detailedType && hastToJsx(prop.detailedType, fieldMaps.detailedType, enhancers);
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
      } else {
        // Fallback to type without full enhancers
        processed.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
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
      ...(hook.returnValueTypeName ? { typeName: hook.returnValueTypeName } : {}),
      properties: Object.fromEntries(entries),
    };
  }

  // Process optionsProperties if present (expanded single object parameter)
  let processedOptionsProperties: Record<string, ProcessedProperty> | undefined;
  if (hook.optionsProperties) {
    processedOptionsProperties = processPropertyRecord(
      hook.optionsProperties,
      components,
      fieldMaps,
      enhancers,
      enhancersInline,
    );
  }

  // Destructure parameters/properties from hook to avoid TypeScript confusion
  // when conditionally assigning to one field or the other
  const { parameters, properties, returnValue, description, optionsProperties, ...restHook } = hook;
  const hookData: ProcessedHookTypeMeta = {
    ...restHook,
    description: hook.description && hastToJsx(hook.description, components, enhancers),
    ...(hook.properties
      ? { properties: processedParameters }
      : { parameters: processedParameters }),
    optionsProperties: processedOptionsProperties,
    returnValue: processedReturnValue,
  };

  return {
    type: 'hook',
    name: hook.name,
    data: hookData,
  };
}

function processFunctionType(
  func: EnhancedFunctionTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): ProcessedTypesMeta {
  const paramsOrProps = func.properties ?? func.parameters ?? {};
  const paramEntries = Object.entries(paramsOrProps).map(([key, param]) => {
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
      type: hastToJsx(param.type, fieldMaps.type, enhancers),
    };

    if (param.description) {
      processed.description = hastToJsx(param.description, components, enhancers);
    }
    if (param.example) {
      processed.example = hastToJsx(param.example, components, enhancers);
    }
    if (param.default) {
      processed.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
    }
    if (param.detailedType) {
      processed.detailedType = hastToJsx(param.detailedType, fieldMaps.detailedType, enhancers);
    }
    if (shortType) {
      processed.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
    } else {
      // Fallback to type without full enhancers
      processed.shortType = hastToJsx(param.type, fieldMaps.shortType, enhancersInline);
    }

    return [key, processed] as const;
  });
  const processedParameters = Object.fromEntries(paramEntries);

  // Process return value - either simple HastRoot or object with properties
  let processedReturnValue: ProcessedFunctionReturnValue | undefined;

  // Check if it's a simple return value (HastRoot) vs object of properties
  if (isHastRoot(func.returnValue)) {
    // It's a HastRoot - convert to simple discriminated union
    processedReturnValue = {
      kind: 'simple',
      type: hastToJsx(func.returnValue, fieldMaps.type, enhancers),
      description:
        func.returnValueDescription &&
        hastToJsx(func.returnValueDescription, components, enhancers),
    };
    if (func.returnValueDetailedType) {
      processedReturnValue.detailedType = hastToJsx(
        func.returnValueDetailedType,
        fieldMaps.detailedType,
        enhancers,
      );
    }
  } else {
    const entries = Object.entries(func.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const processedType = prop.type && hastToJsx(prop.type, fieldMaps.type, enhancers);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const processedShortType =
        prop.shortType && hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);

      const processedDefault =
        prop.default && hastToJsx(prop.default, fieldMaps.default, enhancersInline);

      const processedDescription =
        prop.description && hastToJsx(prop.description, components, enhancers);
      const processedExample = prop.example && hastToJsx(prop.example, components, enhancers);

      const processedDetailedType =
        prop.detailedType && hastToJsx(prop.detailedType, fieldMaps.detailedType, enhancers);
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
      } else {
        // Fallback to type without full enhancers
        processed.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
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
      ...(func.returnValueTypeName ? { typeName: func.returnValueTypeName } : {}),
      properties: Object.fromEntries(entries),
    };
  }

  // Process optionsProperties if present (expanded single object parameter)
  let processedOptionsProperties: Record<string, ProcessedProperty> | undefined;
  if (func.optionsProperties) {
    processedOptionsProperties = processPropertyRecord(
      func.optionsProperties,
      components,
      fieldMaps,
      enhancers,
      enhancersInline,
    );
  }

  // Destructure parameters/properties from func to avoid TypeScript confusion
  // when conditionally assigning to one field or the other
  const {
    parameters,
    properties,
    returnValue,
    description,
    returnValueDescription,
    optionsProperties,
    ...restFunc
  } = func;

  return {
    type: 'function',
    name: func.name,
    data: {
      ...restFunc,
      description: func.description && hastToJsx(func.description, components, enhancers),
      ...(func.properties
        ? { properties: processedParameters }
        : { parameters: processedParameters }),
      optionsProperties: processedOptionsProperties,
      returnValue: processedReturnValue,
    },
  };
}

function processClassType(
  classData: EnhancedClassTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
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
        type: hastToJsx(param.type, fieldMaps.type, enhancers),
      };

      if (param.description) {
        processed.description = hastToJsx(param.description, components, enhancers);
      }
      if (param.example) {
        processed.example = hastToJsx(param.example, components, enhancers);
      }
      if (param.default) {
        processed.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
      }
      if (param.detailedType) {
        processed.detailedType = hastToJsx(param.detailedType, fieldMaps.detailedType, enhancers);
      }
      if (shortType) {
        processed.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
      } else {
        // Fallback to type without full enhancers
        processed.shortType = hastToJsx(param.type, fieldMaps.shortType, enhancersInline);
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
            type: hastToJsx(param.type, fieldMaps.type, enhancers),
          };

          if (param.description) {
            processed.description = hastToJsx(param.description, components, enhancers);
          }
          if (param.example) {
            processed.example = hastToJsx(param.example, components, enhancers);
          }
          if (param.default) {
            processed.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
          }
          if (param.detailedType) {
            processed.detailedType = hastToJsx(
              param.detailedType,
              fieldMaps.detailedType,
              enhancers,
            );
          }
          if (shortType) {
            processed.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
          }

          return [paramKey, processed] as const;
        },
      );

      const processedMethod: ProcessedMethod = {
        ...method,
        description: method.description && hastToJsx(method.description, components, enhancers),
        parameters: Object.fromEntries(methodParamEntries),
        returnValue: hastToJsx(method.returnValue, fieldMaps.type, enhancers),
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
        type: hastToJsx(prop.type, fieldMaps.type, enhancers),
      };

      if (prop.shortType) {
        processed.shortType = hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);
      } else {
        // Fallback to type without full enhancers
        processed.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
      }
      if (prop.detailedType) {
        processed.detailedType = hastToJsx(prop.detailedType, fieldMaps.detailedType, enhancers);
      }
      if (prop.description) {
        processed.description = hastToJsx(prop.description, components, enhancers);
      }
      if (prop.example) {
        processed.example = hastToJsx(prop.example, components, enhancers);
      }
      if (prop.default) {
        processed.default = hastToJsx(prop.default, fieldMaps.default, enhancersInline);
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
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
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
      formattedCode: hastToJsx(raw.formattedCode, fieldMaps.rawType, enhancers),
      enumMembers: processedEnumMembers,
      properties:
        raw.properties &&
        processPropertyRecord(raw.properties, components, fieldMaps, enhancers, enhancersInline),
    },
  };
}

/**
 * Helper to convert a single EnhancedTypesMeta to ProcessedTypesMeta.
 */
function processTypeMeta(
  typeMeta: EnhancedTypesMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): ProcessedTypesMeta {
  let result: ProcessedTypesMeta;
  if (typeMeta.type === 'component') {
    result = processComponentType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'hook') {
    result = processHookType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'function') {
    result = processFunctionType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'class') {
    result = processClassType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'raw') {
    result = processRawType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else {
    // This should never happen, but TypeScript needs exhaustive checking
    return typeMeta satisfies never;
  }
  // Add slug if present on the source type
  if (typeMeta.slug) {
    result.slug = typeMeta.slug;
  }
  // Propagate aliases so types can be looked up by alternative names
  if (typeMeta.aliases) {
    result.aliases = typeMeta.aliases;
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
  options: TypesJsxOptions,
  includeGlobalAdditionalTypes: boolean = true,
): { type: ProcessedTypesMeta | undefined; additionalTypes: ProcessedTypesMeta[] } {
  const components = options.components;
  const fieldMaps = resolveFieldMaps(options);
  const enhancers = options.enhancers;
  const enhancersInline = options.enhancersInline;

  // Handle case where there's no main export (only type exports like loader-utils)
  if (!exportData) {
    // Only include global additional types if requested
    if (includeGlobalAdditionalTypes) {
      const processedGlobalAdditionalTypes = (globalAdditionalTypes ?? []).map((t) =>
        processTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
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
    type: processTypeMeta(exportData.type, components, fieldMaps, enhancers, enhancersInline),
    additionalTypes: exportData.additionalTypes.map((t) =>
      processTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
    ),
  };

  // Only include global additional types for single component mode (createTypes)
  if (includeGlobalAdditionalTypes) {
    const processedGlobalAdditionalTypes = (globalAdditionalTypes ?? []).map((t) =>
      processTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
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
  options: TypesJsxOptions,
): ProcessedTypesMeta[] {
  const components = options.components;
  const fieldMaps = resolveFieldMaps(options);
  const enhancers = options.enhancers;
  const enhancersInline = options.enhancersInline;

  if (!additionalTypes || additionalTypes.length === 0) {
    return [];
  }

  return additionalTypes.map((t) =>
    processTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
  );
}
