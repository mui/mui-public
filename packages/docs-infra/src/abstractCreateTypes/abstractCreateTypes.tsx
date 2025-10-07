import * as React from 'react';
import type { TypesMeta } from '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta';

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
};

export type TypesContentProps<T extends {}> = T & {
  types?: TypesMeta[];
};

type AbstractCreateTypesOptions<T extends {}> = {
  TypesContent: React.ComponentType<TypesContentProps<T>>;
};

export function abstractCreateTypes<T extends {}>(
  options: AbstractCreateTypesOptions<T>,
  url: string,
  typeDef: object,
  exportName: string,
  meta: TypesTableMeta | undefined,
): React.ComponentType<T> {
  if (!url.startsWith('file:')) {
    throw new Error(
      'abstractCreateTypes() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || !meta.precompute) {
    throw new Error('abstractCreateTypes() must be called within a `types.ts` file');
  }

  const types = meta?.precompute?.[exportName || 'Default']?.types;

  function TypesComponent(props: T) {
    return <options.TypesContent {...props} types={types} />;
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
    return abstractCreateTypes(options, url, typeDef, '', meta);
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
  const createMultipleTypes = <TD extends Record<string, any>>(
    url: string,
    typeDef: TD,
    meta?: TypesTableMeta | undefined,
  ) => {
    const components = {} as Record<keyof TD, React.ComponentType<T>>;
    (Object.keys(typeDef) as (keyof TD)[]).forEach((key) => {
      components[key] = abstractCreateTypes(options, url, typeDef, String(key), meta);
    });

    return components;
  };

  return createMultipleTypes;
}
