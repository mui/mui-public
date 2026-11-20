type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type DataGridRowCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };
