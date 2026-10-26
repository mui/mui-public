interface MergedCall {
	<T extends string = 'x'>(value: T): T;
}

interface MergedCall {
	<T extends number = 1>(value: T): T;
}

export type MergedCallWithTypeParams = MergedCall;
