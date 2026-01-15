import * as React from 'react';
import type { EnhancedTypesMeta } from '@mui/internal-docs-infra/pipeline/loadServerTypes';
import { typesToJsx, type ProcessedTypesMeta, type TypesJsxOptions } from './typesToJsx';

export type TypesTableMeta = {
  precompute?: {
    exports: {
      [variant: string]: {
        types: EnhancedTypesMeta[];
      };
    };
    singleComponentName?: string;
  };
  name?: string;
  displayName?: string;
  disableOptimization?: boolean;
  globalTypes?: string[];
  watchSourceDirectly?: boolean;
  /**
   * When true, excludes this component from the parent index page.
   * The component types will still be processed, but won't be added to the index.
   */
  excludeFromIndex?: boolean;
  components?: TypesJsxOptions['components'];
  inlineComponents?: TypesJsxOptions['components'];
};

export type TypesContentProps<T extends {}> = T & {
  types?: ProcessedTypesMeta[];
  multiple?: boolean;
};

type AbstractCreateTypesOptions<T extends {}> = {
  TypesContent: React.ComponentType<TypesContentProps<T>>;
  components?: TypesJsxOptions['components'];
  inlineComponents?: TypesJsxOptions['components'];
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

  let name = 'Default';
  if (exportName && singleComponentName) {
    name = `${singleComponentName}.${exportName}`;
  } else if (exportName) {
    name = exportName;
  }

  const rawTypes = meta?.precompute?.exports?.[name]?.types;

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
        ...options.components,
        ...(!meta.inlineComponents ? meta.components : {}),
        ...meta.inlineComponents,
      };

  function TypesComponent(props: T) {
    // Memoize the conversion from HAST to JSX
    const types = React.useMemo(() => typesToJsx(rawTypes, { components, inlineComponents }), []);

    return <options.TypesContent {...props} types={types} multiple={Boolean(exportName)} />;
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
   * Each key in the typeDef object will have a corresponding component.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param typeDef The type definition object with multiple exports to extract types from.
   * @param meta Additional meta for the types tables.
   */
  const createMultipleTypes = <K extends Record<string, any>>(
    url: string,
    typeDef: K,
    meta?: TypesTableMeta | undefined,
  ) => {
    const components = {} as Record<keyof K, React.ComponentType<T>>;
    (Object.keys(typeDef) as (keyof K)[]).forEach((key) => {
      components[key] = abstractCreateTypes(options, url, meta, String(key));
    });

    return components;
  };

  return createMultipleTypes;
}
