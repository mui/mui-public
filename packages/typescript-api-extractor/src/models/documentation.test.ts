import { expect, it } from 'vitest';
import { Documentation } from '../index';

it('returns JSDoc tag values by name', () => {
	const documentation = new Documentation('Description.', undefined, undefined, [
		{ name: 'category', value: 'layout' },
	]);

	expect(documentation.getTagValue('category')).toBe('layout');
	expect(documentation.getTagValue('missing')).toBeUndefined();
});
