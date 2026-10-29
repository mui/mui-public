export type Data<K extends string = string, V = string | number> = ReadonlyArray<{
	[key in K]?: V;
}>;
