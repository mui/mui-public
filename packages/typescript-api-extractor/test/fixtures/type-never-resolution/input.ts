export function fail(message: string): never {
	throw new Error(message);
}

export type Impossible = never;
