export type Data<K extends `prefix_${string}` = `prefix_${string}`, V = unknown> = ReadonlyArray<{
	[key in K]?: V;
}>;
