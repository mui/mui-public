import type * as React from 'react';

/**
 * This is a test.
 *
 * @example
 * documentedFunction();
 *
 * @type {function}
 * @public
 * @category important-functions
 */
export function documentedFunction(params: Params) {}

interface Params {
	s: string;
	/**
	 * @type {Integer}
	 */
	n: number;
	onChange: (
		event: React.ChangeEvent<HTMLInputElement>,
		/** @type ChangeReason */
		reason: string | undefined,
	) => void;
	/**
	 * For internal use only
	 * @internal
	 */
	_id?: string;
}
