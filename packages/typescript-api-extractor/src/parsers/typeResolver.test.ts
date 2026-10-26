import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

const classParameterAliasSource = `type AliasedAny = any;

export class ClassWithAliasedAny {
  constructor(ctorParam?: AliasedAny | undefined) {}

  method(methodParam?: AliasedAny | undefined): void {}
}`;
const callableAliasSource = `export namespace API {
  export type Handler<T = string> = (value: T) => void;
}

export type PublicHandler = API.Handler<number>;`;

it('preserves authored union aliases for class parameters', () => {
	const filePath = '/virtual/class-parameter-alias.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, classParameterAliasSource),
	);
	const aliasedAnyUnion = {
		kind: 'union',
		types: [
			{
				kind: 'intrinsic',
				intrinsic: 'any',
				typeName: {
					name: 'AliasedAny',
				},
			},
			{
				kind: 'intrinsic',
				intrinsic: 'undefined',
			},
		],
	};

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'class',
		constructSignatures: [
			{
				parameters: [
					{
						name: 'ctorParam',
						type: aliasedAnyUnion,
					},
				],
			},
		],
		methods: [
			{
				name: 'method',
				callSignatures: [
					{
						parameters: [
							{
								name: 'methodParam',
								type: aliasedAnyUnion,
							},
						],
					},
				],
			},
		],
	});
});

it('uses the session-computed type name for callable aliases', () => {
	const filePath = '/virtual/callable-alias.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, callableAliasSource),
	);

	const publicHandler = moduleDefinition.exports.find(
		(exportNode) => exportNode.name === 'PublicHandler',
	);
	expect(publicHandler?.type).toMatchObject({
		kind: 'function',
		typeName: {
			name: 'Handler',
			namespaces: ['API'],
			typeArguments: [
				{
					type: {
						kind: 'intrinsic',
						intrinsic: 'number',
					},
					equalToDefault: false,
				},
			],
		},
	});
});
