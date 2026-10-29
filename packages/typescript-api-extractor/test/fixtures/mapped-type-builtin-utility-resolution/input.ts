interface Base {
	a: boolean;
	b?: string;
}

type PartialType = Partial<Base>;
type RequiredType = Required<Base>;

export function partialAlias(params: PartialType) {}

export function requiredAlias(params: RequiredType) {}

export function inlinePartial(params: Partial<Base>) {}

export function inlineRequired(params: Required<Base>) {}
