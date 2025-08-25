import type { ModuleNode } from 'typescript-api-extractor';

export type TypesMeta = {
  types?: ModuleNode;
};

export function useTypes(props: TypesMeta): TypesMeta {
  return { types: props.types };
}
