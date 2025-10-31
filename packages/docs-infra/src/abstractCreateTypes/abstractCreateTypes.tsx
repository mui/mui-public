import * as React from 'react';
import type { TypesMeta } from '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta';
import { typesToJsx, type ProcessedTypesMeta, type TypesJsxOptions } from './typesToJsx';

export type TypesTableMeta = {
  precompute?: {
    [variant: string]: {
      types?: TypesMeta[];
      importedFrom: string;
    };
  };
  name?: string;
  displayName?: string;
  disableOptimization?: boolean;
  globalTypes?: string[];
  watchSourceDirectly?: boolean;
  components?: TypesJsxOptions['components'];
};

export type TypesContentProps<T extends {}> = T & {
  types?: ProcessedTypesMeta[];
  multiple?: boolean;
};

type AbstractCreateTypesOptions<T extends {}> = {
  TypesContent: React.ComponentType<TypesContentProps<T>>;
  components?: TypesJsxOptions['components'];
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

  const rawTypes = meta?.precompute?.[exportName || 'Default']?.types;

  // Merge components from factory options and meta, with meta taking priority
  const components = {
    ...options.components,
    ...meta.components,
  };

  function TypesComponent(props: T) {
    // Memoize the conversion from HAST to JSX
    const types = React.useMemo(() => typesToJsx(rawTypes, { components }), []);

    return <options.TypesContent {...props} types={types} multiple={Boolean(exportName)} />;
  }

  if (process.env.NODE_ENV !== 'production') {
    TypesComponent.displayName =
      meta?.displayName || `${meta?.name?.replace(/ /g, '') || ''}${exportName || ''}Types`;
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
