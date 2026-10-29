export function f(x: Params) {}

export interface Props {
	x: Params;
}

type Params = Alias | 0;

type SomeType = 1 | 2;
type Alias = SomeType;
