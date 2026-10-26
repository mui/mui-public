import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

// Open string unions such as `'small' | (string & {})` suggest known values while still
// accepting any string. `keyof` cannot resolve their `string & {}` key, so a constraint
// over their keys warns.
const openUnionKeys = "keyof Record<'small' | 'large' | (string & {}), number>";
const substitutionTypeSource = 'export type X<T> = T extends string ? T : never;';
const substitutionTypeWithUnsupportedConstraintSource = `export type X<T extends ${openUnionKeys}> = T extends string ? T : never;`;
const substitutionObjectTypeWithUnsupportedConstraintSource = `export type X<T extends ${openUnionKeys}> = T extends string ? { v: T } : never;`;
const extractUtilitySource = 'export type StringKeys<T> = Extract<keyof T, string>;';
const constrainedExtractUtilitySource =
	'export type KeepStrings<T extends string> = Extract<T, string>;';
const shadowedExtractSource = `type Extract<T, U> = T extends U ? T : number;
export type ShadowedExtract<T> = Extract<T, string>;`;

it('resolves the built-in Extract utility from its base constraint', () => {
	const filePath = '/virtual/extract-utility.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, extractUtilitySource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
});

it('keeps the type parameter when Extract narrows a constrained type parameter', () => {
	const filePath = '/virtual/constrained-extract-utility.ts';

	// `Extract<T, string>` with `T extends string` is exactly `T`, so it must
	// resolve like the equivalent `T extends string ? T : never` conditional
	// instead of collapsing to the `string` base constraint.
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, constrainedExtractUtilitySource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeParameter',
				name: 'T',
				constraint: {
					kind: 'intrinsic',
					intrinsic: 'string',
				},
			},
		],
	});
});

it('does not treat a local Extract alias as the built-in utility', () => {
	const filePath = '/virtual/shadowed-extract.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, shadowedExtractSource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeParameter',
				name: 'T',
			},
			{
				kind: 'intrinsic',
				intrinsic: 'number',
			},
		],
	});
});

it('resolves substitution types from representable base types', () => {
	const filePath = '/virtual/substitution-fallback.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, substitutionTypeSource),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeParameter',
				name: 'T',
			},
		],
	});
});

it('does not report unsupported warnings when a substitution fallback succeeds', () => {
	const filePath = '/virtual/substitution-fallback-warning.ts';
	const warnings: ParserWarning[] = [];

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, substitutionTypeWithUnsupportedConstraintSource),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'intrinsic',
				intrinsic: 'string',
			},
		],
	});
	expect(warnings).toEqual([]);
});

it('reports conditional name warnings when the resolved type keeps the conditional alias name', () => {
	const filePath = '/virtual/substitution-fallback-object-warning.ts';
	const warnings: ParserWarning[] = [];

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, substitutionObjectTypeWithUnsupportedConstraintSource),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'object',
		typeName: {
			name: 'X',
			typeArguments: [
				{
					type: {
						kind: 'typeParameter',
						name: 'T',
						constraint: {
							kind: 'typeOperator',
							operator: 'keyof',
							resolutionKind: 'fallback',
						},
					},
				},
			],
		},
		properties: [
			{
				name: 'v',
			},
		],
	});
	expect(warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: 'unsupported-type-fallback',
				typeFlags: ['Intersection'],
				typeText: 'string & {}',
				sourceText: 'T extends string ? { v: T } : never',
			}),
		]),
	);
});

it('preserves expanded external keyof aliases in type parameter constraints and defaults', () => {
	const filePath = '/virtual/external-keyof-type-parameter-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'external-keyof-type-parameter-package';

export type Generic<T extends Keys = Keys> = T;`,
					'/virtual/node_modules/external-keyof-type-parameter-package/index.d.ts': `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);
	const typeParameter = moduleDefinition.exports[0]?.type;
	const expectedOperator = { kind: 'typeOperator', operator: 'keyof' };

	expect(typeParameter).toMatchObject({
		kind: 'typeParameter',
		name: 'T',
		constraint: expectedOperator,
		defaultValue: expectedOperator,
	});
});

it('preserves expanded external keyof aliases in conditional branches', () => {
	const filePath = '/virtual/external-keyof-conditional-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					{
						[filePath]: `import type { Keys } from 'external-keyof-conditional-package';

export type Maybe<T> = T extends unknown ? Keys<T> : never;`,
						'/virtual/node_modules/external-keyof-conditional-package/index.d.ts':
							'export type Keys<T> = keyof T;',
					},
					{ noLib: true },
				),
				{ includeExternalTypes: true },
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});
