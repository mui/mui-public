import type { Nodes as HastNodes } from 'hast';
import type { PluggableList } from 'unified';
import { unified } from 'unified';
import type {
  HighlightedComponentTypeMeta,
  HighlightedHookTypeMeta,
  HighlightedFunctionTypeMeta,
  HighlightedClassTypeMeta,
  HighlightedRawTypeMeta,
  HighlightedEnumMemberMeta,
  HighlightedTypesMeta,
  HighlightedProperty,
  HighlightedParameter,
  HighlightedMethod,
  HighlightedClassProperty,
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
 * An enhanced property with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedProperty = Omit<
  HighlightedProperty,
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
 * An enhanced class property with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedClassProperty = Omit<
  HighlightedClassProperty,
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
 * An enhanced enum member (data attribute or CSS variable) with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedEnumMember = Omit<FormattedEnumMember, 'type' | 'description'> & {
  /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  type?: React.ReactNode;
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Default value. Rendered by the `DefaultCode` component configured in `createTypes()`. */
  default?: React.ReactNode;
};

/**
 * An enhanced function/hook parameter with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedParameter = Omit<
  HighlightedParameter,
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
 * Enhanced component type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedComponentTypeMeta = Omit<
  HighlightedComponentTypeMeta,
  'description' | 'props' | 'dataAttributes' | 'cssVariables'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  props: Record<string, EnhancedProperty>;
  dataAttributes: Record<string, EnhancedEnumMember>;
  cssVariables: Record<string, EnhancedEnumMember>;
};

export type EnhancedHookParameter = EnhancedParameter | EnhancedProperty;

/** Discriminated union for hook return values. */
export type EnhancedHookReturnValue =
  | {
      kind: 'simple';
      /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
      type: React.ReactNode;
      /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
      description?: React.ReactNode;
      /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
      detailedType?: React.ReactNode;
    }
  | { kind: 'object'; typeName?: string; properties: Record<string, EnhancedProperty> };

/**
 * Enhanced hook type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedHookTypeMeta = Omit<
  HighlightedHookTypeMeta,
  'description' | 'parameters' | 'properties' | 'returnValue' | 'optionsProperties'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  parameters?: Record<string, EnhancedHookParameter>;
  properties?: Record<string, EnhancedHookParameter>;
  optionsProperties?: Record<string, EnhancedProperty>;
  returnValue?: EnhancedHookReturnValue;
};

/** Discriminated union for function return values. */
export type EnhancedFunctionReturnValue =
  | {
      kind: 'simple';
      /** Full type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
      type: React.ReactNode;
      /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
      description?: React.ReactNode;
      /** Expanded type detail. Rendered by the `DetailedTypePre` component configured in `createTypes()`. */
      detailedType?: React.ReactNode;
    }
  | { kind: 'object'; typeName?: string; properties: Record<string, EnhancedProperty> };

/**
 * Enhanced function type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedFunctionTypeMeta = Omit<
  HighlightedFunctionTypeMeta,
  | 'description'
  | 'parameters'
  | 'properties'
  | 'returnValue'
  | 'returnValueDescription'
  | 'optionsProperties'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  parameters?: Record<string, EnhancedParameter>;
  properties?: Record<string, EnhancedParameter>;
  optionsProperties?: Record<string, EnhancedProperty>;
  returnValue?: EnhancedFunctionReturnValue;
};

/**
 * An enhanced class method with HAST fields converted to React nodes.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedMethod = Omit<
  HighlightedMethod,
  'description' | 'parameters' | 'returnValue' | 'returnValueDescription'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  parameters: Record<string, EnhancedParameter>;
  /** Return type signature. Rendered by the `TypePre` component configured in `createTypes()`. */
  returnValue?: React.ReactNode;
  /** Markdown return value description. Rendered using the `components` MDX map configured in `createTypes()`. */
  returnValueDescription?: React.ReactNode;
};

