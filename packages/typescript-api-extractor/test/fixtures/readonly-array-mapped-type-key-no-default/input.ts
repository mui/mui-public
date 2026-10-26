export type Data<K extends string, V = unknown> = ReadonlyArray<{
	[key in K]?: V;
}>;
