export type Data<K extends string = string, V = unknown> = ReadonlyArray<{
	[key in K]?: V;
}>;
