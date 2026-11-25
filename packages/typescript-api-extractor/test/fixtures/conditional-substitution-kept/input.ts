type IsAny<Value> = 0 extends 1 & Value ? true : false;

/** A narrower type argument than the constraint takes the other branch. */
export type Value<Mode extends string> = Mode extends 'multiple'
  ? { value: string[] }
  : { value: string };

/** The branch depends on the type argument, whatever the default. */
export type Selected<Item, Multiple extends boolean = false> = Multiple extends true
  ? { value: Item[] }
  : { value: Item };

/** Nothing bounds the tested type parameter. */
export type Unconstrained<Multiple> = Multiple extends true ? { value: string[] } : { value: string };

/** The constraint and `never` take different branches. */
export type Middle<Key extends 'a' | 'b'> = [Key] extends ['a']
  ? [Key] extends [never]
    ? { none: true }
    : { a: true }
  : { other: true };

/** A distributive condition, left to the type resolvers. */
export type Items<List extends readonly string[]> = List extends readonly unknown[]
  ? { items: List }
  : { item: List };

/** The export documents the value that shares the alias's name. */
export function Merged(props: { row: string }) {
  return props.row;
}

export type Merged<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

type IsEqual<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

/** Both ends of the constraint take one branch, one of its members the other. */
export type Selection<Mode extends 'single' | 'multiple'> =
  IsEqual<Mode, 'multiple'> extends true ? { value: string[] } : { value: string };

export type SelectionMode = 'single' | 'multiple';

/** The same, with the union constraint behind a name. */
export type AliasedSelection<Mode extends SelectionMode> =
  IsEqual<Mode, 'multiple'> extends true ? { value: string[] } : { value: string };

/** The same, with `boolean` as the union constraint. */
export type FlagSelection<Multiple extends boolean> =
  IsEqual<Multiple, true> extends true ? { value: string[] } : { value: string };