/**
 * Enhanced class type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedClassTypeMeta = Omit<
  HighlightedClassTypeMeta,
  'description' | 'constructorParameters' | 'properties' | 'methods'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  constructorParameters: Record<string, EnhancedParameter>;
  properties: Record<string, EnhancedClassProperty>;
  methods: Record<string, EnhancedMethod>;
};

/** An enhanced raw type enum member. */
export type EnhancedRawEnumMember = Omit<HighlightedEnumMemberMeta, 'description'> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
};

/**
 * Enhanced raw/alias type metadata with React nodes instead of HAST.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedRawTypeMeta = Omit<
  HighlightedRawTypeMeta,
  'description' | 'formattedCode' | 'enumMembers' | 'properties'
> & {
  /** Markdown description. Rendered using the `components` MDX map configured in `createTypes()`. */
  description?: React.ReactNode;
  /** Formatted code block. Rendered by the `RawTypePre` component configured in `createTypes()`. */
  formattedCode: React.ReactNode;
  enumMembers?: EnhancedRawEnumMember[];
  properties?: Record<string, EnhancedProperty>;
};

/**
 * Discriminated union of all enhanced type kinds.
 * The components rendering each field are configured in `createTypes()`.
 */
export type EnhancedTypesMeta =
  | {
      type: 'component';
      name: string;
      slug?: string;
      aliases?: string[];
      data: EnhancedComponentTypeMeta;
    }
  | { type: 'hook'; name: string; slug?: string; aliases?: string[]; data: EnhancedHookTypeMeta }
  | {
      type: 'function';
      name: string;
      slug?: string;
      aliases?: string[];
      data: EnhancedFunctionTypeMeta;
    }
  | { type: 'class'; name: string; slug?: string; aliases?: string[]; data: EnhancedClassTypeMeta }
  | { type: 'raw'; name: string; slug?: string; aliases?: string[]; data: EnhancedRawTypeMeta };

/**
 * Enhanced export data with JSX nodes instead of HAST.
 */
export interface EnhancedExportData {
  /** The main component/hook/function type for this export */
  type: EnhancedTypesMeta;
  /** Related types like .Props, .State, .ChangeEventDetails for this export */
  additionalTypes: EnhancedTypesMeta[];
}

/**
 * Type guard to check if a value is a HastRoot node or a serialized HAST wrapper.
 * Handles both live `{ type: 'root', children: [...] }` and serialized `{ hastJson: string }`.
 */
