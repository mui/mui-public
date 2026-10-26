import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

const templateLiteralSource = `export type Fraction = \`\${number}fr\`;
export type Handler<T extends string> = \`on\${T}\`;`;

it('resolves template literals and their placeholders without warnings', () => {
	const filePath = '/virtual/template-literal.ts';
	const warnings: ParserWarning[] = [];

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, templateLiteralSource),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'Fraction',
			type: {
				kind: 'templateLiteral',
				texts: ['', 'fr'],
				types: [{ kind: 'intrinsic', intrinsic: 'number' }],
			},
		},
		{
			name: 'Handler',
			type: {
				kind: 'templateLiteral',
				texts: ['on', ''],
				types: [{ kind: 'typeParameter', name: 'T' }],
			},
		},
	]);
	expect(String(moduleDefinition.exports[1]?.type)).toBe('`on${T}`');
	expect(warnings).toEqual([]);
});

it('keeps template literals intact when external types are included', () => {
	const filePath = '/virtual/template-literal-external-types.ts';

	// The apparent type of a template literal is `String`, whose members would
	// otherwise be expanded once its external declaration is allowed.
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, templateLiteralSource),
		{ includeExternalTypes: true },
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'templateLiteral',
		texts: ['', 'fr'],
		types: [{ kind: 'intrinsic', intrinsic: 'number' }],
	});
});

it.each([false, true])(
	'keeps string mapping arguments in placeholders (includeExternalTypes: %s)',
	(includeExternalTypes) => {
		const filePath = '/virtual/template-literal-string-mapping.ts';

		const moduleDefinition = parseFromProgram(
			filePath,
			createInMemoryProgram(
				filePath,
				`export type Handler<T extends string> = \`on\${Capitalize<T>}\`;
export type EnvironmentVariable = \`APP_\${Uppercase<string>}\`;`,
			),
			{ includeExternalTypes },
		);

		expect(moduleDefinition.exports).toMatchObject([
			{
				type: {
					types: [
						{
							typeName: {
								name: 'Capitalize',
								typeArguments: [{ type: { kind: 'typeParameter', name: 'T' } }],
							},
						},
					],
				},
			},
			{
				type: {
					types: [
						{
							typeName: {
								name: 'Uppercase',
								typeArguments: [{ type: { kind: 'intrinsic', intrinsic: 'string' } }],
							},
						},
					],
				},
			},
		]);
		expect(moduleDefinition.exports.map((exportNode) => String(exportNode.type))).toEqual([
			'`on${Capitalize<T>}`',
			'`APP_${Uppercase<string>}`',
		]);
	},
);

it('renders template literal text that parses back to the same text', () => {
	const filePath = '/virtual/template-literal-rendering.ts';
	const parseTextType = (typeText: string) =>
		parseFromProgram(filePath, createInMemoryProgram(filePath, `export type Text = ${typeText};`))
			.exports[0]?.type;
	// TypeScript reads a raw carriage return in a template as a line feed, so it has to
	// stay escaped like the characters that end the template or start a placeholder.
	const expectedType = { kind: 'templateLiteral', texts: ['line\r\n\\ ` ${', ''] };

	const extractedType = parseTextType('`line\\r\\n\\\\ \\` \\${${string}`');
	const reparsedType = parseTextType(String(extractedType));

	expect(extractedType).toMatchObject(expectedType);
	expect(reparsedType).toMatchObject(expectedType);
});
