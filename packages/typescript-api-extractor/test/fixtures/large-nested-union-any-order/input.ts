type Forward =
	| ((x: ((y: 'a') => void) | ((y: 'b') => void) | ((y: 'c') => void) | ((y: 'd') => void)) => void)
	| ((
			x: ((y: 'd') => void) | ((y: 'c') => void) | ((y: 'b') => void) | ((y: 'a') => void),
	  ) => void);

type WithAnyFirst =
	| ((x: any) => void)
	| ((
			x: ((y: 'a') => void) | ((y: 'b') => void) | ((y: 'c') => void) | ((y: 'd') => void),
	  ) => void);

type WithAnySecond =
	| ((x: ((y: 'a') => void) | ((y: 'b') => void) | ((y: 'c') => void) | ((y: 'd') => void)) => void)
	| ((x: any) => void);

export type LargeNestedUnionOrderIndependent = Forward;
export type LargeNestedUnionAnyFirst = WithAnyFirst;
export type LargeNestedUnionAnySecond = WithAnySecond;
