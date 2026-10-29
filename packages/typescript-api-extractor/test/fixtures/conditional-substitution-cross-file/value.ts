import type { DataGridRowCell } from './types';

type DataGridValueCell<R, C extends readonly { id: string }[]> = DataGridRowCell<R, C>;

export namespace DataGridValue {
  /** Forwards through two aliases to a condition on a helper private to another file. */
  export type Cell<Row, Columns extends readonly { id: string }[]> = DataGridValueCell<
    Row,
    Columns
  >;
}
