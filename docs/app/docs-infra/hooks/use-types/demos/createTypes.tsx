import * as React from 'react';
import type { TypesMeta } from '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta';
import { TypesTable, TypesTableProps } from './TypesTable';

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

function createComponent({
  exportName,
  displayName,
  name,
  types,
}: {
  exportName: string;
  displayName?: string;
  name?: string;
  types?: TypesMeta[];
}) {
  function Component(props: TypesTableProps) {
    return <TypesTable {...props} types={types} />;
  }

  if (process.env.NODE_ENV !== 'production') {
    Component.displayName =
      displayName || `${name?.replace(/ /g, '') || ''}${exportName || ''}Types`;
  }

  return Component;
}

export function createTypes(url: string, typeDef: object, meta?: TypesTableMeta | undefined) {
  if (!url.startsWith('file:')) {
    throw new Error(
      'createTypes() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || !meta.precompute) {
    throw new Error('createTypes() must be called within a `types.ts` file');
  }

  const types = meta?.precompute?.Default?.types;

  return createComponent({
    exportName: '',
    displayName: meta?.displayName,
    name: meta?.name,
    types,
  });
}

export function createMultipleTypes<T extends Record<string, any>>(
  url: string,
  typeDef: T,
  meta?: TypesTableMeta | undefined,
) {
  if (!url.startsWith('file:')) {
    throw new Error(
      'createTypes() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || !meta.precompute) {
    throw new Error('createTypes() must be called within a `types.ts` file');
  }

  const components = {} as Record<keyof T, React.ComponentType<TypesTableProps>>;
  (Object.keys(typeDef) as (keyof T)[]).forEach((key) => {
    components[key] = createComponent({
      exportName: String(key),
      displayName: meta?.displayName,
      name: meta?.name,
      types: meta?.precompute?.[String(key)]?.types,
    });
  });

  return components;
}