function isHastRoot(value: unknown): value is HastRoot | { hastJson: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  // Serialized HAST from loadPrecomputedTypes
  if ('hastJson' in value) {
    return true;
  }
  // Live HAST Root
  return (
    'type' in value && value.type === 'root' && 'children' in value && Array.isArray(value.children)
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
 *
 * Accepts either a live HAST tree or a serialized `{ hastJson: string }` wrapper
 * produced by `serializeHastRoots` in the loadPrecomputedTypes loader.
 * When serialized, `JSON.parse` produces a fresh tree — no `structuredClone` needed.
 */
function hastToJsx(
  hastOrJson: HastNodes | { hastJson: string },
  components?: ComponentMap,
  enhancers?: PluggableList,
): React.ReactNode {
  // Deserialize JSON-encoded HAST. JSON.parse produces a fresh tree,
  // so no structuredClone is needed when enhancers mutate in place.
  let hast: HastNodes;
  let freshCopy: boolean;
  if (typeof hastOrJson === 'object' && hastOrJson !== null && 'hastJson' in hastOrJson) {
    hast = JSON.parse(hastOrJson.hastJson);
    freshCopy = true;
  } else {
    hast = hastOrJson;
    freshCopy = false;
  }

  if (!enhancers || enhancers.length === 0) {
    return hastToJsxBase(hast, components);
  }

  // Deep clone only when the HAST tree is shared (not freshly parsed from JSON)
  const input = freshCopy ? hast : structuredClone(hast);

  // Reuse the unified processor for the same enhancers reference
  const processor = getOrCreateProcessor(enhancers);
  const enhanced = processor.runSync(input as HastRoot) as HastNodes;
  return hastToJsxBase(enhanced, components);
}

function enhanceComponentType(
  component: HighlightedComponentTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): EnhancedTypesMeta {
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

          const enhanced: EnhancedProperty = {
            ...rest,
            type: hastToJsx(prop.type, fieldMaps.type, enhancers),
          };

          if (prop.description) {
            enhanced.description = hastToJsx(prop.description, components, enhancers);
          }
          if (prop.example) {
            enhanced.example = hastToJsx(prop.example, components, enhancers);
          }

          if (prop.shortType) {
            enhanced.shortType = hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);
          } else {
            // Fallback to type without full enhancers
            enhanced.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
          }
          if (prop.default) {
            enhanced.default = hastToJsx(prop.default, fieldMaps.default, enhancersInline);
          }
          if (prop.detailedType) {
            enhanced.detailedType = hastToJsx(prop.detailedType, fieldMaps.detailedType, enhancers);
          }

          return [key, enhanced];
        }),
      ),
      dataAttributes: Object.fromEntries(
        Object.entries(component.dataAttributes).map(([key, attr]: [string, any]) => {
          let enhancedType: React.ReactNode | undefined;
          if (attr.type) {
            enhancedType =
              typeof attr.type === 'string'
                ? attr.type
                : hastToJsx(attr.type, fieldMaps.type, enhancers);
          }
          return [
            key,
            {
              type: enhancedType,
              description:
                attr.description && hastToJsx(attr.description, fieldMaps.type, enhancers),
            },
          ];
        }),
      ),
      cssVariables: Object.fromEntries(
        Object.entries(component.cssVariables).map(([key, cssVar]: [string, any]) => {
          let enhancedType: React.ReactNode | undefined;
          if (cssVar.type) {
            enhancedType =
              typeof cssVar.type === 'string'
                ? cssVar.type
                : hastToJsx(cssVar.type, fieldMaps.type, enhancers);
          }
          return [
            key,
            {
              type: enhancedType,
              description:
                cssVar.description && hastToJsx(cssVar.description, fieldMaps.type, enhancers),
            },
          ];
        }),
      ),
    },
  };
}

/**
 * Processes a record of HighlightedProperty values into EnhancedProperty values.
 * Used for return value object properties and expanded options properties.
 */
function enhancePropertyRecord(
  properties: Record<string, HighlightedProperty>,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): Record<string, EnhancedProperty> {
  const entries = Object.entries(properties).map(([key, prop]) => {
    const enhancedType = prop.type && hastToJsx(prop.type, fieldMaps.type, enhancers);
    const enhancedShortType =
      prop.shortType && hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);
    const enhancedDefault =
      prop.default && hastToJsx(prop.default, fieldMaps.default, enhancersInline);
    const enhancedDescription =
      prop.description && hastToJsx(prop.description, components, enhancers);
    const enhancedExample = prop.example && hastToJsx(prop.example, components, enhancers);
    const enhancedDetailedType =
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

    const enhanced: EnhancedProperty = {
      ...rest,
      type: enhancedType,
    };

    if (enhancedShortType) {
      enhanced.shortType = enhancedShortType;
    } else {
      enhanced.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
    }
    if (enhancedDefault) {
      enhanced.default = enhancedDefault;
    }
    if (enhancedDescription) {
      enhanced.description = enhancedDescription;
    }
    if (enhancedExample) {
      enhanced.example = enhancedExample;
    }
    if (enhancedDetailedType) {
      enhanced.detailedType = enhancedDetailedType;
    }

    return [key, enhanced];
  });
  return Object.fromEntries(entries);
}

