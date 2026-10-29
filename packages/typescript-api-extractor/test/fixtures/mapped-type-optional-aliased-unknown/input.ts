type U = unknown;

export type OptionalUnknownMap<K extends string = string> = {
	[P in K]?: U;
};
