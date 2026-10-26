export type Data<K extends number = number, V = unknown> = ReadonlyArray<{
	[key in K]?: V;
}>;