function enhanceHookType(
  hook: HighlightedHookTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): EnhancedTypesMeta {
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

    const enhanced: EnhancedParameter = {
      ...rest,
      type: hastToJsx(param.type, fieldMaps.type, enhancers),
    };

    if (param.description) {
      enhanced.description = hastToJsx(param.description, components, enhancers);
    }
    if (param.example) {
      enhanced.example = hastToJsx(param.example, components, enhancers);
    }
    if (param.default) {
      enhanced.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
    }
    if (detailedType) {
      enhanced.detailedType = hastToJsx(detailedType, fieldMaps.detailedType, enhancers);
    }
    if (shortType) {
      enhanced.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
    } else {
      // Fallback to type without full enhancers
      enhanced.shortType = hastToJsx(param.type, fieldMaps.shortType, enhancersInline);
    }

    return [key, enhanced] as const;
  });
  const enhancedParameters = Object.fromEntries(paramEntries);

  // Process return value
  let enhancedReturnValue: EnhancedHookReturnValue | undefined;

  // Check if it's a simple return value (HastRoot) vs object of properties
  if (isHastRoot(hook.returnValue)) {
    // It's a HastRoot - convert to simple discriminated union
    enhancedReturnValue = {
      kind: 'simple',
      type: hastToJsx(hook.returnValue, fieldMaps.type, enhancers),
    };
    if (hook.returnValueDetailedType) {
      enhancedReturnValue.detailedType = hastToJsx(
        hook.returnValueDetailedType,
        fieldMaps.detailedType,
        enhancers,
      );
    }
  } else {
    const entries = Object.entries(hook.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const enhancedType = prop.type && hastToJsx(prop.type, fieldMaps.type, enhancers);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const enhancedShortType =
        prop.shortType && hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);

      const enhancedDefault =
        prop.default && hastToJsx(prop.default, fieldMaps.default, enhancersInline);

      const enhancedDescription =
        prop.description && hastToJsx(prop.description, components, enhancers);
      const enhancedExample = prop.example && hastToJsx(prop.example, components, enhancers);

      const enhancedDetailedType =
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

      const enhanced: EnhancedProperty = {
        ...rest,
        type: enhancedType,
      };

      if (enhancedShortType) {
        enhanced.shortType = enhancedShortType;
      } else {
        // Fallback to type without full enhancers
        enhanced.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
      }
      if (enhancedDefault) {
        enhanced.default = enhancedDefault;
      }
      if (enhancedDescription) {
        enhanced.description = enhancedDescription;
      }
      if (enhancedExample) {
        enhanced.example = enhancedExample;
      }
      if (enhancedDetailedType) {
        enhanced.detailedType = enhancedDetailedType;
      }

      return [key, enhanced];
    });
    enhancedReturnValue = {
      kind: 'object',
      ...(hook.returnValueTypeName ? { typeName: hook.returnValueTypeName } : {}),
      properties: Object.fromEntries(entries),
    };
  }

  // Process optionsProperties if present (expanded single object parameter)
  let enhancedOptionsProperties: Record<string, EnhancedProperty> | undefined;
  if (hook.optionsProperties) {
    enhancedOptionsProperties = enhancePropertyRecord(
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
  const hookData: EnhancedHookTypeMeta = {
    ...restHook,
    description: hook.description && hastToJsx(hook.description, components, enhancers),
    ...(hook.properties ? { properties: enhancedParameters } : { parameters: enhancedParameters }),
    optionsProperties: enhancedOptionsProperties,
    returnValue: enhancedReturnValue,
  };

  return {
    type: 'hook',
    name: hook.name,
    data: hookData,
  };
}

function enhanceFunctionType(
  func: HighlightedFunctionTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): EnhancedTypesMeta {
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

    const enhanced: EnhancedParameter = {
      ...rest,
      type: hastToJsx(param.type, fieldMaps.type, enhancers),
    };

    if (param.description) {
      enhanced.description = hastToJsx(param.description, components, enhancers);
    }
    if (param.example) {
      enhanced.example = hastToJsx(param.example, components, enhancers);
    }
    if (param.default) {
      enhanced.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
    }
    if (param.detailedType) {
      enhanced.detailedType = hastToJsx(param.detailedType, fieldMaps.detailedType, enhancers);
    }
    if (shortType) {
      enhanced.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
    } else {
      // Fallback to type without full enhancers
      enhanced.shortType = hastToJsx(param.type, fieldMaps.shortType, enhancersInline);
    }

    return [key, enhanced] as const;
  });
  const enhancedParameters = Object.fromEntries(paramEntries);

  // Process return value - either simple HastRoot or object with properties
  let enhancedReturnValue: EnhancedFunctionReturnValue | undefined;

  // Check if it's a simple return value (HastRoot) vs object of properties
  if (isHastRoot(func.returnValue)) {
    // It's a HastRoot - convert to simple discriminated union
    enhancedReturnValue = {
      kind: 'simple',
      type: hastToJsx(func.returnValue, fieldMaps.type, enhancers),
      description:
        func.returnValueDescription &&
        hastToJsx(func.returnValueDescription, components, enhancers),
    };
    if (func.returnValueDetailedType) {
      enhancedReturnValue.detailedType = hastToJsx(
        func.returnValueDetailedType,
        fieldMaps.detailedType,
        enhancers,
      );
    }
  } else {
    const entries = Object.entries(func.returnValue).map(([key, prop]) => {
      // Type is always HastRoot for return value properties
      const enhancedType = prop.type && hastToJsx(prop.type, fieldMaps.type, enhancers);

      // ShortType, default, description, example, and detailedType can be HastRoot or undefined
      const enhancedShortType =
        prop.shortType && hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);

      const enhancedDefault =
        prop.default && hastToJsx(prop.default, fieldMaps.default, enhancersInline);

      const enhancedDescription =
        prop.description && hastToJsx(prop.description, components, enhancers);
      const enhancedExample = prop.example && hastToJsx(prop.example, components, enhancers);

      const enhancedDetailedType =
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

      const enhanced: EnhancedProperty = {
        ...rest,
        type: enhancedType,
      };

      if (enhancedShortType) {
        enhanced.shortType = enhancedShortType;
      } else {
        // Fallback to type without full enhancers
        enhanced.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
      }
      if (enhancedDefault) {
        enhanced.default = enhancedDefault;
      }
      if (enhancedDescription) {
        enhanced.description = enhancedDescription;
      }
      if (enhancedExample) {
        enhanced.example = enhancedExample;
      }
      if (enhancedDetailedType) {
        enhanced.detailedType = enhancedDetailedType;
      }

      return [key, enhanced];
    });
    enhancedReturnValue = {
      kind: 'object',
      ...(func.returnValueTypeName ? { typeName: func.returnValueTypeName } : {}),
      properties: Object.fromEntries(entries),
    };
  }

  // Process optionsProperties if present (expanded single object parameter)
  let enhancedOptionsProperties: Record<string, EnhancedProperty> | undefined;
  if (func.optionsProperties) {
    enhancedOptionsProperties = enhancePropertyRecord(
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
        ? { properties: enhancedParameters }
        : { parameters: enhancedParameters }),
      optionsProperties: enhancedOptionsProperties,
      returnValue: enhancedReturnValue,
    },
  };
}

