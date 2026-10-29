export type Data<K extends string = string, V = any> = ReadonlyArray<{
	[key in K]?: V;
}>;
