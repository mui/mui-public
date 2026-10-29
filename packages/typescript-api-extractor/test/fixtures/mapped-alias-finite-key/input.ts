export type MapAlias<K extends string, V = unknown> = {
	[P in K]?: V;
};

export type Specialized = MapAlias<'a' | 'b'>;

export type LiteralWrapped<K extends 'a' | 'b'> = MapAlias<K>;