function enhanceClassType(
  classData: HighlightedClassTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): EnhancedTypesMeta {
  // Process constructor parameters
  const paramEntries = Object.entries(classData.constructorParameters).map(
    ([key, param]: [string, HighlightedParameter]) => {
      const {
        type,
        default: defaultValue,
        description,
        example,
        detailedType,
        shortType,
        ...rest
      } = param;

      const enhanced: EnhancedParameter = {
        ...rest,
        type: hastToJsx(param.type, fieldMaps.type, enhancers),
      };

      if (param.description) {
        enhanced.description = hastToJsx(param.description, components, enhancers);
      }
      if (param.example) {
        enhanced.example = hastToJsx(param.example, components, enhancers);
      }
      if (param.default) {
        enhanced.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
      }
      if (param.detailedType) {
        enhanced.detailedType = hastToJsx(param.detailedType, fieldMaps.detailedType, enhancers);
      }
      if (shortType) {
        enhanced.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
      } else {
        // Fallback to type without full enhancers
        enhanced.shortType = hastToJsx(param.type, fieldMaps.shortType, enhancersInline);
      }

      return [key, enhanced] as const;
    },
  );
  const enhancedConstructorParameters = Object.fromEntries(paramEntries);

  // Process methods
  const methodEntries = Object.entries(classData.methods).map(
    ([methodName, method]: [string, HighlightedMethod]) => {
      // Process method parameters
      const methodParamEntries = Object.entries(method.parameters).map(
        ([paramKey, param]: [string, HighlightedParameter]) => {
          const {
            type,
            default: defaultValue,
            description,
            example,
            detailedType,
            shortType,
            ...rest
          } = param;

          const enhanced: EnhancedParameter = {
            ...rest,
            type: hastToJsx(param.type, fieldMaps.type, enhancers),
          };

          if (param.description) {
            enhanced.description = hastToJsx(param.description, components, enhancers);
          }
          if (param.example) {
            enhanced.example = hastToJsx(param.example, components, enhancers);
          }
          if (param.default) {
            enhanced.default = hastToJsx(param.default, fieldMaps.default, enhancersInline);
          }
          if (param.detailedType) {
            enhanced.detailedType = hastToJsx(
              param.detailedType,
              fieldMaps.detailedType,
              enhancers,
            );
          }
          if (shortType) {
            enhanced.shortType = hastToJsx(shortType, fieldMaps.shortType, enhancersInline);
          }

          return [paramKey, enhanced] as const;
        },
      );

      const enhancedMethod: EnhancedMethod = {
        ...method,
        description: method.description && hastToJsx(method.description, components, enhancers),
        parameters: Object.fromEntries(methodParamEntries),
        returnValue: hastToJsx(method.returnValue, fieldMaps.type, enhancers),
        returnValueDescription:
          method.returnValueDescription &&
          hastToJsx(method.returnValueDescription, components, enhancers),
      };

      return [methodName, enhancedMethod] as const;
    },
  );
  const enhancedMethods = Object.fromEntries(methodEntries);

  // Process properties
  const propertyEntries = Object.entries(classData.properties).map(
    ([propName, prop]: [string, HighlightedProperty]) => {
      const {
        type,
        default: defaultValue,
        description,
        shortType,
        detailedType,
        example,
        ...rest
      } = prop;

      const enhanced: EnhancedProperty = {
        ...rest,
        type: hastToJsx(prop.type, fieldMaps.type, enhancers),
      };

      if (prop.shortType) {
        enhanced.shortType = hastToJsx(prop.shortType, fieldMaps.shortType, enhancersInline);
      } else {
        // Fallback to type without full enhancers
        enhanced.shortType = hastToJsx(prop.type, fieldMaps.shortType, enhancersInline);
      }
      if (prop.detailedType) {
        enhanced.detailedType = hastToJsx(prop.detailedType, fieldMaps.detailedType, enhancers);
      }
      if (prop.description) {
        enhanced.description = hastToJsx(prop.description, components, enhancers);
      }
      if (prop.example) {
        enhanced.example = hastToJsx(prop.example, components, enhancers);
      }
      if (prop.default) {
        enhanced.default = hastToJsx(prop.default, fieldMaps.default, enhancersInline);
      }

      return [propName, enhanced] as const;
    },
  );
  const enhancedProperties = Object.fromEntries(propertyEntries);

  return {
    type: 'class',
    name: classData.name,
    data: {
      ...classData,
      description: classData.description && hastToJsx(classData.description, components, enhancers),
      constructorParameters: enhancedConstructorParameters,
      properties: enhancedProperties,
      methods: enhancedMethods,
    },
  };
}

