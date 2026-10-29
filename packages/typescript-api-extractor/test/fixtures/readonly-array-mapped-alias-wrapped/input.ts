export type MapAlias<K extends string, V = unknown> = {
	[P in K]?: V;
};

export type Wrapped<K extends string, V = string> = ReadonlyArray<MapAlias<K, V>>;
