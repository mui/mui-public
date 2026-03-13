import * as React from 'react';
import type { PluggableList } from 'unified';
import type { EnhancedTypesMeta } from '@mui/internal-docs-infra/pipeline/loadServerTypes';
import enhanceCodeInline from '../pipeline/enhanceCodeInline';
import enhanceCodeExportLinks from '../pipeline/enhanceCodeExportLinks';
import {
  typeToJsx,
  additionalTypesToJsx,
  type ProcessedTypesMeta,
  type TypesJsxOptions,
} from './typesToJsx';

/**
 * Default enhancers applied when no enhancers are specified.
 * Note: enhanceCodeExportLinks is added dynamically when anchorMap is available.
 */
const DEFAULT_ENHANCERS: PluggableList = [enhanceCodeInline];

/**
 * Default inline enhancers applied to shortType and default fields.
 * These are simpler than full enhancers since inline fields don't need
 * block-level processing like export links.
 */
const DEFAULT_ENHANCERS_INLINE: PluggableList = [enhanceCodeInline];

/**
 * Export data structure containing a main type and its related additional types.
 * Used in the precompute field for structured type data.
 */
export interface ExportData {
  /** The main component/hook/function type for this export */
  type: EnhancedTypesMeta;
  /** Related types like .Props, .State, .ChangeEventDetails for this export */
  additionalTypes: EnhancedTypesMeta[];
}

export type TypesTableMeta = {
  precompute?: {
    /**
     * Structured export data where each export has a main type and related additional types.
     * Keys are export names like "Root", "Trigger", etc.
     */
    exports: Record<string, ExportData>;
    /**
     * Top-level types that are not namespaced under any component part
     * and not claimed by any variant-only group.
     */
    additionalTypes: EnhancedTypesMeta[];
    /**
     * Types belonging to variant-only groups (variants with no main export).
     * Keyed by variant name, containing the types from that variant.
     * Separated from `additionalTypes` to avoid duplication.
     */
    variantOnlyAdditionalTypes?: Record<string, EnhancedTypesMeta[]>;
    /**
     * Maps variant names to the type names that originated from that variant.
     * Used for namespace imports (e.g., `* as Types`) to filter additionalTypes
     * to only show types from that specific module.
     */
    variantTypeNames?: Record<string, string[]>;
    singleComponentName?: string;
    /**
     * Platform-scoped anchor maps for linking type references in code.
     * Used by enhanceCodeExportLinks to create links to type documentation.
     */
    anchorMap?: {
      js?: Record<string, string>;
      css?: Record<string, string>;
    };
  };
  name?: string;
  displayName?: string;
  disableOptimization?: boolean;
  watchSourceDirectly?: boolean;
  /**
   * When true, excludes this component from the parent index page.
   * The component types will still be processed, but won't be added to the index.
   */
  excludeFromIndex?: boolean;
  components?: TypesJsxOptions['components'];
  /**
   * Override pre component for type code blocks.
   * When set, overrides the factory-level TypePre.
   */
  TypePre?: TypesJsxOptions['TypePre'];
  /**
   * Override pre component for detailed type blocks.
   * When set, overrides the factory-level DetailedTypePre.
   */
  DetailedTypePre?: TypesJsxOptions['DetailedTypePre'];
  /**
   * Override code component for shortType fields.
   * When set, overrides the factory-level ShortTypeCode.
   */
  ShortTypeCode?: TypesJsxOptions['ShortTypeCode'];
  /**
   * Override code component for default value fields.
   * When set, overrides the factory-level DefaultCode.
   */
  DefaultCode?: TypesJsxOptions['DefaultCode'];
  /**
   * Override pre component for raw type formatted code blocks.
   * When set, overrides the factory-level RawTypePre.
   */
  RawTypePre?: TypesJsxOptions['RawTypePre'];
  /**
   * Rehype plugins to run on HAST before converting to JSX.
   * If set, completely overrides enhancers from AbstractCreateTypesOptions.
   * Defaults to `[enhanceCodeInline]` when undefined.
   * Pass an empty array to disable all enhancers.
   */
  enhancers?: PluggableList;
  /**
   * Rehype plugins to run on inline HAST fields (shortType and default).
   * If set, completely overrides enhancersInline from AbstractCreateTypesOptions.
   * Defaults to `[enhanceCodeInline]` when undefined.
   * Pass an empty array to disable all inline enhancers.
   */
  enhancersInline?: PluggableList;
  /**
   * Custom component tag name to use instead of `<a>` for type reference links.
   * When set, enhanceCodeExportLinks emits elements with this tag name,
   * adding a `name` property (the matched identifier) alongside `href`.
   * This enables interactive type popovers via a `TypeRef` component.
   */
  typeRefComponent?: string;
  /**
   * Custom component tag name to use instead of a plain HTML element
   * for property references within type definitions, object literals, function calls, and JSX.
   * For definitions the element receives `id`, for references it receives `href`.
   * Both also receive `name` (owner) and `prop` (kebab-case property path).
   */
  typePropRefComponent?: string;
  /**
   * Custom component tag name to use instead of a plain HTML element
   * for function parameter references.
   * For definitions the element receives `id`, for references it receives `href`.
   * Both also receive `name` (owner) and `param` (parameter name).
   */
  typeParamRefComponent?: string;
  /**
   * Opt-in property linking mode for enhanceCodeExportLinks.
   * - `'shallow'`: Link only top-level properties of known owners.
   * - `'deep'`: Link nested properties with dotted paths (e.g., `address.street-name`).
   * - `undefined` (default): No property linking.
   */
  linkProps?: 'shallow' | 'deep';
  /**
   * Opt-in function parameter linking for enhanceCodeExportLinks.
   * When `true`, links function parameter names to documentation anchors.
   */
  linkParams?: boolean;
  /**
   * Opt-in scope-based variable linking for enhanceCodeExportLinks.
   * When `true`, links variable references to the type from their declaration
   * using single-pass scope tracking.
   */
  linkScope?: boolean;
};

