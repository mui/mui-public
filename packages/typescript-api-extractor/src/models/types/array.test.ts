import { expect, it } from 'vitest';
import { IntrinsicNode } from './intrinsic';
import { ArrayNode } from './array';
import { TupleNode } from './tuple';

it('parenthesizes nested readonly containers to preserve array precedence', () => {
	const readonlyArray = new ArrayNode(undefined, new IntrinsicNode('string'), true);
	const readonlyTuple = new TupleNode(
		undefined,
		[new IntrinsicNode('string'), new IntrinsicNode('number')],
		true,
	);

	expect(new ArrayNode(undefined, readonlyArray).toString()).toBe('(readonly string[])[]');
	expect(new ArrayNode(undefined, readonlyArray, true).toString()).toBe(
		'readonly (readonly string[])[]',
	);
	expect(new ArrayNode(undefined, readonlyTuple).toString()).toBe('(readonly [string, number])[]');
});
