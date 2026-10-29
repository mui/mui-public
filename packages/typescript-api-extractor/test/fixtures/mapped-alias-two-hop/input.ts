export type Inner<K extends string, V = unknown> = {
	[P in K]?: V;
};

export type Middle<K extends string, V = boolean> = Inner<K, V>;

export type Outer<K extends string, V = number> = Middle<K, V>;

export type UseOuter<K extends string> = Outer<K>;
