import * as React from 'react';
import type { PluggableList } from 'unified';
import type { EnhancedTypesMeta } from '@mui/internal-docs-infra/pipeline/loadServerTypes';
import enhanceCodeInlineElements from '../pipeline/enhanceCodeInlineElements';
import {
  typeToJsx,
  additionalTypesToJsx,
  type ProcessedTypesMeta,
  type TypesJsxOptions,
} from './typesToJsx';

/**
 * Default enhancers applied when no enhancers are specified.
 */
const DEFAULT_ENHANCERS: PluggableList = [enhanceCodeInlineElements];

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
     * Top-level types that are not namespaced under any component part.
     * For example, `InputType` that is exported directly without a namespace prefix.
     */
    additionalTypes: EnhancedTypesMeta[];
    singleComponentName?: string;
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
  inlineComponents?: TypesJsxOptions['inlineComponents'];
  /**
   * Rehype plugins to run on HAST before converting to JSX.
   * If set, completely overrides enhancers from AbstractCreateTypesOptions.
   * Defaults to `[enhanceCodeInlineElements]` when undefined.
   * Pass an empty array to disable all enhancers.
   */
  enhancers?: PluggableList;
};

export type TypesContentProps<T extends {}> = T & {
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

type AbstractCreateTypesOptions<T extends {}> = {
  TypesContent: React.ComponentType<TypesContentProps<T>>;
  components?: TypesJsxOptions['components'];
  inlineComponents?: TypesJsxOptions['inlineComponents'];
  /**
   * Rehype plugins to run on HAST before converting to JSX.
   * Can be overridden by TypesTableMeta.enhancers.
   * Defaults to `[enhanceCodeInlineElements]` when undefined.
   * Pass an empty array to disable all enhancers.
   */
  enhancers?: PluggableList;
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

  const inlineComponents = options.inlineComponents
    ? {
        ...options.inlineComponents,
        ...meta.inlineComponents,
      }
    : {
        ...(options.components as TypesJsxOptions['inlineComponents']),
        ...(!meta.inlineComponents ? (meta.components as TypesJsxOptions['inlineComponents']) : {}),
        ...meta.inlineComponents,
      };

  // Enhancers from meta completely override options.enhancers if set
  // Use DEFAULT_ENHANCERS if neither meta nor options specify enhancers
  const enhancers = meta.enhancers ?? options.enhancers ?? DEFAULT_ENHANCERS;

  // Extract precompute reference to avoid null checks inside component
  const precompute = meta.precompute;

  // Determine target export name outside component - it's static
  const targetExportName = exportName || singleComponentName || Object.keys(precompute.exports)[0];

  // For single component mode (createTypes), include global additional types
  // For multiple component mode (createMultipleTypes), they go to the separate AdditionalTypes component
  const isMultipleMode = Boolean(exportName);

  function TypesComponent(props: T) {
    // Memoize the conversion from HAST to JSX - only for the single export we need
    const { type, additionalTypes } = React.useMemo(
      () =>
        typeToJsx(
          precompute.exports[targetExportName],
          precompute.additionalTypes,
          { components, inlineComponents, enhancers },
          !isMultipleMode, // includeGlobalAdditionalTypes: true for single, false for multiple
        ),
      [],
    );

    return (
      <options.TypesContent
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
   * @param meta Additional meta for the types table.
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
   * @param meta Additional meta for the types tables.
   */
  const createMultipleTypes = <K extends Record<string, any>>(
    url: string,
    typeDef: K,
    meta?: TypesTableMeta | undefined,
  ) => {
    const types = {} as Record<keyof K, React.ComponentType<T>>;
    (Object.keys(typeDef) as (keyof K)[]).forEach((key) => {
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

  const inlineComponents = options.inlineComponents
    ? {
        ...options.inlineComponents,
        ...meta.inlineComponents,
      }
    : {
        ...(options.components as TypesJsxOptions['inlineComponents']),
        ...(!meta.inlineComponents ? (meta.components as TypesJsxOptions['inlineComponents']) : {}),
        ...meta.inlineComponents,
      };

  // Enhancers from meta completely override options.enhancers if set
  // Use DEFAULT_ENHANCERS if neither meta nor options specify enhancers
  const enhancers = meta.enhancers ?? options.enhancers ?? DEFAULT_ENHANCERS;

  const precompute = meta.precompute;

  function AdditionalTypesComponent(props: T) {
    // Memoize the conversion from HAST to JSX for additional types only
    const additionalTypes = React.useMemo(
      () =>
        additionalTypesToJsx(precompute.additionalTypes, {
          components,
          inlineComponents,
          enhancers,
        }),
      [],
    );

    return (
      <options.TypesContent
        {...props}
        type={undefined}
        additionalTypes={additionalTypes}
        multiple
      />
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    AdditionalTypesComponent.displayName = `${meta?.name?.replace(/ /g, '') || ''}AdditionalTypes`;
  }

  return AdditionalTypesComponent;
}
