/**
 * Union of generic callbacks whose type parameter names differ and whose
 * constraints contain property keys matching those type parameter names.
 * These are NOT alpha-equivalent because { T: string } !== { U: string }.
 * Both signatures must be preserved in the output.
 */
export type Fn = (<T extends { T: string }>() => T) | (<U extends { U: string }>() => U);
