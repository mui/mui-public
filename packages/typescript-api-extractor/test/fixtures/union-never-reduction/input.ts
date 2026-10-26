/**
 * `never` should be removed from unions when other members are present.
 */
export type ValueOrNull<Value> = Value[] | Value | never | null;

export type OnValueChange<Value> = (value: ValueOrNull<Value>) => void;