export type TypesTableProps<T extends {}> = T & {
  /**
   * The main type for this export (component, hook, or function).
   * Undefined when rendering only additional types (e.g., AdditionalTypes component).
   */
  type: ProcessedTypesMeta | undefined;
  /**
   * Additional types related to this export.
   * Includes both namespaced types (like .Props, .State) and global non-namespaced types.
   */
  additionalTypes: ProcessedTypesMeta[];
  multiple?: boolean;
};

export type AbstractCreateTypesOptions<T extends {} = {}> = {
  TypesTable: React.ComponentType<TypesTableProps<T>>;
  components?: TypesJsxOptions['components'];
  /**
   * Required pre component for type code blocks.
   * Type signatures are not precomputed, so this has a different
   * contract from `components.pre`.
   * Can be overridden by TypesTableMeta.TypePre.
   */
  TypePre: TypesJsxOptions['TypePre'];
  /**
   * Optional pre component for detailed type blocks.
   * Falls back to `TypePre` when not provided.
   * Can be overridden by TypesTableMeta.DetailedTypePre.
   */
  DetailedTypePre?: TypesJsxOptions['DetailedTypePre'];
  /**
   * Optional code component for shortType fields.
   * Falls back to `components.code` when not provided.
   * Can be overridden by TypesTableMeta.ShortTypeCode.
   */
  ShortTypeCode?: TypesJsxOptions['ShortTypeCode'];
  /**
   * Optional code component for default value fields.
   * Falls back to `components.code` when not provided.
   * Can be overridden by TypesTableMeta.DefaultCode.
   */
  DefaultCode?: TypesJsxOptions['DefaultCode'];
  /**
   * Optional pre component for raw type formatted code blocks.
   * Falls back to `DetailedTypePre`, then `TypePre` when not provided.
   * Can be overridden by TypesTableMeta.RawTypePre.
   */
  RawTypePre?: TypesJsxOptions['RawTypePre'];
  /**
   * Rehype plugins to run on HAST before converting to JSX.
   * Can be overridden by TypesTableMeta.enhancers.
   * Defaults to `[enhanceCodeInline]` when undefined.
   * Pass an empty array to disable all enhancers.
   */
  enhancers?: PluggableList;
  /**
   * Rehype plugins to run on inline HAST fields (shortType and default).
   * Can be overridden by TypesTableMeta.enhancersInline.
   * Defaults to `[enhanceCodeInline]` when undefined.
   * Pass an empty array to disable all inline enhancers.
   */
  enhancersInline?: PluggableList;
  /**
   * Custom component tag name to use instead of `<a>` for type reference links.
   * When set, enhanceCodeExportLinks emits elements with this tag name,
   * adding a `name` property (the matched identifier) alongside `href`.
   * Can be overridden by TypesTableMeta.typeRefComponent.
   */
  typeRefComponent?: string;
  /**
   * Custom component tag name for property reference elements.
   * Can be overridden by TypesTableMeta.typePropRefComponent.
   */
  typePropRefComponent?: string;
  /**
   * Custom component tag name for function parameter reference elements.
   * Can be overridden by TypesTableMeta.typeParamRefComponent.
   */
  typeParamRefComponent?: string;
  /**
   * Opt-in property linking mode for enhanceCodeExportLinks.
   * Can be overridden by TypesTableMeta.linkProps.
   */
  linkProps?: 'shallow' | 'deep';
  /**
   * Opt-in function parameter linking for enhanceCodeExportLinks.
   * Can be overridden by TypesTableMeta.linkParams.
   */
  linkParams?: boolean;
  /**
   * Opt-in scope-based variable linking for enhanceCodeExportLinks.
   * Can be overridden by TypesTableMeta.linkScope.
   */
  linkScope?: boolean;
};

export function abstractCreateTypes<T extends {}>(
  options: AbstractCreateTypesOptions<T>,
  url: string,
  meta: TypesTableMeta | undefined,
  exportName?: string,
): React.ComponentType<T> {
  if (!url.startsWith('file:')) {
    throw new Error(
      'abstractCreateTypes() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || !meta.precompute) {
    throw new Error('abstractCreateTypes() must be called within a `types.ts` file');
  }

  const singleComponentName = meta.precompute.singleComponentName;

  // Merge components from factory options and meta, with meta taking priority
  const components = {
    ...options.components,
    ...meta.components,
  };

  // Resolve named component slots (meta overrides options)
  const TypePre = meta.TypePre ?? options.TypePre;
  const DetailedTypePre = meta.DetailedTypePre ?? options.DetailedTypePre;
  const ShortTypeCode = meta.ShortTypeCode ?? options.ShortTypeCode;
  const DefaultCode = meta.DefaultCode ?? options.DefaultCode;
  const RawTypePre = meta.RawTypePre ?? options.RawTypePre;

  // Enhancers from meta completely override options.enhancers if set
  // Use DEFAULT_ENHANCERS if neither meta nor options specify enhancers
  // Then append enhanceCodeExportLinks if anchorMap is available
  let enhancers = meta.enhancers ?? options.enhancers ?? DEFAULT_ENHANCERS;
  if (
    meta.precompute.anchorMap &&
    (Object.keys(meta.precompute.anchorMap.js ?? {}).length > 0 ||
      Object.keys(meta.precompute.anchorMap.css ?? {}).length > 0)
  ) {
    const typeRefComponent = meta.typeRefComponent ?? options.typeRefComponent;
    const typePropRefComponent = meta.typePropRefComponent ?? options.typePropRefComponent;
    const typeParamRefComponent = meta.typeParamRefComponent ?? options.typeParamRefComponent;
    const linkProps = meta.linkProps ?? options.linkProps;
    const linkParams = meta.linkParams ?? options.linkParams;
    const linkScope = meta.linkScope ?? options.linkScope;
    const exportLinksOptions: Record<string, unknown> = { anchorMap: meta.precompute.anchorMap };
    if (typeRefComponent) {
      exportLinksOptions.typeRefComponent = typeRefComponent;
    }
    if (typePropRefComponent) {
      exportLinksOptions.typePropRefComponent = typePropRefComponent;
    }
    if (typeParamRefComponent) {
      exportLinksOptions.typeParamRefComponent = typeParamRefComponent;
    }
    if (linkProps) {
      exportLinksOptions.linkProps = linkProps;
    }
    if (linkParams) {
      exportLinksOptions.linkParams = linkParams;
    }
    if (linkScope) {
      exportLinksOptions.linkScope = linkScope;
    }
    enhancers = [...enhancers, [enhanceCodeExportLinks, exportLinksOptions]];
  }

  // Inline enhancers for shortType and default fields
  const enhancersInline =
    meta.enhancersInline ?? options.enhancersInline ?? DEFAULT_ENHANCERS_INLINE;

  // Extract precompute reference to avoid null checks inside component
  const precompute = meta.precompute;

  // Determine target export name outside component - it's static
  let targetExportName = exportName || singleComponentName || Object.keys(precompute.exports)[0];

  // Handle default imports in single-component mode: when a component is imported
  // via default import, singleComponentName is the local binding name (e.g., 'loadPrecomputedTypes')
  // but the API extractor uses 'default' as the export key.
  // Only apply in single-component mode to avoid mapping every key to 'default' in multiple mode.
  if (!exportName && !(targetExportName in precompute.exports) && 'default' in precompute.exports) {
    targetExportName = 'default';
  }

  // For single component mode (createTypes), include global additional types
  // For multiple component mode (createMultipleTypes), they go to the separate AdditionalTypes component
  // Exception: if the export doesn't exist (e.g., namespace import on types-only module),
  // use the variant-only additional types for that specific variant
  const isMultipleMode = Boolean(exportName);
  const exportExists = targetExportName in precompute.exports;

  // For namespace imports on types-only modules, use the pre-separated
  // variantOnlyAdditionalTypes instead of filtering from the shared pool
  const filteredAdditionalTypes =
    !exportExists && precompute.variantOnlyAdditionalTypes?.[targetExportName]
      ? precompute.variantOnlyAdditionalTypes[targetExportName]
      : precompute.additionalTypes;

  function TypesComponent(props: T) {
    // Memoize the conversion from HAST to JSX - only for the single export we need
    const { type, additionalTypes } = React.useMemo(
      () =>
        typeToJsx(
          precompute.exports[targetExportName],
          filteredAdditionalTypes,
          {
            components,
            TypePre,
            DetailedTypePre,
            ShortTypeCode,
            DefaultCode,
            RawTypePre,
            enhancers,
            enhancersInline,
          },
          // Include additionalTypes for:
          // 1. Single component mode (createTypes)
          // 2. Multiple mode when export doesn't exist (namespace import on types-only module)
          !isMultipleMode || !exportExists,
        ),
      [],
    );

    return (
      <options.TypesTable
        {...props}
        type={type}
        additionalTypes={additionalTypes}
        multiple={isMultipleMode}
      />
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    TypesComponent.displayName =
      meta?.displayName ||
      `${meta?.name?.replace(/ /g, '') || ''}${singleComponentName || exportName || ''}Types`;
  }

  return TypesComponent;
}

export function createTypesFactory<T extends {}>(options: AbstractCreateTypesOptions<T>) {
  /**
   * Creates a types table component for displaying TypeScript type information.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param typeDef The type definition object to extract types from.
   * @param [meta] Additional meta for the types table.
   */
  const createTypes = (url: string, typeDef: object, meta?: TypesTableMeta | undefined) => {
    return abstractCreateTypes(options, url, meta);
  };

  return createTypes;
}

export function createMultipleTypesFactory<T extends {}>(options: AbstractCreateTypesOptions<T>) {
  /**
   * Creates multiple types table components for displaying TypeScript type information.
   * Each key in the typeDef object will have a corresponding component in `types`.
   * Also returns an `AdditionalTypes` component for top-level non-namespaced types.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param typeDef The type definition object with multiple exports to extract types from.
   * @param [meta] Additional meta for the types tables.
   */
  const createMultipleTypes = <K extends Record<string, any>>(
    url: string,
    typeDef: K,
    meta?: TypesTableMeta | undefined,
  ) => {
    const types = {} as Record<keyof K, React.ComponentType<T>>;
    // When precompute data is available, use its exports keys instead of typeDef keys.
    // This allows the webpack loader to replace the typeDef with a plain object,
    // avoiding the need to import actual component modules at runtime.
    // Also include keys from variantTypeNames for namespace imports on types-only modules.
    let keys: (keyof K)[];
    if (meta?.precompute) {
      const exportKeys = Object.keys(meta.precompute.exports);
      // Add variant names that have types but no export (namespace imports on types-only modules)
      const variantKeys = meta.precompute.variantTypeNames
        ? Object.keys(meta.precompute.variantTypeNames).filter(
            (k) => !exportKeys.includes(k) && meta.precompute!.variantTypeNames![k].length > 0,
          )
        : [];
      keys = [...exportKeys, ...variantKeys] as (keyof K)[];
    } else {
      keys = Object.keys(typeDef) as (keyof K)[];
    }
    keys.forEach((key) => {
      types[key] = abstractCreateTypes(options, url, meta, String(key));
    });

    // Create AdditionalTypes component for top-level non-namespaced types
    const AdditionalTypes = createAdditionalTypesComponent(options, url, meta);

    return { types, AdditionalTypes };
  };

  return createMultipleTypes;
}

function createAdditionalTypesComponent<T extends {}>(
  options: AbstractCreateTypesOptions<T>,
  url: string,
  meta: TypesTableMeta | undefined,
): React.ComponentType<T> {
  if (!url.startsWith('file:')) {
    throw new Error(
      'createAdditionalTypesComponent() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || !meta.precompute) {
    throw new Error('createAdditionalTypesComponent() must be called within a `types.ts` file');
  }

  // Merge components from factory options and meta, with meta taking priority
  const components = {
    ...options.components,
    ...meta.components,
  };

  // Resolve named component slots (meta overrides options)
  const TypePre = meta.TypePre ?? options.TypePre;
  const DetailedTypePre = meta.DetailedTypePre ?? options.DetailedTypePre;
  const ShortTypeCode = meta.ShortTypeCode ?? options.ShortTypeCode;
  const DefaultCode = meta.DefaultCode ?? options.DefaultCode;
  const RawTypePre = meta.RawTypePre ?? options.RawTypePre;

  // Enhancers from meta completely override options.enhancers if set
  // Use DEFAULT_ENHANCERS if neither meta nor options specify enhancers
  // Then append enhanceCodeExportLinks if anchorMap is available
  let enhancers = meta.enhancers ?? options.enhancers ?? DEFAULT_ENHANCERS;
  if (
    meta.precompute.anchorMap &&
    (Object.keys(meta.precompute.anchorMap.js ?? {}).length > 0 ||
      Object.keys(meta.precompute.anchorMap.css ?? {}).length > 0)
  ) {
    const typeRefComponent = meta.typeRefComponent ?? options.typeRefComponent;
    const typePropRefComponent = meta.typePropRefComponent ?? options.typePropRefComponent;
    const typeParamRefComponent = meta.typeParamRefComponent ?? options.typeParamRefComponent;
    const linkProps = meta.linkProps ?? options.linkProps;
    const linkParams = meta.linkParams ?? options.linkParams;
    const linkScope = meta.linkScope ?? options.linkScope;
    const exportLinksOptions: Record<string, unknown> = { anchorMap: meta.precompute.anchorMap };
    if (typeRefComponent) {
      exportLinksOptions.typeRefComponent = typeRefComponent;
    }
    if (typePropRefComponent) {
      exportLinksOptions.typePropRefComponent = typePropRefComponent;
    }
    if (typeParamRefComponent) {
      exportLinksOptions.typeParamRefComponent = typeParamRefComponent;
    }
    if (linkProps) {
      exportLinksOptions.linkProps = linkProps;
    }
    if (linkParams) {
      exportLinksOptions.linkParams = linkParams;
    }
    if (linkScope) {
      exportLinksOptions.linkScope = linkScope;
    }
    enhancers = [...enhancers, [enhanceCodeExportLinks, exportLinksOptions]];
  }

  // Inline enhancers for shortType and default fields
  const enhancersInline =
    meta.enhancersInline ?? options.enhancersInline ?? DEFAULT_ENHANCERS_INLINE;

  const precompute = meta.precompute;

  // Include the "Default" variant-only types since they represent the catch-all
  // flat/common types that belong in the Additional Types section.
  const allAdditionalTypes = precompute.variantOnlyAdditionalTypes?.Default
    ? [...precompute.additionalTypes, ...precompute.variantOnlyAdditionalTypes.Default]
    : precompute.additionalTypes;

  function AdditionalTypesComponent(props: T) {
    const additionalTypes = React.useMemo(
      () =>
        additionalTypesToJsx(allAdditionalTypes, {
          components,
          TypePre,
          DetailedTypePre,
          ShortTypeCode,
          DefaultCode,
          RawTypePre,
          enhancers,
          enhancersInline,
        }),
      [],
    );

    return (
      <options.TypesTable {...props} type={undefined} additionalTypes={additionalTypes} multiple />
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    AdditionalTypesComponent.displayName = `${meta?.name?.replace(/ /g, '') || ''}AdditionalTypes`;
  }

  return AdditionalTypesComponent;
}
