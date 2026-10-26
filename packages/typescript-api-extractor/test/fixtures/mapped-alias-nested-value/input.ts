export type MapAlias<K extends string, V = unknown> = {
	[P in K]?: { value: V };
};

export type Wrapped<K extends string, V = string> = MapAlias<K, V>;

export type UseWrapped<K extends string> = Wrapped<K>;
