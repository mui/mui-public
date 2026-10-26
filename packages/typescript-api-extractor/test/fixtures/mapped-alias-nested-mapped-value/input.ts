export type Outer<K extends string, L extends string, V = boolean> = {
	[P in K]?: { [Q in L]?: V };
};

export type Use<K extends string, L extends string> = Outer<K, L, number>;
