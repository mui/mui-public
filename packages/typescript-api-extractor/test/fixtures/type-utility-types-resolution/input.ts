interface Base {
	a: boolean;
	b?: string;
	c: number;
}

export function acceptsPickedProps(params: Pick<Base, 'a' | 'b'>) {}

export function acceptsOmittedProps(params: Omit<Base, 'c'>): number {
	return 1;
}

export function acceptsParameterTuple(params: Parameters<typeof acceptsPickedProps>) {}

export function acceptsReturnType(params: ReturnType<typeof acceptsOmittedProps>) {}
