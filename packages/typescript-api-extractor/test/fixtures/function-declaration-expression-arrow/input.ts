export function declaration(p: Parameters): void {}

export const greetAsExpression = function (p: Parameters): void {};

export const greetAsArrowFunction = (p: Parameters): void => {};

interface Parameters {
	s: string;
}
