export type Data<V, K extends string = string> = ReadonlyArray<{
	[key in K]?: V;
}>;
