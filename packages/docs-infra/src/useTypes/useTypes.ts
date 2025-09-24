import type { TypesMeta } from '../pipeline/loadPrecomputedTypesMeta/loadPrecomputedTypesMeta';

export type Types = {
  types?: TypesMeta[];
};

export function useTypes(props: Types): Types {
  return { types: props.types };
}
