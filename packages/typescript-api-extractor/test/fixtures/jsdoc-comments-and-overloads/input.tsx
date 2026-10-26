import * as React from 'react';

/**
 * The test component.
 *
 * @internal
 */
export function TestComponent(props: Props): React.ReactElement {
	return <div {...props} />;
}

interface Props {
	/**
	 * The class name.
	 * Used to make the component more classy.
	 */
	className?: string;
	/**
	 * A value.
	 *
	 * @default 10
	 */
	someValue?: number;
}

/**
 * A test function
 *
 * @remarks
 * This is a test function.
 *
 * @param p1 The first parameter which is a number
 * @param p2 The second parameter
 * @returns The return value
 * @public
 * @example testFunction('test', 10);
 */
export function testFunction(p1: number, p2?: number): number;
/**
 * A test function
 *
 * @remarks
 * This is a test function.
 *
 * @param p1 The first parameter which is a string
 * @param p2 The second parameter
 * @returns The return value
 * @public
 * @example testFunction('test', 10);
 */
export function testFunction(p1: string, p2?: number): number;
export function testFunction(p1: string | number, p2: number = 20): number | undefined {
	return 10;
}
