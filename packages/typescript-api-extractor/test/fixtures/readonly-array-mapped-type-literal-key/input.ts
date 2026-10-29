// Direct mapped type with string literals: should produce concrete properties, not an index signature
export type DirectData = ReadonlyArray<{
	[key in 'a' | 'b']?: unknown;
}>;

// Via type parameter constrained to string literals: should NOT produce a string index signature
export type ParametricData<K extends 'a' | 'b'> = ReadonlyArray<{
	[key in K]?: unknown;
}>;
