import { TypesTable, TypesTableProps } from './TypesTable';
import type { ModuleNode } from 'typescript-api-extractor';

export type TypesTableMeta = {
  precompute?: {
    [variant: string]: {
      types?: ModuleNode;
      importedFrom: string;
    };
  };
  name?: string;
  displayName?: string;
  disableOptimization?: boolean;
  globalTypes: string[];
};

export function createTypes(
  url: string,
  typeDef: any,
  meta?: TypesTableMeta | undefined,
): React.ComponentType<TypesTableProps> {
  if (!url.startsWith('file:')) {
    throw new Error(
      'createTypes() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || !meta.precompute) {
    throw new Error('createTypes() must be called within a `types.ts` file');
  }

  const types = meta?.precompute?.Default?.types;

  function Component(props: TypesTableProps) {
    return <TypesTable {...props} types={types} name={meta?.name} />;
  }

  if (process.env.NODE_ENV !== 'production') {
    const displayName = meta?.displayName || `${meta?.name?.replace(/ /g, '')}Types`;
    Component.displayName = displayName;
  }

  return Component;
}
