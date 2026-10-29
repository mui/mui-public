/**
 * Union of generic callbacks that differ only by type parameter defaults.
 * Each signature should be preserved since they have different defaults.
 */
export type Fn = (<T = string>() => T) | (<T = number>() => T);
