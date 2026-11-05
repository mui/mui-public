type IsAny<Value> = 0 extends 1 & Value ? true : false;

/** Resolves through the constraint, the branch every type argument but `any` takes. */
export type Cell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };

/** A default of `any` is ignored in favor of the constraint. */
export type DefaultedCell<Row, Columns extends readonly { id: string }[] = any> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };

/** The tested type parameter only appears on the extends side. */
export type InlineCell<Columns extends readonly { id: string }[]> = 0 extends 1 & Columns
  ? { columnId: any }
  : { columnId: Columns[number]['id'] };

/** A type parameter constrained by a tested one stays generic. */
export type IdCell<Columns extends readonly { id: string }[], Id extends Columns[number]['id']> =
  IsAny<Columns> extends true ? { columnId: any } : { columnId: Id };

/** The same declaration reached under a second export name. */
export type { Cell as RowCell };

type ForwardedCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

export namespace DataGrid {
  export interface ColumnData {
    id: string;
  }

  /** The constraint refers to a name only visible inside the namespace. */
  export type RowCell<Row, Columns extends readonly ColumnData[]> =
    IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

  /** Forwards its type parameters to a conditional alias. */
  export type Cell<Row, Columns extends readonly { id: string }[]> = ForwardedCell<Row, Columns>;
}