function enhanceRawType(
  raw: HighlightedRawTypeMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): EnhancedTypesMeta {
  // Process enum members if present
  const enhancedEnumMembers = raw.enumMembers?.map(
    (member): EnhancedRawEnumMember => ({
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
      enumMembers: enhancedEnumMembers,
      properties:
        raw.properties &&
        enhancePropertyRecord(raw.properties, components, fieldMaps, enhancers, enhancersInline),
    },
  };
}

/**
 * Helper to convert a single HighlightedTypesMeta to EnhancedTypesMeta.
 */
function enhanceTypeMeta(
  typeMeta: HighlightedTypesMeta,
  components: TypesJsxOptions['components'],
  fieldMaps: ResolvedFieldMaps,
  enhancers?: PluggableList,
  enhancersInline?: PluggableList,
): EnhancedTypesMeta {
  let result: EnhancedTypesMeta;
  if (typeMeta.type === 'component') {
    result = enhanceComponentType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'hook') {
    result = enhanceHookType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'function') {
    result = enhanceFunctionType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'class') {
    result = enhanceClassType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
  } else if (typeMeta.type === 'raw') {
    result = enhanceRawType(typeMeta.data, components, fieldMaps, enhancers, enhancersInline);
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
  exportData: { type: HighlightedTypesMeta; additionalTypes: HighlightedTypesMeta[] } | undefined,
  globalAdditionalTypes: HighlightedTypesMeta[] | undefined,
  options: TypesJsxOptions,
  includeGlobalAdditionalTypes: boolean = true,
): { type: EnhancedTypesMeta | undefined; additionalTypes: EnhancedTypesMeta[] } {
  const components = options.components;
  const fieldMaps = resolveFieldMaps(options);
  const enhancers = options.enhancers;
  const enhancersInline = options.enhancersInline;

  // Handle case where there's no main export (only type exports like loader-utils)
  if (!exportData) {
    // Only include global additional types if requested
    if (includeGlobalAdditionalTypes) {
      const enhancedGlobalAdditionalTypes = (globalAdditionalTypes ?? []).map((t) =>
        enhanceTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
      );
      return {
        type: undefined,
        additionalTypes: enhancedGlobalAdditionalTypes,
      };
    }
    return {
      type: undefined,
      additionalTypes: [],
    };
  }

  const enhancedExport: EnhancedExportData = {
    type: enhanceTypeMeta(exportData.type, components, fieldMaps, enhancers, enhancersInline),
    additionalTypes: exportData.additionalTypes.map((t) =>
      enhanceTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
    ),
  };

  // Only include global additional types for single component mode (createTypes)
  if (includeGlobalAdditionalTypes) {
    const enhancedGlobalAdditionalTypes = (globalAdditionalTypes ?? []).map((t) =>
      enhanceTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
    );
    return {
      type: enhancedExport.type,
      additionalTypes: [...enhancedExport.additionalTypes, ...enhancedGlobalAdditionalTypes],
    };
  }

  return {
    type: enhancedExport.type,
    additionalTypes: enhancedExport.additionalTypes,
  };
}

/**
 * Process only additional types to JSX.
 * Used for the AdditionalTypes component that only renders top-level non-namespaced types.
 */
export function additionalTypesToJsx(
  additionalTypes: HighlightedTypesMeta[] | undefined,
  options: TypesJsxOptions,
): EnhancedTypesMeta[] {
  const components = options.components;
  const fieldMaps = resolveFieldMaps(options);
  const enhancers = options.enhancers;
  const enhancersInline = options.enhancersInline;

  if (!additionalTypes || additionalTypes.length === 0) {
    return [];
  }

  return additionalTypes.map((t) =>
    enhanceTypeMeta(t, components, fieldMaps, enhancers, enhancersInline),
  );
}
