export function acceptsLiteralUnionProps(parameters: Params) {}

export function acceptsLiteralUnionParameters(
	inlineStringUnion: 'foo' | 'bar' | 'baz',
	inlineNumberUnion: 1 | 2 | 3,
	referencedStringUnion: StringUnion,
	referencedNumberUnion: NumberUnion,
	unionOfUnions: StringUnion | NumberUnion,
	indirectUnion: IndirectStringUnion | undefined,
) {}

export function acceptsKeyofProp(prop: keyof Params) {}

interface Params {
	inlineStringUnion: 'foo' | 'bar' | 'baz';
	inlineNumberUnion: 1 | 2 | 3;
	referencedStringUnion: StringUnion;
	referencedNumberUnion: NumberUnion;
	callback: (ref: StringUnion | undefined) => void;
	unionOfUnions: StringUnion | NumberUnion;
	indirectUnion: IndirectStringUnion | undefined;
}

type StringUnion = 'foo' | 'bar' | 'baz';
type IndirectStringUnion = StringUnion | 'qux';
type NumberUnion = 1 | 2 | 3;
