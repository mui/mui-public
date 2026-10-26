import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { parseFromProgram, type ParserWarning } from '../../index';
import { FunctionNode, TypeOperatorNode } from '../../models';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

function createExportLookup<TModule extends { exports: readonly { name: string }[] }>(
	moduleDefinition: TModule,
) {
	type Export = TModule['exports'][number];
	return (name: string): Export | undefined =>
		moduleDefinition.exports.find((exportNode) => exportNode.name === name) as Export | undefined;
}

function parseModuleExports(filePath: string, program: ts.Program) {
	const parsedModule = parseFromProgram(filePath, program);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));
	return {
		moduleDefinition,
		exportByName: createExportLookup(moduleDefinition),
		parsedExportByName: createExportLookup(parsedModule),
	};
}

function parseSerializedModule(filePath: string, program: ts.Program) {
	return parseModuleExports(filePath, program).moduleDefinition;
}

function expectedKeyofOperator(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Params' } },
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
		resolutionKind: 'exact',
		...overrides,
	};
}

const referenceFormsDependencyPath = '/virtual/keyof-reference-forms-dependency.ts';
const referenceFormsSourcePath = '/virtual/keyof-reference-forms-source.ts';
const referenceFormsEntryPath = '/virtual/keyof-reference-forms-entry.ts';
const referenceFormsDependencySource = `export interface Params {
  dependency: string;
}
export type Keys = keyof Params;`;
const referenceFormsSource = `interface LocalParams {
  local: string;
}
namespace LocalTypes {
  export type Keys = keyof LocalParams;
}

import RelativeTypes = require('./keyof-reference-forms-dependency');
import MappedTypes = require('@project/keyof-reference-forms-dependency');

export type LocalQualifiedKeys = LocalTypes.Keys;
export type ImportTypeKeys = import('./keyof-reference-forms-dependency').Keys;
export type ImportEqualsKeys = RelativeTypes.Keys;
export type PathMappedKeys = MappedTypes.Keys;`;
const referenceFormsEntrySource = `export {
  type LocalQualifiedKeys,
  type ImportTypeKeys,
  type ImportEqualsKeys,
  type PathMappedKeys,
} from './keyof-reference-forms-source';`;
const referenceFormsCompilerOptions = {
	baseUrl: '/virtual',
	paths: { '@project/*': ['*'] },
};

function expectReferenceFormExports(
	exportByName: (name: string) => { type: unknown } | undefined,
): void {
	expect(exportByName('LocalQualifiedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'LocalParams' } },
	});
	for (const name of ['ImportTypeKeys', 'ImportEqualsKeys', 'PathMappedKeys']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
		});
	}
}

it('preserves concrete keyof operators instead of expanding them to literal unions', () => {
	const filePath = path.resolve(process.cwd(), 'virtual-keyof-react.tsx');
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`import * as React from 'react';

export interface Parameters {
  defaultTagName?: keyof React.JSX.IntrinsicElements;
}`,
					{ jsx: ts.JsxEmit.ReactJSX },
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'object',
		properties: [
			{
				name: 'defaultTagName',
				optional: true,
				type: {
					kind: 'union',
					types: [
						{
							kind: 'typeOperator',
							operator: 'keyof',
							resolutionKind: 'exact',
							type: {
								kind: 'external',
								typeName: {
									name: 'IntrinsicElements',
									namespaces: ['React', 'JSX'],
								},
							},
							resolvedType: {
								kind: 'union',
								types: expect.arrayContaining([
									{
										kind: 'literal',
										value: '"symbol"',
									},
									{
										kind: 'literal',
										value: '"object"',
									},
									{
										kind: 'literal',
										value: '"a"',
									},
								]),
							},
						},
						{
							kind: 'intrinsic',
							intrinsic: 'undefined',
						},
					],
				},
			},
		],
	});

	const typeOperatorNode = moduleDefinition.exports[0]?.type.properties[0].type.types[0];
	expect(typeOperatorNode.resolvedType.types.length).toBeGreaterThan(100);
});

it('can omit checker-resolved type-operator payloads', () => {
	const filePath = '/virtual/keyof-syntax-only.ts';
	const program = createInMemoryProgram(
		filePath,
		`interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
	);
	const moduleDefinition = parseFromProgram(filePath, program, {
		typeOperatorOutput: 'syntaxOnly',
	});
	const typeOperator = moduleDefinition.exports[0]?.type;

	expect(typeOperator).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', typeName: { name: 'Params' } },
	});
	expect(typeOperator).not.toHaveProperty('resolvedType');
	expect(typeOperator).not.toHaveProperty('resolutionKind');
});

it('keeps distinct keyof-any and keyof-string callbacks in syntax-only output', () => {
	const filePath = '/virtual/keyof-syntax-only-callbacks.ts';
	const program = createInMemoryProgram(
		filePath,
		`export type Callbacks =
  | ((key: keyof any) => void)
  | ((key: keyof string) => void);`,
	);
	const moduleDefinition = parseSerializedModule(filePath, program);
	const syntaxOnlyModuleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(filePath, program, {
				typeOperatorOutput: 'syntaxOnly',
			}),
		),
	);
	const syntaxOnlyCallbacks = syntaxOnlyModuleDefinition.exports[0]?.type.types;

	expect(moduleDefinition.exports[0]?.type.types).toHaveLength(2);
	expect(syntaxOnlyCallbacks).toHaveLength(2);
	expect(
		syntaxOnlyCallbacks.map(
			(callback: { callSignatures: Array<{ parameters: Array<{ type: { type: unknown } }> }> }) =>
				callback.callSignatures[0].parameters[0].type.type,
		),
	).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'any' },
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
});

it('preserves authored type-query operands without expanding their value shape', () => {
	const filePath = '/virtual/keyof-type-query.ts';
	const dependencyPath = '/virtual/keyof-type-query-dependency.ts';
	const { exportByName, parsedExportByName } = parseModuleExports(
		filePath,
		createInMemoryProgram({
			[filePath]: `const value = { a: 1, b: 2 };

export type Keys = keyof typeof value;
export type ImportedKeys = keyof typeof import("./keyof-type-query-dependency");
export type CommentedImportedKeys = keyof typeof/*comment*/ import("./keyof-type-query-dependency");`,
			[dependencyPath]: `export const importedValue = 1;
export const importedText = 'text';`,
		}),
	);

	expect(exportByName('Keys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'typeQuery',
			expressionName: 'value',
		},
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
	});
	expect(exportByName('ImportedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'typeQuery',
			expressionName: 'import("./keyof-type-query-dependency")',
		},
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"importedValue"' },
				{ kind: 'literal', value: '"importedText"' },
			],
		},
	});
	expect(exportByName('CommentedImportedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'typeQuery',
			expressionName: 'import("./keyof-type-query-dependency")',
		},
	});
	expect(parsedExportByName('Keys')?.type.toString()).toBe('keyof typeof value');
	expect(parsedExportByName('ImportedKeys')?.type.toString()).toBe(
		'keyof typeof import("./keyof-type-query-dependency")',
	);
	expect(parsedExportByName('CommentedImportedKeys')?.type.toString()).toBe(
		'keyof typeof import("./keyof-type-query-dependency")',
	);
});

it('preserves readonly array and tuple operands', () => {
	const filePath = '/virtual/keyof-readonly-operands.ts';
	const { exportByName, parsedExportByName } = parseModuleExports(
		filePath,
		createInMemoryProgram(
			filePath,
			`type ReadonlyStrings = readonly string[];
type ReadonlyPair = readonly [string, number];

export type ReadonlyArrayKeys = keyof readonly string[];
export type ReadonlyTupleKeys = keyof readonly [string, number];
export type UtilityArrayKeys = keyof Readonly<string[]>;
export type UtilityTupleKeys = keyof Readonly<[string, number]>;
export interface Box {
  values: ReadonlyStrings;
  pair: ReadonlyPair;
}`,
		),
	);

	expect(exportByName('ReadonlyArrayKeys')?.type.type).toMatchObject({
		kind: 'array',
		isReadonly: true,
		elementType: { kind: 'intrinsic', intrinsic: 'string' },
	});
	expect(exportByName('ReadonlyTupleKeys')?.type.type).toMatchObject({
		kind: 'tuple',
		isReadonly: true,
		types: [
			{ kind: 'intrinsic', intrinsic: 'string' },
			{ kind: 'intrinsic', intrinsic: 'number' },
		],
	});
	expect(parsedExportByName('ReadonlyArrayKeys')?.type.toString()).toBe('keyof readonly string[]');
	expect(parsedExportByName('ReadonlyTupleKeys')?.type.toString()).toBe(
		'keyof readonly [string, number]',
	);
	for (const name of ['UtilityArrayKeys', 'UtilityTupleKeys']) {
		expect(exportByName(name)?.type.type).toMatchObject({ isReadonly: true });
		expect(parsedExportByName(name)?.type.toString()).toMatch(/^keyof readonly /);
	}
	expect(exportByName('Box')?.type.properties).toMatchObject([
		{ name: 'values', type: { kind: 'array', isReadonly: true } },
		{ name: 'pair', type: { kind: 'tuple', isReadonly: true } },
	]);
	const readonlyArrayKeys = exportByName('ReadonlyArrayKeys')?.type;
	expect(readonlyArrayKeys).toMatchObject({
		resolutionKind: 'exact',
		resolvedType: { kind: 'union' },
	});
	const arrayKeyValues = readonlyArrayKeys?.resolvedType.types
		.filter((type: { kind: string }) => type.kind === 'literal')
		.map((type: { value: string }) => type.value);
	expect(arrayKeyValues).toContain('"length"');
	expect(arrayKeyValues).not.toContain('"push"');
});

it('preserves keyof operators inside explicit unions', () => {
	const filePath = '/virtual/keyof-union.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`export function acceptsMaybeKey(prop: keyof Params | undefined): void {}

interface Params {
  a: string;
  b: number;
}`,
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'function',
		callSignatures: [
			{
				parameters: [
					{
						name: 'prop',
						type: {
							kind: 'union',
							types: [
								{
									kind: 'typeOperator',
									operator: 'keyof',
									type: {
										kind: 'object',
										typeName: {
											name: 'Params',
										},
									},
									resolvedType: {
										kind: 'union',
										types: [
											{
												kind: 'literal',
												value: '"a"',
											},
											{
												kind: 'literal',
												value: '"b"',
											},
										],
									},
								},
								{
									kind: 'intrinsic',
									intrinsic: 'undefined',
								},
							],
						},
					},
				],
			},
		],
	});
});

it('preserves overlapping keyof members in either explicit-union order', () => {
	const filePath = '/virtual/keyof-overlapping-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Wide {
  a: string;
  b: number;
}

interface Narrow {
  a: string;
}

type WideKeys = keyof Wide;
type NarrowKeys = keyof Narrow;

export type Forward = keyof Wide | keyof Narrow;
export type Reverse = keyof Narrow | keyof Wide;
export type AliasedForward = WideKeys | NarrowKeys;
export type AliasedReverse = NarrowKeys | WideKeys;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operatorFor = (operandName: string, keys: string[]) => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: operandName } },
		resolvedType:
			keys.length === 1
				? { kind: 'literal', value: `"${keys[0]}"` }
				: {
						kind: 'union',
						types: keys.map((key) => ({ kind: 'literal', value: `"${key}"` })),
					},
		resolutionKind: 'exact',
	});

	expect(exportByName('Forward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Wide', ['a', 'b']), operatorFor('Narrow', ['a'])],
	});
	expect(exportByName('Reverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Narrow', ['a']), operatorFor('Wide', ['a', 'b'])],
	});
	expect(exportByName('AliasedForward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Wide', ['a', 'b']), operatorFor('Narrow', ['a'])],
	});
	expect(exportByName('AliasedReverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Narrow', ['a']), operatorFor('Wide', ['a', 'b'])],
	});
});

it('keeps keyof operators with different generic operands in either union order', () => {
	const filePath = '/virtual/keyof-generic-operand-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Box<T> {
  a: T;
  b: T;
}

export type Forward = keyof Box<any> | keyof Box<string>;
export type Reverse = keyof Box<string> | keyof Box<any>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operatorFor = (intrinsic: 'any' | 'string') => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			typeName: {
				name: 'Box',
				typeArguments: [{ type: { kind: 'intrinsic', intrinsic } }],
			},
		},
	});

	expect(exportByName('Forward')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('any'), operatorFor('string')],
	});
	expect(exportByName('Reverse')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('string'), operatorFor('any')],
	});
});

it('preserves equivalent array and tuple union members with distinct keyof syntax', () => {
	const filePath = '/virtual/keyof-equivalent-container-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Left { same: string }
interface Right { same: number }

export type Arrays = (keyof Left)[] | (keyof Right)[];
export type Tuples = [keyof Left] | [keyof Right];
export type ArrayConditional = true extends true ? (keyof Left)[] : number[];
export type TupleConditional = true extends true ? [keyof Left] : [number];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operatorFor = (name: 'Left' | 'Right') => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});

	expect(exportByName('Arrays')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'array', elementType: operatorFor('Left') },
			{ kind: 'array', elementType: operatorFor('Right') },
		],
	});
	expect(exportByName('Tuples')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'tuple', types: [operatorFor('Left')] },
			{ kind: 'tuple', types: [operatorFor('Right')] },
		],
	});
	expect(exportByName('ArrayConditional')?.type).toMatchObject({
		kind: 'array',
		elementType: operatorFor('Left'),
	});
	expect(exportByName('TupleConditional')?.type).toMatchObject({
		kind: 'tuple',
		types: [operatorFor('Left')],
	});
});

it('preserves equivalent generic wrapper compounds with distinct keyof syntax', () => {
	const filePath = '/virtual/keyof-equivalent-generic-wrapper-compounds.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Left { same: string }
interface Right { same: number }
interface Box<T> { value: T }
type LeftKeys = keyof Left;
type RightKeys = keyof Right;

export type Union = Box<keyof Left> | Box<keyof Right>;
export type Intersection = Box<keyof Left> & Box<keyof Right>;
export type AliasUnion = Box<LeftKeys> | Box<RightKeys>;
export type AliasIntersection = Box<LeftKeys> & Box<RightKeys>;
export type MixedUnion = Box<keyof Left> | Box<'same'>;
export type MixedIntersection = Box<keyof Left> & Box<'same'>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const wrappedOperatorFor = (name: 'Left' | 'Right') => ({
		kind: 'object',
		typeName: {
			name: 'Box',
			typeArguments: [
				{
					type: {
						kind: 'typeOperator',
						operator: 'keyof',
						type: { typeName: { name } },
					},
				},
			],
		},
		properties: [
			{
				name: 'value',
				type: {
					kind: 'typeOperator',
					operator: 'keyof',
					type: { typeName: { name } },
				},
			},
		],
	});
	const wrappedLiteral = {
		kind: 'object',
		typeName: {
			name: 'Box',
			typeArguments: [{ type: { kind: 'literal', value: '"same"' } }],
		},
		properties: [{ name: 'value', type: { kind: 'literal', value: '"same"' } }],
	};

	expect(exportByName('Union')?.type).toMatchObject({
		kind: 'union',
		types: [wrappedOperatorFor('Left'), wrappedOperatorFor('Right')],
	});
	expect(exportByName('Intersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [wrappedOperatorFor('Left'), wrappedOperatorFor('Right')],
	});
	expect(exportByName('AliasUnion')?.type).toMatchObject({
		kind: 'union',
		types: [wrappedOperatorFor('Left'), wrappedOperatorFor('Right')],
	});
	expect(exportByName('AliasIntersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [wrappedOperatorFor('Left'), wrappedOperatorFor('Right')],
	});
	expect(exportByName('MixedUnion')?.type).toMatchObject({
		kind: 'union',
		types: [wrappedOperatorFor('Left'), wrappedLiteral],
	});
	expect(exportByName('MixedIntersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [wrappedOperatorFor('Left'), wrappedLiteral],
	});
});

it('preserves keyof members after union simplification and generic alias instantiation', () => {
	const filePath = '/virtual/keyof-simplified-unions.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type Collapsed = keyof {} | 'fallback';
type MaybeKeys<T> = keyof T | undefined;
export type Concrete = MaybeKeys<Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('Collapsed')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'literal', value: '"fallback"' },
		],
	});
	expect(exportByName('Concrete')?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'typeOperator',
				operator: 'keyof',
				type: { typeName: { name: 'Params' } },
				resolvedType: {
					kind: 'union',
					types: [
						{ kind: 'literal', value: '"a"' },
						{ kind: 'literal', value: '"b"' },
					],
				},
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
});

it('reconstructs checker-collapsed intersections, conditionals, and indexed access', () => {
	const filePath = '/virtual/keyof-collapsed-wrappers.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Alpha {
  alpha: string;
}

interface Beta {
  beta: number;
}

interface Box {
  keys: keyof Params;
}

interface NestedBox {
  keys: Box['keys'];
}

interface GenericBox<T> {
  keys: keyof T;
}

interface AlphaBox {
  keys: keyof Alpha;
}

interface BetaBox {
  keys: keyof Beta;
}

type KeyAlias = keyof Params;
interface AliasBox {
  keys: KeyAlias;
}

class AccessorBox {
  get keys(): keyof Params {
    return 'a';
  }
}

type KeyTuple = [keyof Params];

export type ConcreteIntersection = keyof Params & string;
export type AliasedIntersection = KeyAlias & string;
export type OptionalIntersection = (keyof Params & string) | undefined;
export type ConcreteConditional = true extends true ? keyof Params : never;
export type AliasedConditional = true extends true ? KeyAlias : never;
export type TrueConditionalWithAny = true extends true ? keyof Params : any;
export type FalseConditionalWithAny = false extends true ? any : keyof Params;
type Select<T extends { kind: string }> = T['kind'] extends 'a' ? keyof Alpha : keyof Beta;
export type CompositeConditional = Select<{ kind: 'a' }>;
export type IndexedKeys = Box['keys'];
export type NestedIndexedKeys = NestedBox['keys'];
export type GenericIndexedKeys = GenericBox<Params>['keys'];
export type UnionIndexedKeys = (AlphaBox | BetaBox)['keys'];
export type AliasIndexedKeys = AliasBox['keys'];
export type AccessorIndexedKeys = AccessorBox['keys'];
export type TupleIndexedKeys = KeyTuple[0];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator({
		type: { kind: 'object', typeName: { name: 'Params' }, properties: [] },
	});

	expect(exportByName('ConcreteIntersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
	});
	expect(exportByName('AliasedIntersection')?.type).toMatchObject({
		kind: 'intersection',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
	});
	expect(exportByName('OptionalIntersection')?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'intersection',
				types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('ConcreteConditional')?.type).toMatchObject(expectedOperator);
	expect(exportByName('AliasedConditional')?.type).toMatchObject(expectedOperator);
	expect(exportByName('TrueConditionalWithAny')?.type).toMatchObject(expectedOperator);
	expect(exportByName('FalseConditionalWithAny')?.type).toMatchObject(expectedOperator);
	expect(exportByName('CompositeConditional')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Alpha' } },
		resolvedType: { kind: 'literal', value: '"alpha"' },
		resolutionKind: 'exact',
	});
	expect(exportByName('IndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('NestedIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('GenericIndexedKeys')?.type).toMatchObject(expectedOperator);
	const unionIndexedKeys = exportByName('UnionIndexedKeys')?.type;
	expect(unionIndexedKeys).toMatchObject({ kind: 'union' });
	expect(unionIndexedKeys.types.map((member: { value: string }) => member.value).sort()).toEqual([
		'"alpha"',
		'"beta"',
	]);
	expect(JSON.stringify(unionIndexedKeys)).not.toContain('typeOperator');
	expect(exportByName('AliasIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('AccessorIndexedKeys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('TupleIndexedKeys')?.type).toMatchObject(expectedOperator);
});

it('applies authored generic alias bindings to indexed-access sources', () => {
	const filePath = '/virtual/keyof-generic-alias-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type KeyTuple<T> = [keyof T];
type NestedTuple<T> = [T];
type KeyBox<T> = { keys: keyof T };
type NestedBox<T> = { keys: T };
type OuterKeyTuple<T> = KeyTuple<T>;
type OuterNestedTuple<T> = NestedTuple<T>;
type OuterKeyBox<T> = KeyBox<T>;
type OuterNestedBox<T> = NestedBox<T>;
type DeepBox<T> = { inner: { keys: T } };
type IntermediateBox<T> = { inner: NestedBox<T> };
type IntermediateKeyBox<T> = { inner: NestedBox<keyof T> };
interface InterfaceBox<T> {
  keys: T;
}
type InterfaceAlias<T> = InterfaceBox<T>;
type InterfaceKeyAlias<T> = InterfaceBox<keyof T>;

export type TupleKey = KeyTuple<Params>[0];
export type NestedTupleKey = NestedTuple<keyof Params>[0];
export type ObjectKey = KeyBox<Params>['keys'];
export type NestedObjectKey = NestedBox<keyof Params>['keys'];
export type ChainedTupleKey = OuterKeyTuple<Params>[0];
export type ChainedNestedTupleKey = OuterNestedTuple<keyof Params>[0];
export type ChainedObjectKey = OuterKeyBox<Params>['keys'];
export type ChainedNestedObjectKey = OuterNestedBox<keyof Params>['keys'];
export type DeepObjectKey = DeepBox<keyof Params>['inner']['keys'];
export type IntermediateObjectKey = IntermediateBox<keyof Params>['inner']['keys'];
export type IntermediateWrappedObjectKey = IntermediateKeyBox<Params>['inner']['keys'];
export type InterfaceAliasKey = InterfaceAlias<keyof Params>['keys'];
export type InterfaceWrappedAliasKey = InterfaceKeyAlias<Params>['keys'];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of [
		'TupleKey',
		'NestedTupleKey',
		'ObjectKey',
		'NestedObjectKey',
		'ChainedTupleKey',
		'ChainedNestedTupleKey',
		'ChainedObjectKey',
		'ChainedNestedObjectKey',
		'DeepObjectKey',
		'IntermediateObjectKey',
		'IntermediateWrappedObjectKey',
		'InterfaceAliasKey',
		'InterfaceWrappedAliasKey',
	]) {
		expect(exportByName(name)?.type).toMatchObject(expectedOperator);
	}
});

it('maps literal tuple indexes across open and finite rests', () => {
	const filePath = '/virtual/keyof-open-rest-literal-index.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface OtherParams {
  c: string;
  d: number;
}

type Values = [string, ...(keyof Params)[]];
type NamedValues = [head: string, ...tail: (keyof Params)[]];
type Pair = [keyof Params, string];
type SpreadPair = [...Pair];
type SlidingSuffix = [...(keyof Params)[], number];
type DoubleFiniteSpread = [...[keyof Params, number], ...[string, keyof OtherParams]];

export type FirstRest = Values[1];
export type LaterRest = Values[123];
export type NamedRest = NamedValues[1];
export type PairKey = SpreadPair[0];
export type PairValue = SpreadPair[1];
export type SlidingFirst = SlidingSuffix[0];
export type SecondSpreadKey = DoubleFiniteSpread[3];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of ['FirstRest', 'LaterRest', 'NamedRest', 'PairKey']) {
		expect(exportByName(name)?.type, name).toMatchObject(expectedOperator);
	}
	expect(exportByName('PairValue')?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
	expect(exportByName('SlidingFirst')?.type).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'number' }],
	});
	expect(exportByName('SecondSpreadKey')?.type).toMatchObject({
		...expectedOperator,
		type: { typeName: { name: 'OtherParams' } },
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"c"' },
				{ kind: 'literal', value: '"d"' },
			],
		},
	});
});

it('traces keyof through numeric array indexed access', () => {
	const filePath = '/virtual/keyof-array-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type List<T> = T[];
type ReadonlyList<T> = readonly T[];
type WrappedList<T> = Promise<T>[];

export type Direct = (keyof Params)[][number];
export type Generic = List<keyof Params>[number];
export type ReadonlyGeneric = ReadonlyList<keyof Params>[number];
export type DirectLiteral = (keyof Params)[][0];
export type GenericLiteral = List<keyof Params>[123];
export type WrappedGeneric = WrappedList<keyof Params>[number];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of ['Direct', 'Generic', 'ReadonlyGeneric', 'DirectLiteral', 'GenericLiteral']) {
		expect(exportByName(name)?.type).toMatchObject(expectedOperator);
	}
	const wrappedGenericOperator =
		exportByName('WrappedGeneric')?.type.typeName.typeArguments[0].type;
	expect(wrappedGenericOperator).toMatchObject(expectedOperator);
	expect(wrappedGenericOperator?.resolvedType).not.toHaveProperty('typeName');
});

it('preserves keyof inside built-in Readonly array and tuple utilities', () => {
	const filePath = '/virtual/keyof-readonly-utility-containers.ts';
	const program = createInMemoryProgram(
		filePath,
		`interface Params {
  a: string;
  b: number;
}

type ReadonlyWrapper<T> = Readonly<T>;

export type UtilityArray = Readonly<(keyof Params)[]>;
export type UtilityArrayElement = Readonly<(keyof Params)[]>[number];
export type UtilityTuple = Readonly<[keyof Params]>;
export type UtilityTupleElement = Readonly<[keyof Params]>[number];
export type WrappedArray = ReadonlyWrapper<(keyof Params)[]>;
export type WrappedArrayElement = ReadonlyWrapper<(keyof Params)[]>[number];
export type WrappedTuple = ReadonlyWrapper<[keyof Params]>;
export type WrappedTupleElement = ReadonlyWrapper<[keyof Params]>[number];`,
	);
	const expectedOperator = expectedKeyofOperator();

	for (const includeExternalTypes of [false, true]) {
		const moduleDefinition = JSON.parse(
			JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes })),
		);
		const exportByName = createExportLookup(moduleDefinition);
		for (const name of ['UtilityArray', 'WrappedArray']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject({
				kind: 'array',
				isReadonly: true,
				elementType: expectedOperator,
			});
		}
		for (const name of ['UtilityArrayElement', 'WrappedArrayElement']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject(
				expectedOperator,
			);
		}
		for (const name of ['UtilityTuple', 'WrappedTuple']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject({
				kind: 'tuple',
				isReadonly: true,
				types: [expectedOperator],
			});
		}
		for (const name of ['UtilityTupleElement', 'WrappedTupleElement']) {
			expect(exportByName(name)?.type, `${name}:${includeExternalTypes}`).toMatchObject(
				expectedOperator,
			);
		}
	}
});

it('reconstructs fixed tuple members selected by a number index', () => {
	const filePath = '/virtual/keyof-tuple-number-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Pair<Value> = [Value];
type Mixed<Value> = [Value, number];
type WrappedPair<Value> = [Promise<Value>];
type WrappedMixed<Value> = [Promise<Value>, number];

export type Single = [keyof Params][number];
export type GenericSingle = Pair<keyof Params>[number];
export type Multiple = [keyof Params, number][number];
export type GenericMultiple = Mixed<keyof Params>[number];
export type WrappedSingle = WrappedPair<keyof Params>[number];
export type WrappedMultiple = WrappedMixed<keyof Params>[number];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Single')?.type).toMatchObject(expectedOperator);
	expect(exportByName('GenericSingle')?.type).toMatchObject(expectedOperator);
	for (const name of ['Multiple', 'GenericMultiple']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'number' }],
		});
	}
	const wrappedSingleOperator = exportByName('WrappedSingle')?.type.typeName.typeArguments[0].type;
	expect(wrappedSingleOperator).toMatchObject(expectedOperator);
	expect(wrappedSingleOperator?.resolvedType).not.toHaveProperty('typeName');
	const wrappedMultipleOperator =
		exportByName('WrappedMultiple')?.type.types[0].typeName.typeArguments[0].type;
	expect(wrappedMultipleOperator).toMatchObject(expectedOperator);
	expect(wrappedMultipleOperator?.resolvedType).not.toHaveProperty('typeName');
});

it('reconstructs non-singleton indexed access sources', () => {
	const filePath = '/virtual/keyof-non-singleton-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params { a: string; b: number }
interface Left { left: string }
interface Right { right: number }
type Open<T> = [...number[], keyof T][number];
type Optional<T> = [value?: keyof T][number];
type FieldNames = 'a' | 'b';
type Positions = 0 | 1;
type Select<T, K extends keyof T> = T[K];
type SelectTuple<T extends readonly unknown[], K extends keyof T> = T[K];
interface Fields {
  a: keyof Left;
  b: keyof Right;
  c?: keyof Params;
}
type ParamsKeys = keyof Params;
interface OptionalFields {
  aliased?: ParamsKeys;
  wrapped?: Promise<keyof Params>;
}

export type OpenResult = Open<Params>;
export type OptionalResult = Optional<Params>;
export type SelectedFields = Fields['a' | 'b'];
export type SelectedOptionalField = Fields['a' | 'c'];
export type SelectedAliasedOptional = OptionalFields['aliased'];
export type SelectedWrappedOptional = OptionalFields['wrapped'];
export type SelectedFieldsAlias = Fields[FieldNames];
export type SelectedFieldsGeneric = Select<Fields, 'a' | 'b'>;
export type SelectedAllFields = Fields[keyof Fields];
export type SelectedTupleAlias = [keyof Left, keyof Right][Positions];
export type SelectedTupleGeneric = SelectTuple<[keyof Left, keyof Right], 0 | 1>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operatorFor = (name: 'Params' | 'Left' | 'Right', values: string[]) => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name } },
		resolvedType:
			values.length === 1
				? { kind: 'literal', value: `"${values[0]}"` }
				: {
						kind: 'union',
						types: values.map((value) => ({ kind: 'literal', value: `"${value}"` })),
					},
	});
	const paramsOperator = operatorFor('Params', ['a', 'b']);

	expect(exportByName('OpenResult')?.type).toMatchObject({
		kind: 'union',
		types: [{ kind: 'intrinsic', intrinsic: 'number' }, paramsOperator],
	});
	expect(exportByName('OptionalResult')?.type).toMatchObject({
		kind: 'union',
		types: [paramsOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
	});
	expect(exportByName('SelectedFields')?.type).toMatchObject({
		kind: 'union',
		types: [operatorFor('Left', ['left']), operatorFor('Right', ['right'])],
	});
	expect(exportByName('SelectedOptionalField')?.type).toMatchObject({
		kind: 'union',
		types: [
			operatorFor('Left', ['left']),
			paramsOperator,
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('SelectedAliasedOptional')?.type).toMatchObject({
		kind: 'union',
		types: [paramsOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
	});
	expect(exportByName('SelectedWrappedOptional')?.type).toMatchObject({
		kind: 'union',
		types: [
			{
				kind: 'external',
				typeName: {
					name: 'Promise',
					typeArguments: [{ type: paramsOperator }],
				},
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	for (const name of ['SelectedFieldsAlias', 'SelectedFieldsGeneric']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			types: [operatorFor('Left', ['left']), operatorFor('Right', ['right'])],
		});
	}
	expect(exportByName('SelectedAllFields')?.type).toMatchObject({
		kind: 'union',
		types: [
			operatorFor('Left', ['left']),
			operatorFor('Right', ['right']),
			paramsOperator,
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	for (const name of ['SelectedTupleAlias', 'SelectedTupleGeneric']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			types: [operatorFor('Left', ['left']), operatorFor('Right', ['right'])],
		});
	}
});

it('reconstructs broad and unique-symbol indexed sources', () => {
	const filePath = '/virtual/keyof-broad-symbol-indexed-access.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`declare const token: unique symbol;
declare const other: unique symbol;
interface Params { a: string; b: number }
interface First { first: string }
interface Second { second: number }
interface Indexed {
  [token]: keyof Params;
  [key: string]: keyof Params;
  [index: number]: keyof Params;
}
interface SymbolValues {
  [token]: keyof First;
  [other]: keyof Second;
}
interface BroadSymbols {
  [key: symbol]: keyof Params;
}

export type SymbolIndex = Indexed[typeof token];
export type StringIndex = Indexed[string];
export type NumberIndex = Indexed[number];
export type SymbolUnion = SymbolValues[typeof token | typeof other];
export type BroadSymbol = BroadSymbols[symbol];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	for (const name of ['SymbolIndex', 'StringIndex', 'NumberIndex']) {
		expect(exportByName(name)?.type, name).toMatchObject(expectedKeyofOperator());
	}
	expect(exportByName('SymbolUnion')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof', type: { typeName: { name: 'First' } } },
			{ kind: 'typeOperator', operator: 'keyof', type: { typeName: { name: 'Second' } } },
		],
	});
	expect(exportByName('BroadSymbol')?.type).toMatchObject(expectedKeyofOperator());
});

it('instantiates finite and symbol generic indexed operands', () => {
	const filePath = '/virtual/keyof-generic-indexed-operands.ts';
	const program = createInMemoryProgram(
		filePath,
		`declare const token: unique symbol;
interface Left { common: string; left: boolean }
interface Right { common: number; right: boolean }
interface Fields { a: Left; b: Right }
interface SymbolFields { [token]: Left }
interface BroadSymbolFields { [key: symbol]: Left }
type Keys<T, P extends keyof T = keyof T> = keyof T[P];

export type All = Keys<Fields>;
export type SymbolValue = Keys<SymbolFields, typeof token>;
export type BroadSymbolValue = Keys<BroadSymbolFields, symbol>;`,
	);
	const parseWithMode = (typeOperatorOutput: 'resolved' | 'syntaxOnly') =>
		JSON.parse(JSON.stringify(parseFromProgram(filePath, program, { typeOperatorOutput })));

	for (const mode of ['resolved', 'syntaxOnly'] as const) {
		const exportByName = createExportLookup(parseWithMode(mode));
		const all = exportByName('All')?.type;
		const symbolValue = exportByName('SymbolValue')?.type;
		const broadSymbolValue = exportByName('BroadSymbolValue')?.type;
		expect(all).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: {
				kind: 'union',
				types: [{ typeName: { name: 'Left' } }, { typeName: { name: 'Right' } }],
			},
		});
		expect(symbolValue).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Left' } },
		});
		expect(broadSymbolValue).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Left' } },
		});
		expect(JSON.stringify(all)).not.toContain('"intrinsic":"any"');
		expect(JSON.stringify(symbolValue)).not.toContain('"intrinsic":"any"');
		expect(JSON.stringify(broadSymbolValue)).not.toContain('"intrinsic":"any"');
		if (mode === 'resolved') {
			expect(all.resolvedType).toMatchObject({ kind: 'literal', value: '"common"' });
		} else {
			expect(all).not.toHaveProperty('resolvedType');
			expect(symbolValue).not.toHaveProperty('resolvedType');
			expect(broadSymbolValue).not.toHaveProperty('resolvedType');
		}
	}
});

it('keeps the semantic result for distributed conditional keyof aliases', () => {
	const filePath = '/virtual/keyof-distributed-conditional.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface A {
  a: string;
  common: boolean;
}

interface B {
  b: number;
  common: boolean;
}

type Distributed<T> = T extends unknown ? keyof T : never;
export type Keys = Distributed<A | B>;`,
		),
	);
	const keys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Keys',
	)?.type;

	expect(keys).toMatchObject({ kind: 'union' });
	expect(keys.types.map((member: { value: string }) => member.value).sort()).toEqual([
		'"a"',
		'"b"',
		'"common"',
	]);
	expect(JSON.stringify(keys)).not.toContain('typeOperator');
});

it('keeps never for distributed conditional aliases instantiated with never', () => {
	const filePath = '/virtual/keyof-distributed-conditional-never.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type SelectKeys<T> = T extends string ? keyof { a: 1 } : keyof { b: 1 };

export type Result = SelectKeys<never>;`,
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'never',
	});
});

it('matches conditional branches after substituting ordinary branch parameters', () => {
	const filePath = '/virtual/keyof-conditional-branch-substitution.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type Select<T, U> = [T] extends [string] ? U : keyof { n: 1 };
type SelectTrueKeyof<T, U> = [T] extends [string] ? keyof { n: 1 } : U;
type SelectFalseKeyof<T, U> = [T] extends [string] ? U : keyof { n: 1 };
interface LabeledTrue { n: 1 }
interface LabeledFalse { n: 2 }
type SelectLabeled<T> = [value: T] extends [value: string]
  ? keyof LabeledTrue
  : keyof LabeledFalse;
type SelectNested<T> = [Promise<T>] extends [Promise<string>]
  ? keyof { nestedTrue: 1 }
  : keyof { nestedFalse: 1 };
type SelectArray<T> = [T[]] extends [string[]]
  ? keyof { arrayTrue: 1 }
  : keyof { arrayFalse: 1 };
interface ReadonlyTrueTarget { same: string }
interface ReadonlyFalseTarget { same: number }
interface ConcreteTrueTarget { same: string }
interface ConcreteFalseTarget { same: number }
type SelectReadonly<T> = readonly [T] extends readonly [string]
  ? keyof ReadonlyTrueTarget
  : keyof ReadonlyFalseTarget;
type SelectReadonlyToMutable<T> = readonly [T] extends [T]
  ? keyof ReadonlyTrueTarget
  : keyof ReadonlyFalseTarget;
type SelectConcrete<T> = [T] extends [string]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectNever<T> = [T] extends [never]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type TupleWrap<T> = [T];
type SelectAliasTuple<T> = TupleWrap<T> extends TupleWrap<string>
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectReadonlyUtility<T> = Readonly<[T]> extends Readonly<[string]>
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectNestedSameKey<T> = [Promise<T>] extends [Promise<string>]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectArraySameKey<T> = [T[]] extends [string[]]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
interface Contravariant<in T> {
  (value: T): void;
}
interface Phantom<T> {
  fixed: string;
}
type SelectContravariant<T> = [Contravariant<T>] extends [Contravariant<string>]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectPhantom<T> = [Phantom<T>] extends [Phantom<string>]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectFunction<T> = [(value: T) => void] extends [(value: string) => void]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;
type SelectShortFunction<T> = [() => T] extends [(value: string) => T]
  ? keyof ConcreteTrueTarget
  : keyof ConcreteFalseTarget;

export type Result = Select<string, 'x'>;
export type IndistinguishableBranches = Select<string, 'n'>;
export type TrueKeyof = SelectTrueKeyof<string, 'n'>;
export type FalseKeyof = SelectFalseKeyof<number, 'n'>;
export type LabeledTrueKeyof = SelectLabeled<string>;
export type NestedTrueKeyof = SelectNested<string>;
export type ArrayTrueKeyof = SelectArray<string>;
export type ReadonlyTrueKeyof = SelectReadonly<string>;
export type ReadonlyFalseKeyof = SelectReadonly<number>;
export type ReadonlyMutableMismatchKeyof = SelectReadonlyToMutable<string>;
export type AnyTrueKeyof = SelectConcrete<any>;
export type NeverTrueKeyof = SelectNever<never>;
export type NeverFalseKeyof = SelectNever<string>;
export type AnyNeverFalseKeyof = SelectNever<any>;
export type AliasTupleTrueKeyof = SelectAliasTuple<string>;
export type AliasTupleFalseKeyof = SelectAliasTuple<number>;
export type ReadonlyUtilityTrueKeyof = SelectReadonlyUtility<string>;
export type ReadonlyUtilityFalseKeyof = SelectReadonlyUtility<number>;
export type NestedSameTrueKeyof = SelectNestedSameKey<string>;
export type NestedSameFalseKeyof = SelectNestedSameKey<number>;
export type ArraySameTrueKeyof = SelectArraySameKey<string>;
export type ArraySameFalseKeyof = SelectArraySameKey<number>;
export type ContravariantTrueKeyof = SelectContravariant<unknown>;
export type ContravariantFalseKeyof = SelectContravariant<number>;
export type PhantomTrueKeyof = SelectPhantom<number>;
export type FunctionTrueKeyof = SelectFunction<unknown>;
export type FunctionFalseKeyof = SelectFunction<number>;
export type ShortFunctionTrueKeyof = SelectShortFunction<string>;`,
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'literal',
		value: '"x"',
	});
	expect(moduleDefinition.exports[1]?.type).toMatchObject({
		kind: 'literal',
		value: '"n"',
	});
	expect(moduleDefinition.exports[2]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(moduleDefinition.exports[3]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(moduleDefinition.exports[4]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'LabeledTrue' } },
		resolvedType: { kind: 'literal', value: '"n"' },
	});
	expect(moduleDefinition.exports[5]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', properties: [{ name: 'nestedTrue' }] },
		resolvedType: { kind: 'literal', value: '"nestedTrue"' },
	});
	expect(moduleDefinition.exports[6]?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', properties: [{ name: 'arrayTrue' }] },
		resolvedType: { kind: 'literal', value: '"arrayTrue"' },
	});
	const exportByName = createExportLookup(moduleDefinition);
	expect(exportByName('ReadonlyTrueKeyof')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'ReadonlyTrueTarget' } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});
	expect(exportByName('ReadonlyFalseKeyof')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'ReadonlyFalseTarget' } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});
	expect(exportByName('ReadonlyMutableMismatchKeyof')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'ReadonlyFalseTarget' } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});
	for (const name of [
		'AnyTrueKeyof',
		'NeverTrueKeyof',
		'AliasTupleTrueKeyof',
		'ReadonlyUtilityTrueKeyof',
		'NestedSameTrueKeyof',
		'ArraySameTrueKeyof',
		'ContravariantTrueKeyof',
		'PhantomTrueKeyof',
		'FunctionTrueKeyof',
		'ShortFunctionTrueKeyof',
	]) {
		expect(exportByName(name)?.type, name).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'ConcreteTrueTarget' } },
			resolvedType: { kind: 'literal', value: '"same"' },
		});
	}
	for (const name of [
		'NeverFalseKeyof',
		'AnyNeverFalseKeyof',
		'AliasTupleFalseKeyof',
		'ReadonlyUtilityFalseKeyof',
		'NestedSameFalseKeyof',
		'ArraySameFalseKeyof',
		'ContravariantFalseKeyof',
		'FunctionFalseKeyof',
	]) {
		expect(exportByName(name)?.type, name).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'ConcreteFalseTarget' } },
			resolvedType: { kind: 'literal', value: '"same"' },
		});
	}
});

it('matches conditional branches after substituting composite root parameters', () => {
	const filePath = '/virtual/keyof-composite-root-conditional.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface TrueTarget { same: string }
interface FalseTarget { same: number }
type SelectArray<T> = T[] extends string[] ? keyof TrueTarget : keyof FalseTarget;
type SelectReference<T> = Promise<T> extends Promise<string>
  ? keyof TrueTarget
  : keyof FalseTarget;
type SelectObject<T> = { value: T } extends { value: string }
  ? keyof TrueTarget
  : keyof FalseTarget;
type SelectCallable<T> = ((value: T) => void) extends ((value: string) => void)
  ? keyof TrueTarget
  : keyof FalseTarget;
type SelectVoidReturn<T> = (() => T) extends (() => void)
  ? keyof TrueTarget
  : keyof FalseTarget;
type SelectThis<T> = ((this: T, value: string) => void) extends ((value: string) => void)
  ? keyof TrueTarget
  : keyof FalseTarget;

export type ArrayTrue = SelectArray<string>;
export type ArrayFalse = SelectArray<number>;
export type ReferenceTrue = SelectReference<string>;
export type ReferenceFalse = SelectReference<number>;
export type ObjectTrue = SelectObject<string>;
export type ObjectFalse = SelectObject<number>;
export type CallableTrue = SelectCallable<unknown>;
export type CallableFalse = SelectCallable<number>;
export type VoidReturnTrue = SelectVoidReturn<number>;
export type ThisTrue = SelectThis<number>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operatorFor = (name: 'TrueTarget' | 'FalseTarget') => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});

	for (const name of [
		'ArrayTrue',
		'ReferenceTrue',
		'ObjectTrue',
		'CallableTrue',
		'VoidReturnTrue',
		'ThisTrue',
	]) {
		expect(exportByName(name)?.type, name).toMatchObject(operatorFor('TrueTarget'));
	}
	for (const name of ['ArrayFalse', 'ReferenceFalse', 'ObjectFalse', 'CallableFalse']) {
		expect(exportByName(name)?.type, name).toMatchObject(operatorFor('FalseTarget'));
	}
});

it('honors optional-property compiler semantics in object conditionals', () => {
	const filePath = '/virtual/keyof-optional-object-conditional.ts';
	const source = `interface TrueTarget { same: string }
interface FalseTarget { same: number }
type Select<T> = { value: T } extends { value?: string }
  ? keyof TrueTarget
  : keyof FalseTarget;

export type Result = Select<undefined>;`;
	const parseWithExactOptionalProperties = (exactOptionalPropertyTypes: boolean) =>
		parseSerializedModule(
			filePath,
			createInMemoryProgram(filePath, source, { exactOptionalPropertyTypes }),
		);
	const expectedOperator = (name: 'TrueTarget' | 'FalseTarget') => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});

	expect(createExportLookup(parseWithExactOptionalProperties(false))('Result')?.type).toMatchObject(
		expectedOperator('TrueTarget'),
	);
	expect(createExportLookup(parseWithExactOptionalProperties(true))('Result')?.type).toMatchObject(
		expectedOperator('FalseTarget'),
	);
});

it('matches conditional branches for anonymous index-signature objects', () => {
	const filePath = '/virtual/keyof-index-signature-conditional.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface TrueTarget { same: string }
interface FalseTarget { same: number }
type Select<T> = { [key: string]: T } extends { [key: string]: string }
  ? keyof TrueTarget
  : keyof FalseTarget;
type SelectNumberIndex<T> = { [key: string]: T } extends { [key: number]: string }
  ? keyof TrueTarget
  : keyof FalseTarget;
type SelectSpecificNumberIndex<T extends string | number> = {
  [key: string]: string | number;
  [key: number]: T;
} extends { [key: number]: number }
  ? keyof TrueTarget
  : keyof FalseTarget;

export type True = Select<string>;
export type False = Select<number>;
export type CoveredNumberIndex = SelectNumberIndex<string>;
export type SpecificNumberIndex = SelectSpecificNumberIndex<number>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = (name: 'TrueTarget' | 'FalseTarget') => ({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name } },
		resolvedType: { kind: 'literal', value: '"same"' },
	});

	expect(exportByName('True')?.type).toMatchObject(expectedOperator('TrueTarget'));
	expect(exportByName('False')?.type).toMatchObject(expectedOperator('FalseTarget'));
	expect(exportByName('CoveredNumberIndex')?.type).toMatchObject(expectedOperator('TrueTarget'));
	expect(exportByName('SpecificNumberIndex')?.type).toMatchObject(expectedOperator('TrueTarget'));
});

it('honors non-strict parameter bivariance in callable tuple conditionals', () => {
	const filePath = '/virtual/keyof-non-strict-function-conditional.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface TrueTarget { a: string }
interface FalseTarget { b: number }
type Select<T> = [(value: T) => void] extends [(value: number) => void]
  ? keyof TrueTarget
  : keyof FalseTarget;

export type Result = Select<1>;`,
			{ strict: true, strictFunctionTypes: false },
		),
	);

	expect(createExportLookup(moduleDefinition)('Result')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'TrueTarget' } },
		resolvedType: { kind: 'literal', value: '"a"' },
	});
});

it('preserves keyof through generic container aliases and declaration defaults', () => {
	const filePath = '/virtual/keyof-generic-container-aliases.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type KeyArray<T> = (keyof T)[];
type KeyTuple<T> = [keyof T];
type KeyConditional<T> = T extends object ? keyof T : never;
type KeyIntersection<T> = keyof T & string;
type MaybeKeys<T = Params, U = T> = keyof U | undefined;
type MaybePartialKeys<T = Params, U = Partial<T>> = keyof U | undefined;
type CompositeKeyDefault<T, U = Record<keyof T, string>> = keyof U;

export type ArrayAlias = KeyArray<Params>;
export type TupleAlias = KeyTuple<Params>;
export type ConditionalAlias = KeyConditional<Params>;
export type IntersectionAlias = KeyIntersection<Params>;
export type OmittedDefaults = MaybeKeys;
export type DependentDefault = MaybeKeys<Params>;
export type OmittedCompositeDefault = MaybePartialKeys;
export type ExplicitCompositeDefault = MaybePartialKeys<Params>;
export type NestedCompositeDefault = CompositeKeyDefault<Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('ArrayAlias')?.type).toMatchObject({
		kind: 'array',
		typeName: { name: 'ArrayAlias' },
		elementType: expectedOperator,
	});
	expect(exportByName('ArrayAlias')?.type.typeName).not.toHaveProperty('typeArguments');
	expect(exportByName('TupleAlias')?.type).toMatchObject({
		kind: 'tuple',
		types: [expectedOperator],
	});
	expect(exportByName('ConditionalAlias')?.type).toMatchObject(expectedOperator);
	expect(exportByName('IntersectionAlias')?.type).toMatchObject({
		kind: 'intersection',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }],
	});
	for (const name of ['OmittedDefaults', 'DependentDefault']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			typeName: { name },
			types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
		});
	}
	const expectedPartialOperator = {
		...expectedOperator,
		type: {
			kind: 'object',
			typeName: {
				name: 'Partial',
				typeArguments: [{ type: { typeName: { name: 'Params' } } }],
			},
		},
	};
	for (const name of ['OmittedCompositeDefault', 'ExplicitCompositeDefault']) {
		expect(exportByName(name)?.type).toMatchObject({
			kind: 'union',
			typeName: { name },
			types: [expectedPartialOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
		});
	}
	expect(exportByName('NestedCompositeDefault')?.type).toMatchObject({
		...expectedOperator,
		type: {
			kind: 'external',
			typeName: {
				name: 'Record',
				typeArguments: [
					{ type: expectedOperator },
					{ type: { kind: 'intrinsic', intrinsic: 'string' } },
				],
			},
		},
	});
});

it('preserves keyof mapped-value syntax after mapped type instantiation', () => {
	const filePath = '/virtual/keyof-instantiated-mapped-values.ts';
	const program = createInMemoryProgram(
		filePath,
		`declare const token: unique symbol;
interface Params {
  a: string;
  b: number;
}
interface SymbolFields {
  [token]: { symbolKey: string };
}

type Mapped<K extends string> = {
  [Key in K]: keyof Params;
};

type ValueDictionary<Value> = {
  [name in string]: Value;
};

type KeysOfValues<T> = {
  [K in keyof T]: keyof T[K];
};

type RemappedKeys<T> = {
  [K in keyof T as \`get\${Capitalize<K & string>}\`]: keyof T[K];
};

export type Dictionary = Mapped<string>;
export type Finite = Mapped<'value'>;
export type GenericDictionary = ValueDictionary<keyof Params>;
export type KeyDependent = KeysOfValues<{
  left: { x: string };
  right: { y: number };
}>;
export type Remapped = RemappedKeys<{ left: { x: string } }>;
export type SymbolMapped = KeysOfValues<SymbolFields>;`,
		// TypeScript retains `token` only in generated mapped-property metadata.
	);
	const moduleDefinition = parseSerializedModule(filePath, program);
	const syntaxOnlyDefinition = JSON.parse(
		JSON.stringify(parseFromProgram(filePath, program, { typeOperatorOutput: 'syntaxOnly' })),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Dictionary')?.type.indexSignature).toMatchObject({
		keyName: 'Key',
		keyType: 'string',
		valueType: expectedOperator,
	});
	expect(exportByName('Finite')?.type.properties).toMatchObject([
		{ name: 'value', type: expectedOperator },
	]);
	expect(exportByName('GenericDictionary')?.type.indexSignature.valueType).toMatchObject(
		expectedOperator,
	);
	expect(exportByName('KeyDependent')?.type.properties).toMatchObject([
		{
			name: 'left',
			type: {
				kind: 'typeOperator',
				operator: 'keyof',
				type: { kind: 'object', properties: [{ name: 'x' }] },
				resolvedType: { kind: 'literal', value: '"x"' },
			},
		},
		{
			name: 'right',
			type: {
				kind: 'typeOperator',
				operator: 'keyof',
				type: { kind: 'object', properties: [{ name: 'y' }] },
				resolvedType: { kind: 'literal', value: '"y"' },
			},
		},
	]);
	const expectedRemappedProperty = {
		name: 'getLeft',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { kind: 'object', properties: [{ name: 'x' }] },
		},
	};
	expect(exportByName('Remapped')?.type.properties).toMatchObject([
		{
			...expectedRemappedProperty,
			type: {
				...expectedRemappedProperty.type,
				resolvedType: { kind: 'literal', value: '"x"' },
			},
		},
	]);
	expect(createExportLookup(syntaxOnlyDefinition)('Remapped')?.type.properties).toMatchObject([
		expectedRemappedProperty,
	]);
	const expectedSymbolMappedType = {
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', properties: [{ name: 'symbolKey' }] },
	};
	expect(exportByName('SymbolMapped')?.type.properties[0].type).toMatchObject({
		...expectedSymbolMappedType,
		resolvedType: { kind: 'literal', value: '"symbolKey"' },
	});
	const syntaxOnlySymbolType =
		createExportLookup(syntaxOnlyDefinition)('SymbolMapped')?.type.properties[0].type;
	expect(syntaxOnlySymbolType).toMatchObject(expectedSymbolMappedType);
	expect(JSON.stringify(syntaxOnlySymbolType)).not.toContain('"intrinsic":"any"');
});

it('preserves authored keyof arguments through identity and container aliases', () => {
	const filePath = '/virtual/keyof-generic-argument-syntax.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Identity<T> = T;
type Vector<T> = T[];
type Pair<T> = [T, T];
type Rest<T> = [head: T, ...tail: T[]];

export type Keys = Identity<keyof Params>;
export type KeyVector = Vector<keyof Params>;
export type KeyPair = Pair<keyof Params>;
export type KeyRest = Rest<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Keys')?.type).toMatchObject(expectedOperator);
	expect(exportByName('KeyVector')?.type).toMatchObject({
		kind: 'array',
		elementType: expectedOperator,
	});
	expect(exportByName('KeyVector')?.type.typeName).not.toHaveProperty('typeArguments');
	expect(exportByName('KeyPair')?.type).toMatchObject({
		kind: 'tuple',
		types: [expectedOperator, expectedOperator],
	});
	expect(exportByName('KeyRest')?.type).toMatchObject({
		kind: 'tuple',
		types: [expectedOperator, expectedOperator],
	});
});

it('preserves authored keyof arguments in object, callable, and compound members', () => {
	const filePath = '/virtual/keyof-generic-member-syntax.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Box<T> = { value: T };
type Callback<T> = (value: T) => T;
type MaybeList<T> = (T | undefined)[];

export type Boxed = Box<keyof Params>;
export type Callable = Callback<keyof Params>;
export type List = MaybeList<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Boxed')?.type.properties[0].type).toMatchObject(expectedOperator);
	const signature = exportByName('Callable')?.type.callSignatures[0];
	expect(signature.parameters[0].type).toMatchObject(expectedOperator);
	expect(signature.returnValueType).toMatchObject(expectedOperator);
	expect(exportByName('List')?.type.elementType).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'undefined' }],
	});
});

it('preserves authored keyof in omitted interface and class defaults', () => {
	const filePath = '/virtual/keyof-generic-declaration-defaults.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Holder<T = keyof Params> {
  value: T;
}

interface PairHolder<T, U = keyof Params> {
  first: T;
  second: U;
}

class ClassHolder<T = keyof Params> {
  value!: T;
}

export type OmittedInterfaceDefault = Holder;
export type PartialInterfaceDefault = PairHolder<string>;
export type OmittedClassDefault = ClassHolder;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();
	const propertyType = (exportName: string, propertyName: string) =>
		exportByName(exportName)?.type.properties.find(
			(property: { name: string }) => property.name === propertyName,
		)?.type;

	expect(propertyType('OmittedInterfaceDefault', 'value')).toMatchObject(expectedOperator);
	expect(propertyType('PartialInterfaceDefault', 'first')).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
	expect(propertyType('PartialInterfaceDefault', 'second')).toMatchObject(expectedOperator);
	expect(propertyType('OmittedClassDefault', 'value')).toMatchObject(expectedOperator);
});

it('matches fixed keyof syntax after an expanded variadic tuple element', () => {
	const filePath = '/virtual/keyof-variadic-tuple.ts';
	const pairPath = '/virtual/keyof-variadic-pair.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `import type { ImportedPair } from './keyof-variadic-pair';

interface Params {
  a: string;
  b: number;
}

interface OtherParams {
  c: string;
  d: number;
}

type AppendKeys<T extends unknown[]> = [...T, keyof Params];
type Spread<T extends unknown[]> = [...T];
type DoubleSpread<T extends unknown[], U extends unknown[]> = [...T, ...U];
type Combined<T extends unknown[], U extends unknown[]> = [...T, ...U];
type Identity<T> = T;
type OpenThenFiniteSpread<T extends unknown[]> = [...T, ...[keyof Params, string]];
type Pair = [keyof Params, string];
type PairAlias = Pair;
type GenericPair<T> = [keyof T, string];

export type Result = AppendKeys<[string, number]>;
export type SpreadResult = Spread<[keyof Params, string]>;
export type NamedSpreadResult = Spread<Pair>;
export type AliasedNamedSpreadResult = Spread<PairAlias>;
export type GenericNamedSpreadResult = Spread<GenericPair<Params>>;
export type ImportedNamedSpreadResult = Spread<ImportedPair<Params>>;
export type DoubleSpreadResult = DoubleSpread<
  [keyof Params, number],
  [string, keyof OtherParams]
>;
export type NestedSpreadResult = Spread<Combined<[string], [keyof Params, number]>>;
export type RepeatedAliasTuple = [Identity<string>, Identity<keyof Params>];
export type OpenThenFiniteSpreadResult<T extends unknown[]> = OpenThenFiniteSpread<T>;
export type Middle = Result[1];
export type Last = Result[2];`,
			[pairPath]: `export type ImportedPair<T> = [keyof T, string];`,
		}),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Result')?.type.types).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'string' },
		{ kind: 'intrinsic', intrinsic: 'number' },
		expectedOperator,
	]);
	expect(exportByName('SpreadResult')?.type.types).toMatchObject([
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	for (const name of [
		'NamedSpreadResult',
		'AliasedNamedSpreadResult',
		'GenericNamedSpreadResult',
		'ImportedNamedSpreadResult',
	]) {
		const elements = exportByName(name)?.type.types;
		expect(elements).toMatchObject([expectedOperator, { kind: 'intrinsic', intrinsic: 'string' }]);
		expect(elements[0]).not.toHaveProperty('typeName');
		expect(elements[1]).not.toHaveProperty('typeName');
	}
	expect(exportByName('DoubleSpreadResult')?.type.types).toMatchObject([
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'number' },
		{ kind: 'intrinsic', intrinsic: 'string' },
		{
			...expectedOperator,
			type: { typeName: { name: 'OtherParams' } },
			resolvedType: {
				kind: 'union',
				types: [
					{ kind: 'literal', value: '"c"' },
					{ kind: 'literal', value: '"d"' },
				],
			},
		},
	]);
	expect(exportByName('NestedSpreadResult')?.type.types).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'string' },
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'number' },
	]);
	expect(exportByName('RepeatedAliasTuple')?.type.types).toMatchObject([
		{ kind: 'intrinsic', intrinsic: 'string' },
		expectedOperator,
	]);
	expect(exportByName('OpenThenFiniteSpreadResult')?.type.types).toMatchObject([
		{ kind: 'typeParameter', name: 'T' },
		expectedOperator,
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	expect(exportByName('Middle')?.type).toEqual({
		kind: 'intrinsic',
		intrinsic: 'number',
	});
	expect(exportByName('Last')?.type).toMatchObject(expectedOperator);
});

it('distinguishes repeated finite tuple alias instantiations from cycles', () => {
	const filePath = '/virtual/keyof-repeated-tuple-alias.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface OtherParams {
  c: string;
  d: number;
}

type Spread<T extends unknown[]> = [...T];
type Left = Spread<Spread<[keyof Params, number]>>;
type Right = Spread<Spread<[string, keyof OtherParams]>>;

export type Result = Spread<Spread<Spread<[keyof Params]>>>;
export type Indexed = Spread<Spread<Spread<[keyof Params]>>>[0];
export type Composed = [...Left, ...Right];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('Result')?.type.types).toMatchObject([expectedKeyofOperator()]);
	expect(exportByName('Indexed')?.type).toMatchObject(expectedKeyofOperator());
	expect(exportByName('Composed')?.type.types).toMatchObject([
		expectedKeyofOperator(),
		{ kind: 'intrinsic', intrinsic: 'number' },
		{ kind: 'intrinsic', intrinsic: 'string' },
		{
			...expectedKeyofOperator(),
			type: { typeName: { name: 'OtherParams' } },
			resolvedType: {
				kind: 'union',
				types: [
					{ kind: 'literal', value: '"c"' },
					{ kind: 'literal', value: '"d"' },
				],
			},
		},
	]);
});

it('preserves keyof through nested generic wrapper arguments', () => {
	const filePath = '/virtual/keyof-nested-generic-wrappers.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Box<T> = { value: T };
type Wrap<T> = [Box<T>];
type NestedPromise<T> = Array<Promise<T>>;

export type Direct = [Promise<keyof Params>];
export type Wrapped = Wrap<keyof Params>;
export type Promised = NestedPromise<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	expect(exportByName('Direct')?.type.types[0].typeName.typeArguments[0].type).toMatchObject(
		expectedOperator,
	);
	expect(exportByName('Wrapped')?.type.types[0].properties[0].type).toMatchObject(expectedOperator);
	expect(exportByName('Promised')?.type.elementType.typeName.typeArguments[0].type).toMatchObject(
		expectedOperator,
	);
});

it('preserves keyof arguments through concrete aliases and named re-exports', () => {
	const keysPath = '/virtual/keyof-generic-argument-keys.ts';
	const sourcePath = '/virtual/keyof-generic-argument-source.ts';
	const entryPath = '/virtual/keyof-generic-argument-entry.ts';
	const program = createInMemoryProgram({
		[keysPath]: `export interface ImportedParams {
  imported: string;
}
export type ImportedKeys = keyof ImportedParams;
export interface ImportedBox<T> {
  value: T;
}`,
		[sourcePath]: `import type {
  ImportedBox,
  ImportedKeys,
} from './keyof-generic-argument-keys';

interface Params {
  a: string;
  b: number;
}

type Keys = keyof Params;
type Box<T> = { value: T };
interface InterfaceBox<T> {
  value: T;
}
type Wrapped = Box<keyof Params>;
type AliasWrapped = Box<Keys>;
type ImportedWrapped = Box<ImportedKeys>;
type InterfaceWrapped = InterfaceBox<keyof Params>;
type InterfaceAliasWrapped = InterfaceBox<Keys>;
type ImportedInterfaceWrapped = ImportedBox<ImportedKeys>;

export type Public = Wrapped;
export type AliasPublic = AliasWrapped;
export type ImportedPublic = ImportedWrapped;
export type InterfacePublic = InterfaceWrapped;
export type InterfaceAliasPublic = InterfaceAliasWrapped;
export type ImportedInterfacePublic = ImportedInterfaceWrapped;`,
		[entryPath]: `export {
  type Public,
  type AliasPublic,
  type ImportedPublic,
  type InterfacePublic,
  type InterfaceAliasPublic,
  type ImportedInterfacePublic,
} from './keyof-generic-argument-source';`,
	});

	for (const moduleDefinition of [
		parseSerializedModule(sourcePath, program),
		parseSerializedModule(entryPath, program),
	]) {
		for (const name of [
			'Public',
			'AliasPublic',
			'ImportedPublic',
			'InterfacePublic',
			'InterfaceAliasPublic',
			'ImportedInterfacePublic',
		]) {
			const exported = moduleDefinition.exports.find(
				(exportNode: { name: string }) => exportNode.name === name,
			);
			expect(exported?.type.properties[0], name).toMatchObject({
				name: 'value',
				type: { kind: 'typeOperator', operator: 'keyof' },
			});
		}
	}
});

it('preserves nested generic keyof arguments in returns and class properties', () => {
	const filePath = '/virtual/keyof-generic-boundaries.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Box<T> {
  value: T;
}
type Keys = keyof Params;

export function getBox(): Box<keyof Params> {
  throw new Error();
}
export function getAliasedBox(): Box<Keys> {
  throw new Error();
}

export class Example {
  value!: Box<keyof Params>;
  aliasedValue!: Box<Keys>;

  getBox(): Box<keyof Params> {
    throw new Error();
  }

  getAliasedBox(): Box<Keys> {
    throw new Error();
  }
}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();
	const boxArgument = (type: { typeName: { typeArguments: Array<{ type: unknown }> } }) =>
		type.typeName.typeArguments[0]?.type;

	const functionReturn = exportByName('getBox')?.type.callSignatures[0].returnValueType;
	expect(boxArgument(functionReturn)).toMatchObject(expectedOperator);
	const aliasedFunctionReturn =
		exportByName('getAliasedBox')?.type.callSignatures[0].returnValueType;
	expect(boxArgument(aliasedFunctionReturn)).toMatchObject(expectedOperator);
	expect(aliasedFunctionReturn.properties[0].type).toMatchObject(expectedOperator);

	const exampleType = exportByName('Example')?.type;
	const propertyType = exampleType.properties.find(
		(property: { name: string }) => property.name === 'value',
	)?.type;
	expect(boxArgument(propertyType)).toMatchObject(expectedOperator);
	const aliasedPropertyType = exampleType.properties.find(
		(property: { name: string }) => property.name === 'aliasedValue',
	)?.type;
	expect(boxArgument(aliasedPropertyType)).toMatchObject(expectedOperator);
	expect(aliasedPropertyType.properties[0].type).toMatchObject(expectedOperator);
	const methodReturn = exampleType.methods.find(
		(method: { name: string }) => method.name === 'getBox',
	)?.callSignatures[0].returnValueType;
	expect(boxArgument(methodReturn)).toMatchObject(expectedOperator);
	const aliasedMethodReturn = exampleType.methods.find(
		(method: { name: string }) => method.name === 'getAliasedBox',
	)?.callSignatures[0].returnValueType;
	expect(boxArgument(aliasedMethodReturn)).toMatchObject(expectedOperator);
});

it('preserves authored keyof arguments on import type references', () => {
	const filePath = '/virtual/keyof-import-type-generic.ts';
	const dependencyPath = '/virtual/keyof-import-type-generic-dependency.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `export type Result = import('./keyof-import-type-generic-dependency').Box<
  keyof import('./keyof-import-type-generic-dependency').Params
>;

export interface Options {
  result?: import('./keyof-import-type-generic-dependency').Box<
    keyof import('./keyof-import-type-generic-dependency').Params
  >;
}`,
			[dependencyPath]: `export interface Params {
  a: string;
  b: number;
}

export interface Box<T> {
  value: T;
}`,
		}),
	);
	const result = createExportLookup(moduleDefinition)('Result')?.type;
	const expectedOperator = expectedKeyofOperator({
		type: { typeName: { name: 'Params' } },
	});

	expect(result.typeName.typeArguments[0].type).toMatchObject(expectedOperator);
	expect(result.properties[0]).toMatchObject({
		name: 'value',
		type: expectedOperator,
	});
	const optionalResult = createExportLookup(moduleDefinition)('Options')?.type.properties[0].type;
	const optionalBox = optionalResult.types.find(
		(member: { kind: string }) => member.kind === 'object',
	);
	expect(optionalBox.typeName.typeArguments[0].type).toMatchObject(expectedOperator);
	expect(optionalBox.properties[0]).toMatchObject({
		name: 'value',
		type: expectedOperator,
	});
});

it('carries generic keyof bindings through object aliases and callable interfaces', () => {
	const filePath = '/virtual/keyof-generic-object-callable-aliases.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Box<T> {
  value: T;
  getValue(): T;
}
type BoxAlias<T> = Box<T>;
type ReorderedBoxAlias<Ignored, Value> = Box<Value>;

interface Callback<T> {
  (value: T): T;
}
type CallbackAlias<T> = Callback<T>;

export type ObjectDirect = Box<keyof Params>;
export type ObjectAliased = BoxAlias<keyof Params>;
export type ObjectSelectedKey = ReorderedBoxAlias<string, keyof Params>;
export type ObjectIgnoredKey = ReorderedBoxAlias<keyof Params, string>;
export type CallableDirect = Callback<keyof Params>;
export type CallableAliased = CallbackAlias<keyof Params>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of ['ObjectDirect', 'ObjectAliased', 'ObjectSelectedKey']) {
		const objectType = exportByName(name)?.type;
		expect(
			objectType.properties.find((property: { name: string }) => property.name === 'value')?.type,
			name,
		).toMatchObject(expectedOperator);
		const methodSignature = objectType.properties.find(
			(property: { name: string }) => property.name === 'getValue',
		)?.type.callSignatures[0];
		expect(methodSignature.returnValueType, name).toMatchObject(expectedOperator);
	}
	expect(exportByName('ObjectIgnoredKey')?.type.properties[0].type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});

	for (const name of ['CallableDirect', 'CallableAliased']) {
		const signature = exportByName(name)?.type.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}
});

it('carries generic keyof bindings through interface and class heritage', () => {
	const filePath = '/virtual/keyof-generic-heritage.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

interface Base<T> {
  value: T;
  method(value: T): T;
}
interface Middle<U> extends Base<U> {}
type ReorderedBase<Ignored, Value> = Base<Value>;

interface CallableBase<T> {
  (value: T): T;
}
interface CallableMiddle<U> extends CallableBase<U> {}
interface Left<T> {
  left: T;
}
interface Right<T> {
  right: T;
}
type KeysOf<T> = keyof T;
interface KeyedBase<T> {
  keys: keyof T;
}
interface AliasedKeyedBase<T> {
  aliasKeys: KeysOf<T>;
}
type KeyedHeritageAlias<T> = KeyedBase<T>;
interface KeyedMiddle<T> extends KeyedBase<T> {}
type DeepKeyedHeritageAlias<T> = KeyedMiddle<T>;

export interface DirectInterface extends Base<keyof Params> {}
export interface DeepInterface extends Middle<keyof Params> {}
export interface ReorderedInterface extends ReorderedBase<string, keyof Params> {}
export interface IgnoredInterface extends ReorderedBase<keyof Params, string> {}
export type DeepObjectAlias = Middle<keyof Params>;
export interface DirectCallable extends CallableBase<keyof Params> {}
export type DeepCallableAlias = CallableMiddle<keyof Params>;
export interface MultipleBases extends Left<keyof Params>, Right<keyof Params> {}
export interface KeyedInterface extends KeyedBase<Params> {}
export interface AliasedKeyedInterface extends AliasedKeyedBase<Params> {}
export interface AliasHeritageKeyedInterface extends KeyedHeritageAlias<Params> {}
export interface DeepAliasHeritageKeyedInterface extends DeepKeyedHeritageAlias<Params> {}

class BaseClass<T> {
  value!: T;
  method(value: T): T {
    return value;
  }
}
class MiddleClass<U> extends BaseClass<U> {}

export class DirectClass extends BaseClass<keyof Params> {}
export class DeepClass extends MiddleClass<keyof Params> {}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator();

	for (const name of [
		'DirectInterface',
		'DeepInterface',
		'ReorderedInterface',
		'DeepObjectAlias',
	]) {
		const type = exportByName(name)?.type;
		expect(
			type.properties.find((property: { name: string }) => property.name === 'value')?.type,
			name,
		).toMatchObject(expectedOperator);
		const signature = type.properties.find(
			(property: { name: string }) => property.name === 'method',
		)?.type.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}
	expect(exportByName('IgnoredInterface')?.type.properties[0].type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});

	for (const name of ['DirectClass', 'DeepClass']) {
		const type = exportByName(name)?.type;
		expect(
			type.properties.find((property: { name: string }) => property.name === 'value')?.type,
			name,
		).toMatchObject(expectedOperator);
		const signature = type.methods.find((method: { name: string }) => method.name === 'method')
			?.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}

	for (const name of ['DirectCallable', 'DeepCallableAlias']) {
		const signature = exportByName(name)?.type.callSignatures[0];
		expect(signature.parameters[0].type, name).toMatchObject(expectedOperator);
		expect(signature.returnValueType, name).toMatchObject(expectedOperator);
	}
	const multipleBaseProperties = exportByName('MultipleBases')?.type.properties ?? [];
	expect(multipleBaseProperties.map((property: { name: string }) => property.name)).toEqual([
		'left',
		'right',
	]);
	for (const property of multipleBaseProperties) {
		expect(property.type, property.name).toMatchObject(expectedOperator);
	}
	for (const name of [
		'KeyedInterface',
		'AliasedKeyedInterface',
		'AliasHeritageKeyedInterface',
		'DeepAliasHeritageKeyedInterface',
	]) {
		expect(exportByName(name)?.type.properties[0].type, name).toMatchObject(expectedOperator);
	}
});

it('applies external expansion policy while collecting heritage bindings', () => {
	const filePath = '/virtual/keyof-external-generic-heritage.ts';
	const program = createInMemoryProgram({
		[filePath]: `import { ExternalBase, ExternalClass } from 'heritage-package';

interface Params {
  a: string;
  b: number;
}

export interface DerivedInterface extends ExternalBase<keyof Params> {}
export class DerivedClass extends ExternalClass<keyof Params> {}`,
		'/virtual/node_modules/heritage-package/index.d.ts': `export interface ExternalBase<T> {
  value: T;
}

export declare class ExternalClass<T> {
  value: T;
}`,
	});
	const parse = (includeExternalTypes: boolean) =>
		JSON.parse(JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes })));
	const opaqueExportByName = createExportLookup(parse(false));
	const expandedExportByName = createExportLookup(parse(true));

	expect(opaqueExportByName('DerivedInterface')?.type.properties).toEqual([]);
	const opaqueClassProperty = opaqueExportByName('DerivedClass')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	)?.type;
	expect(opaqueClassProperty).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'literal', value: '"a"' },
			{ kind: 'literal', value: '"b"' },
		],
	});
	expect(opaqueClassProperty).not.toHaveProperty('operator');

	for (const name of ['DerivedInterface', 'DerivedClass']) {
		const property = expandedExportByName(name)?.type.properties.find(
			(candidate: { name: string }) => candidate.name === 'value',
		);
		expect(property?.type, name).toMatchObject(expectedKeyofOperator());
	}
});

it('preserves external keyof aliases in class properties when expansion is enabled', () => {
	const filePath = '/virtual/external-keyof-class-property.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'class-keyof-package';

export class Example {
  value!: Keys;
}`,
					'/virtual/node_modules/class-keyof-package/index.d.ts': `export interface Params {
  a: string;
  b: number;
}
export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);
	const propertyType = moduleDefinition.exports[0]?.type.properties[0]?.type;

	expect(propertyType).toMatchObject(expectedKeyofOperator());
});

it('replays keyof aliases that semantically collapse to any or unknown', () => {
	const filePath = '/virtual/keyof-top-type-aliases.ts';
	const warnings: ParserWarning[] = [];
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`interface Params {
  a: string;
}

interface Pattern {
  [key: string & { __brand: 'data' }]: number;
}

type UnknownKeys = keyof Params | unknown;
type AnyKeys = keyof Params | any;
type PatternKeys = keyof Pattern;

export type UnknownResult = UnknownKeys;
export type AnyResult = AnyKeys;
export type PatternResult = PatternKeys;`,
				),
				{
					onWarning: (warning) => {
						warnings.push(warning);
					},
				},
			),
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = expectedKeyofOperator({
		resolvedType: { kind: 'literal', value: '"a"' },
	});

	expect(exportByName('UnknownResult')?.type).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'unknown' }],
	});
	expect(exportByName('AnyResult')?.type).toMatchObject({
		kind: 'union',
		types: [expectedOperator, { kind: 'intrinsic', intrinsic: 'any' }],
	});
	expect(exportByName('PatternResult')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Pattern' } },
		resolvedType: { kind: 'intrinsic', intrinsic: 'any' },
		resolutionKind: 'fallback',
	});
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toEqual({
		code: 'unsupported-type-fallback',
		message:
			'Type extraction warning: Unable to handle type "string & { __brand: "data"; }" with flag "Intersection" while resolving "keyof Pattern" at "/virtual/keyof-top-type-aliases.ts:11:20". Using any instead.',
		filePath,
		line: 11,
		column: 20,
		parsedSymbolStack: [filePath, 'PatternResult'],
		typeFlags: ['Intersection'],
		typeText: 'string & { __brand: "data"; }',
		sourceText: 'keyof Pattern',
	});
});

it('does not substitute a nested type parameter that shadows an alias parameter', () => {
	const filePath = '/virtual/keyof-generic-argument-shadowing.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  outer: string;
}

type Shadowed<T> = [T, <T extends { inner: string }>() => T];

export type Result = Shadowed<keyof Params>;`,
		),
	);
	const result = moduleDefinition.exports[0]?.type;

	expect(result.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Params' } },
		resolvedType: { kind: 'literal', value: '"outer"' },
	});
	expect(result.types[1].callSignatures[0]).toMatchObject({
		returnValueType: {
			kind: 'typeParameter',
			name: 'T',
			constraint: {
				kind: 'object',
				properties: [{ name: 'inner' }],
			},
		},
		typeParameters: [
			{
				kind: 'typeParameter',
				name: 'T',
				constraint: {
					kind: 'object',
					properties: [{ name: 'inner' }],
				},
			},
		],
	});
});

it('preserves keyof constraints on signature type parameters', () => {
	const filePath = '/virtual/keyof-constraint.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`export function find<T, K extends keyof T>(key: K): void {}`,
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'function',
		callSignatures: [
			{
				parameters: [
					{
						name: 'key',
						type: {
							kind: 'typeParameter',
							name: 'K',
							constraint: {
								kind: 'typeOperator',
								operator: 'keyof',
								resolutionKind: 'baseConstraint',
								type: {
									kind: 'typeParameter',
									name: 'T',
								},
								resolvedType: {
									kind: 'union',
									types: [
										{
											kind: 'intrinsic',
											intrinsic: 'string',
										},
										{
											kind: 'intrinsic',
											intrinsic: 'number',
										},
										{
											kind: 'intrinsic',
											intrinsic: 'symbol',
										},
									],
								},
							},
						},
					},
				],
				typeParameters: [
					{
						kind: 'typeParameter',
						name: 'T',
					},
					{
						kind: 'typeParameter',
						name: 'K',
						constraint: {
							kind: 'typeOperator',
							operator: 'keyof',
							type: {
								kind: 'typeParameter',
								name: 'T',
							},
							resolvedType: {
								kind: 'union',
								types: [
									{
										kind: 'intrinsic',
										intrinsic: 'string',
									},
									{
										kind: 'intrinsic',
										intrinsic: 'number',
									},
									{
										kind: 'intrinsic',
										intrinsic: 'symbol',
									},
								],
							},
						},
					},
				],
			},
		],
	});
});

it('resolves non-union keyof results without falling back to any', () => {
	const filePath = '/virtual/keyof-non-union-results.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`export type StringKey = keyof { a: string };
export type NumericKey = keyof { 1: string };
export type EmptyKey = keyof {};
export type UnknownKey = keyof unknown;`,
				),
			),
		),
	);

	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('StringKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'literal',
			value: '"a"',
		},
	});
	expect(exportByName('NumericKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'literal',
			value: 1,
		},
	});
	expect(exportByName('EmptyKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'intrinsic',
			intrinsic: 'never',
		},
	});
	expect(exportByName('UnknownKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'intrinsic',
			intrinsic: 'unknown',
		},
		resolvedType: {
			kind: 'intrinsic',
			intrinsic: 'never',
		},
	});
});

it('marks unsupported single and union result members as fallbacks', () => {
	const filePath = '/virtual/keyof-result-fallback.ts';
	const warnings: ParserWarning[] = [];
	const program = createInMemoryProgram(
		filePath,
		`export type PatternKeys = keyof { [K in string & { __brand: 'pattern' }]: unknown };
export type MixedPatternKeys = keyof { [K in (string & { __brand: 'mixed' }) | 'fixed']: unknown };`,
	);
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(filePath, program, {
				onWarning: (warning) => warnings.push(warning),
			}),
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('PatternKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		resolutionKind: 'fallback',
		resolvedType: { kind: 'intrinsic', intrinsic: 'any' },
	});
	expect(exportByName('MixedPatternKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		resolutionKind: 'fallback',
		resolvedType: {
			kind: 'union',
			types: expect.arrayContaining([
				{ kind: 'intrinsic', intrinsic: 'any' },
				{ kind: 'literal', value: '"fixed"' },
			]),
		},
	});
	expect(warnings).toMatchObject([
		{
			code: 'unsupported-type-fallback',
			filePath,
			line: 1,
			column: 27,
			parsedSymbolStack: [filePath, 'PatternKeys'],
			typeFlags: ['Intersection'],
			typeText: 'string & { __brand: "pattern"; }',
			sourceText: "keyof { [K in string & { __brand: 'pattern' }]: unknown }",
		},
		{
			code: 'unsupported-type-fallback',
			filePath,
			line: 2,
			column: 32,
			parsedSymbolStack: [filePath, 'MixedPatternKeys'],
			typeFlags: ['Intersection'],
			typeText: 'string & { __brand: "mixed"; }',
			sourceText: "keyof { [K in (string & { __brand: 'mixed' }) | 'fixed']: unknown }",
		},
	]);
});

it('resolves template literal keys, using the base constraint for generic ones', () => {
	const filePath = '/virtual/keyof-template-literal-keys.ts';
	const warnings: ParserWarning[] = [];
	const program = createInMemoryProgram(
		filePath,
		`interface Attributes {
  [key: \`data-\${string}\`]: string;
}

export type AttributeKeys = keyof Attributes;
export type EventKeys<T extends string> = keyof { [K in \`on\${T}\`]: unknown };`,
	);
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(filePath, program, {
				onWarning: (warning) => warnings.push(warning),
			}),
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('AttributeKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		resolvedType: {
			kind: 'templateLiteral',
			texts: ['data-', ''],
			types: [{ kind: 'intrinsic', intrinsic: 'string' }],
		},
		resolutionKind: 'exact',
	});
	expect(exportByName('EventKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		resolvedType: {
			kind: 'templateLiteral',
			texts: ['on', ''],
			types: [{ kind: 'intrinsic', intrinsic: 'string' }],
		},
		resolutionKind: 'baseConstraint',
	});
	expect(warnings).toEqual([]);
});

it('attributes nested fallback warnings to re-exported source syntax', () => {
	const entryPath = '/virtual/keyof-warning-entry.ts';
	const sourcePath = '/virtual/keyof-warning-source.ts';
	const warnings: ParserWarning[] = [];
	const program = createInMemoryProgram({
		[entryPath]: `export { Holder, Box } from './keyof-warning-source';`,
		[sourcePath]: `export type PatternKeys = keyof {
  [K in string & { __brand: 'pattern' }]: unknown;
};

export interface Holder {
  value: PatternKeys;
}

export class Box {
  value!: PatternKeys;
}`,
	});

	parseFromProgram(entryPath, program, {
		onWarning: (warning) => warnings.push(warning),
	});

	expect(warnings).toHaveLength(2);
	expect(warnings).toMatchObject([
		{
			code: 'unsupported-type-fallback',
			filePath: sourcePath,
			line: 1,
			column: 27,
			parsedSymbolStack: [entryPath, 'Holder', 'property: value'],
			typeFlags: ['Intersection'],
			typeText: 'string & { __brand: "pattern"; }',
			sourceText: "keyof { [K in string & { __brand: 'pattern' }]: unknown; }",
		},
		{
			code: 'unsupported-type-fallback',
			filePath: sourcePath,
			line: 1,
			column: 27,
			parsedSymbolStack: [entryPath, 'Box'],
			typeFlags: ['Intersection'],
			typeText: 'string & { __brand: "pattern"; }',
			sourceText: "keyof { [K in string & { __brand: 'pattern' }]: unknown; }",
		},
	]);
});

it('preserves undefined when an optional or explicit-union keyof result is never', () => {
	const filePath = '/virtual/keyof-never-with-undefined.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export interface Options {
  empty?: keyof {};
  unknown?: keyof unknown;
}

export type MaybeEmpty = keyof {} | undefined;
export type MaybeUnknown = undefined | keyof unknown;
export type MaybeKeys = keyof Params | undefined;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedMaybeNever = {
		kind: 'union',
		types: [
			{
				kind: 'typeOperator',
				operator: 'keyof',
				resolvedType: { kind: 'intrinsic', intrinsic: 'never' },
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	};

	expect(exportByName('Options')?.type.properties).toMatchObject([
		{ name: 'empty', optional: true, type: expectedMaybeNever },
		{ name: 'unknown', optional: true, type: expectedMaybeNever },
	]);
	expect(exportByName('MaybeEmpty')?.type).toMatchObject(expectedMaybeNever);
	expect(exportByName('MaybeUnknown')?.type).toMatchObject(expectedMaybeNever);
	expect(exportByName('MaybeKeys')?.type).toMatchObject({
		kind: 'union',
		typeName: { name: 'MaybeKeys' },
		types: [
			{
				kind: 'typeOperator',
				operator: 'keyof',
				resolvedType: {
					kind: 'union',
					types: [
						{ kind: 'literal', value: '"a"' },
						{ kind: 'literal', value: '"b"' },
					],
				},
			},
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('MaybeKeys')?.type.types[0].resolvedType).not.toHaveProperty('typeName');
});

it('preserves an aliased never keyof member in a surviving union', () => {
	const filePath = '/virtual/keyof-aliased-never-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type EmptyKeys = keyof {};

export type AliasUnion = EmptyKeys | 'a' | 'b';
export type DirectUnion = keyof {} | 'a' | 'b';`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedTypes = [
		{
			kind: 'typeOperator',
			operator: 'keyof',
			resolvedType: { kind: 'intrinsic', intrinsic: 'never' },
			resolutionKind: 'exact',
		},
		{ kind: 'literal', value: '"a"' },
		{ kind: 'literal', value: '"b"' },
	];

	expect(exportByName('AliasUnion')?.type).toMatchObject({
		kind: 'union',
		types: expectedTypes,
	});
	expect(exportByName('DirectUnion')?.type).toMatchObject({
		kind: 'union',
		types: expectedTypes,
	});
});

it('uses the instantiated result type for generic keyof operators', () => {
	const filePath = '/virtual/keyof-instantiated-generic.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram(
					filePath,
					`type Wrapper<T> = { keys: keyof T };

export type Concrete = Wrapper<{ a: string; b: number }>;`,
				),
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'object',
		properties: [
			{
				name: 'keys',
				type: {
					kind: 'typeOperator',
					operator: 'keyof',
					type: {
						kind: 'typeParameter',
						name: 'T',
					},
					resolvedType: {
						kind: 'union',
						types: [
							{
								kind: 'literal',
								value: '"a"',
							},
							{
								kind: 'literal',
								value: '"b"',
							},
						],
					},
				},
			},
		],
	});
});

it('preserves keyof syntax before type-parameter and external semantic fallbacks', () => {
	const filePath = '/virtual/keyof-resolver-precedence.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`export type MappedKeys<T extends PropertyKey> = keyof { [P in T]: unknown };

declare const iterator: unique symbol;
export type SymbolKeys = keyof { [iterator]: string };`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('MappedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('SymbolKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});

it('does not trace external indexed-access syntax unless expansion is enabled', () => {
	const filePath = '/virtual/keyof-external-indexed-access.ts';
	const files = {
		[filePath]: `export type Result = import('external-indexed-package').Pair[0];`,
		'/virtual/node_modules/external-indexed-package/index.d.ts': `interface Params {
  a: string;
  b: number;
}

export type Pair = [keyof Params];`,
	};
	const parseWithExternalPolicy = (includeExternalTypes: boolean) =>
		JSON.parse(
			JSON.stringify(
				parseFromProgram(filePath, createInMemoryProgram(files), { includeExternalTypes }),
			),
		);

	expect(createExportLookup(parseWithExternalPolicy(false))('Result')?.type).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'literal', value: '"a"' },
			{ kind: 'literal', value: '"b"' },
		],
	});
	expect(createExportLookup(parseWithExternalPolicy(true))('Result')?.type).toMatchObject(
		expectedKeyofOperator(),
	);
});

it('keeps external indexed-access union members in authored order after readonly erasure', () => {
	const filePath = '/virtual/external-indexed-union-order.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `export interface ConsumerProps {
  value?: import('external-union-package').Props['value'] | undefined;
}`,
			'/virtual/node_modules/external-union-package/index.d.ts': `export interface Props {
  value?: string | readonly string[] | number | undefined;
}`,
		}),
	);
	const valueType = createExportLookup(moduleDefinition)('ConsumerProps')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	).type;

	expect(
		valueType.types.map(
			(member: { intrinsic?: string; kind: string }) => member.intrinsic ?? member.kind,
		),
	).toEqual(['string', 'array', 'number', 'undefined']);
});

it('keeps direct external indexed-access unions in authored order', () => {
	const filePath = '/virtual/direct-external-indexed-union-order.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `export interface ConsumerProps {
  value: import('direct-external-union-package').Props['value'];
}`,
			'/virtual/node_modules/direct-external-union-package/index.d.ts': `export interface Props {
  value: string | readonly string[] | number;
}`,
		}),
	);
	const valueType = createExportLookup(moduleDefinition)('ConsumerProps')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	).type;

	expect(
		valueType.types.map(
			(member: { intrinsic?: string; kind: string }) => member.intrinsic ?? member.kind,
		),
	).toEqual(['string', 'array', 'number']);
});

it('passes indexed-access union syntax through class properties and function returns', () => {
	const filePath = '/virtual/indexed-union-member-owners.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `export class Consumer {
  value!: import('member-owner-union-package').Props['value'];

  read(): import('member-owner-union-package').Props['value'] {
    throw new Error('not implemented');
  }
}

export function readValue(): import('member-owner-union-package').Props['value'] {
  throw new Error('not implemented');
}`,
			'/virtual/node_modules/member-owner-union-package/index.d.ts': `export interface Props {
  value: string | readonly string[] | number;
}`,
		}),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const consumer = exportByName('Consumer')?.type;
	const readValue = exportByName('readValue')?.type;
	const memberOrder = (type: { types: { intrinsic?: string; kind: string }[] }): string[] =>
		type.types.map((member) => member.intrinsic ?? member.kind);

	expect(
		memberOrder(
			consumer.properties.find((property: { name: string }) => property.name === 'value').type,
		),
	).toEqual(['string', 'array', 'number']);
	expect(
		memberOrder(
			consumer.methods.find((method: { name: string }) => method.name === 'read').callSignatures[0]
				.returnValueType,
		),
	).toEqual(['string', 'array', 'number']);
	expect(memberOrder(readValue.callSignatures[0].returnValueType)).toEqual([
		'string',
		'array',
		'number',
	]);
});

it('substitutes generic external indexed-access members before ordering them', () => {
	const filePath = '/virtual/generic-external-indexed-union-order.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `interface LocalChoice {
  value: 'first' | 'second';
}

export interface ConsumerProps {
  value?: import('generic-external-union-package').Props<string>['value'] | undefined;
  unionValue?: import('generic-external-union-package').Props<'first' | 'second'>['value'] | undefined;
  indexedValue?: import('generic-external-union-package').Props<LocalChoice['value']>['value'] | undefined;
}`,
			'/virtual/node_modules/generic-external-union-package/index.d.ts': `export interface Props<T> {
  value?: T | readonly T[] | number | undefined;
}`,
		}),
	);
	const valueType = createExportLookup(moduleDefinition)('ConsumerProps')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	).type;
	const unionValueType = createExportLookup(moduleDefinition)(
		'ConsumerProps',
	)?.type.properties.find((property: { name: string }) => property.name === 'unionValue').type;
	const indexedValueType = createExportLookup(moduleDefinition)(
		'ConsumerProps',
	)?.type.properties.find((property: { name: string }) => property.name === 'indexedValue').type;

	expect(
		valueType.types.map(
			(member: { intrinsic?: string; kind: string }) => member.intrinsic ?? member.kind,
		),
	).toEqual(['string', 'array', 'number', 'undefined']);
	expect(
		unionValueType.types.map(
			(member: { intrinsic?: string; kind: string; value?: string }) =>
				member.intrinsic ?? member.value ?? member.kind,
		),
	).toEqual(['"first"', '"second"', 'array', 'number', 'undefined']);
	expect(
		indexedValueType.types.map(
			(member: { intrinsic?: string; kind: string; value?: string }) =>
				member.intrinsic ?? member.value ?? member.kind,
		),
	).toEqual(['"first"', '"second"', 'array', 'number', 'undefined']);
	const expectedReadonlyUnionArray = {
		kind: 'array',
		isReadonly: true,
		elementType: {
			kind: 'union',
			types: [{ value: '"first"' }, { value: '"second"' }],
		},
	};
	expect(unionValueType.types[2]).toMatchObject(expectedReadonlyUnionArray);
	expect(indexedValueType.types[2]).toMatchObject(expectedReadonlyUnionArray);
});

it('preserves a local keyof argument substituted into an external indexed union', () => {
	const filePath = '/virtual/local-keyof-external-indexed-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `interface LocalProps {
  first: string;
  second: number;
}

export interface ConsumerProps {
  value?: import('local-keyof-external-union-package').Props<keyof LocalProps>['value'] | undefined;
}`,
			'/virtual/node_modules/local-keyof-external-union-package/index.d.ts': `export interface Props<T> {
  value?: T | boolean | undefined;
}`,
		}),
	);
	const valueType = createExportLookup(moduleDefinition)('ConsumerProps')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	).type;

	expect(
		valueType.types.map(
			(member: { intrinsic?: string; kind: string }) => member.intrinsic ?? member.kind,
		),
	).toEqual(['typeOperator', 'boolean', 'undefined']);
	expect(valueType.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'union',
			types: [{ value: '"first"' }, { value: '"second"' }],
		},
	});
});

it('does not replay operators from external indexed-access unions without expansion', () => {
	const filePath = '/virtual/external-indexed-operator-union.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram({
			[filePath]: `export interface ConsumerProps {
  value?: import('external-operator-union-package').Props['value'] | undefined;
}`,
			'/virtual/node_modules/external-operator-union-package/index.d.ts': `interface Shape {
  first: string;
  second: number;
}

export interface Props {
  value?: boolean | keyof Shape | number | undefined;
}`,
		}),
	);
	const valueType = createExportLookup(moduleDefinition)('ConsumerProps')?.type.properties.find(
		(property: { name: string }) => property.name === 'value',
	).type;

	expect(JSON.stringify(valueType)).not.toContain('typeOperator');
	expect(
		valueType.types.map(
			(member: { intrinsic?: string; kind: string; value?: string }) =>
				member.intrinsic ?? member.value ?? member.kind,
		),
	).toEqual(['boolean', '"first"', '"second"', 'number', 'undefined']);
});

it('keeps third-party keyof re-exports external unless expansion is enabled', () => {
	const filePath = '/virtual/keyof-external-reexport.ts';
	const packagePath = '/virtual/node_modules/keyof-package/index.d.ts';
	const files = {
		[filePath]: `export {
  type Keys,
  type OuterKeys,
  type WrappedArray,
  type WrappedTuple,
  type WrappedUnion,
  type Keys as RenamedKeys,
} from 'keyof-package';`,
		[packagePath]: `export interface Params {
  external: string;
}
export type Keys = keyof Params;
export type OuterKeys = Keys;
export type WrappedArray = OuterKeys[];
export type WrappedTuple = [OuterKeys];
export type WrappedUnion = OuterKeys | null;`,
	};
	const program = createInMemoryProgram(files);
	const parseWithExternalPolicy = (includeExternalTypes?: boolean) =>
		JSON.parse(JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes })));
	const expectExternalAliases = (moduleDefinition: {
		exports: { name: string; type: unknown; reexportedFrom?: string }[];
	}) => {
		for (const name of ['Keys', 'OuterKeys', 'WrappedArray', 'WrappedTuple', 'WrappedUnion']) {
			expect(
				moduleDefinition.exports.find((exportNode: { name: string }) => exportNode.name === name),
			).toMatchObject({
				name,
				type: { kind: 'external', typeName: { name } },
			});
		}
		expect(
			moduleDefinition.exports.find(
				(exportNode: { name: string }) => exportNode.name === 'RenamedKeys',
			),
		).toMatchObject({
			name: 'RenamedKeys',
			reexportedFrom: 'Keys',
			type: { kind: 'external', typeName: { name: 'Keys' } },
		});
	};

	expectExternalAliases(parseWithExternalPolicy(false));
	const expandedModule = parseWithExternalPolicy(true);
	const expandedExportByName = createExportLookup(expandedModule);
	const operator = { kind: 'typeOperator', operator: 'keyof' };
	expect(expandedExportByName('Keys')?.type).toMatchObject(operator);
	expect(expandedExportByName('RenamedKeys')).toMatchObject({
		reexportedFrom: 'Keys',
		type: operator,
	});
	expect(expandedExportByName('OuterKeys')?.type).toMatchObject(operator);
	expect(expandedExportByName('WrappedArray')?.type).toMatchObject({
		kind: 'array',
		elementType: operator,
	});
	expect(expandedExportByName('WrappedTuple')?.type).toMatchObject({
		kind: 'tuple',
		types: [operator],
	});
	expect(expandedExportByName('WrappedUnion')?.type).toMatchObject({
		kind: 'union',
		types: [operator, { kind: 'intrinsic', intrinsic: 'null' }],
	});
	expectExternalAliases(parseWithExternalPolicy(false));
});

it('preserves expanded external keyof aliases in parameters, returns, and index values', () => {
	const filePath = '/virtual/external-keyof-signature-consumer.ts';
	const program = createInMemoryProgram({
		[filePath]: `import type { Keys } from 'external-keyof-signatures';

export function select(value: Keys): Keys {
  return value;
}

export interface Values {
  [name: string]: Keys;
}

export type MappedValues = {
  [name in string]: Keys;
};

type Dictionary<Value> = {
  [name in string]: Value;
};

export type GenericMappedValues = Dictionary<Keys>;`,
		'/virtual/node_modules/external-keyof-signatures/index.d.ts': `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
	});
	const moduleDefinition = JSON.parse(
		JSON.stringify(parseFromProgram(filePath, program, { includeExternalTypes: true })),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedOperator = { kind: 'typeOperator', operator: 'keyof' };
	const signature = exportByName('select')?.type.callSignatures[0];

	expect(signature.parameters[0].type).toMatchObject(expectedOperator);
	expect(signature.returnValueType).toMatchObject(expectedOperator);
	expect(exportByName('Values')?.type.indexSignature.valueType).toMatchObject(expectedOperator);
	expect(exportByName('MappedValues')?.type.indexSignature.valueType).toMatchObject(
		expectedOperator,
	);
	expect(exportByName('GenericMappedValues')?.type.indexSignature.valueType).toMatchObject(
		expectedOperator,
	);
});

it('preserves expanded external keyof aliases in intersection members', () => {
	const filePath = '/virtual/external-keyof-intersection-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'external-keyof-intersection-package';

export type Narrow<T> = Keys<T> & string;`,
					'/virtual/node_modules/external-keyof-intersection-package/index.d.ts':
						'export type Keys<T> = keyof T;',
				}),
				{ includeExternalTypes: true },
			),
		),
	);

	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'intersection',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'intrinsic', intrinsic: 'string' },
		],
	});
});

it('replays renamed keyof aliases from similarly named project directories', () => {
	const filePath = '/virtual/similar-node-modules-entry.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: "export { type Keys as RenamedKeys } from './my_node_modules/pkg';",
					'/virtual/my_node_modules/pkg.ts': `interface Params {
  a: string;
  b: number;
}
export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'RenamedKeys',
		reexportedFrom: 'Keys',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
		},
	});
});

it('keeps semantic result names off the operator and preserves unique-symbol identity', () => {
	const filePath = '/virtual/keyof-result-identity.ts';
	const program = createInMemoryProgram(
		filePath,
		`type Key = 'a' | 'b';
type Params = Record<Key, string>;
export type Keys = keyof Params;

declare const tag: unique symbol;
export type UniqueKey = keyof { [tag]: string };`,
	);
	const { exportByName, parsedExportByName } = parseModuleExports(filePath, program);

	expect(exportByName('Keys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'union',
			typeName: { name: 'Key' },
		},
	});
	expect((parsedExportByName('Keys')?.type as TypeOperatorNode).typeName).toBeUndefined();
	expect(parsedExportByName('Keys')?.type.toString()).toBe('keyof Params');

	expect(exportByName('UniqueKey')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		resolvedType: {
			kind: 'intrinsic',
			intrinsic: 'symbol',
			typeName: { name: 'tag' },
		},
	});
	expect((parsedExportByName('UniqueKey')?.type as TypeOperatorNode).typeName).toBeUndefined();
});

it('parenthesizes function operands when rendering keyof syntax', () => {
	const filePath = '/virtual/keyof-function-rendering.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`export type FunctionKeys = keyof ((value: string) => number);`,
		),
	);
	const renderedType = parsedModule.exports[0]?.type.toString();

	expect(renderedType).toBe('keyof ((value: string) => number)');
	const renderedProgram = createInMemoryProgram(
		'/virtual/rendered-type.ts',
		`type Rendered = ${renderedType};`,
	);
	expect(renderedProgram.getSyntacticDiagnostics()).toEqual([]);
});

it('parenthesizes keyof operators when rendering array element types', () => {
	const filePath = '/virtual/keyof-array-rendering.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export function acceptsKeys(keys: (keyof Params)[]): void {}`,
		),
	);
	const functionType = parsedModule.exports[0]?.type as FunctionNode;
	const renderedType = functionType.callSignatures[0].parameters[0].type.toString();

	expect(renderedType).toBe('(keyof Params)[]');
	const renderedProgram = createInMemoryProgram(
		'/virtual/rendered-array-type.ts',
		`type Rendered = ${renderedType};`,
	);
	expect(renderedProgram.getSyntacticDiagnostics()).toEqual([]);
});

it('parenthesizes function types when rendering array elements', () => {
	const filePath = '/virtual/keyof-function-array-rendering.ts';
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`export type MutableKeys = keyof (() => void)[];
export type ReadonlyKeys = keyof readonly (() => void)[];`,
		),
	);
	const exportByName = createExportLookup(parsedModule);

	expect(exportByName('MutableKeys')?.type.toString()).toBe('keyof (() => void)[]');
	expect(exportByName('ReadonlyKeys')?.type.toString()).toBe('keyof readonly (() => void)[]');
});

it('does not expand properties that are discarded from named object operands', () => {
	const filePath = '/virtual/keyof-shallow-operand.ts';
	const objectResolutions: string[] = [];
	const includedProperties: string[] = [];
	const parsedModule = parseFromProgram(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
		),
		{
			shouldResolveObject: ({ name }) => {
				objectResolutions.push(name);
				return true;
			},
			shouldInclude: ({ name }) => {
				includedProperties.push(name);
				return true;
			},
		},
	);
	const moduleDefinition = JSON.parse(JSON.stringify(parsedModule));

	expect(moduleDefinition.exports[0]?.type.type).toMatchObject({
		kind: 'object',
		typeName: { name: 'Params' },
		properties: [],
	});
	expect(parsedModule.exports[0]?.type.toString()).toBe('keyof Params');
	expect(objectResolutions).toEqual([]);
	expect(includedProperties).toEqual([]);
});

it('terminates recursive keyof index-signature operands', () => {
	const filePath = '/virtual/keyof-recursive-index-signature.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`export interface Recursive {
  [key: string]: keyof Recursive;
}

export type Keys = keyof Recursive;`,
		),
	);
	const keys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Keys',
	);

	expect(keys?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: {
			kind: 'object',
			typeName: { name: 'Recursive' },
			properties: [],
		},
	});
});

it('preserves readonly metadata in recursive array and tuple operands', () => {
	const filePath = '/virtual/keyof-recursive-readonly-containers.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type RecursiveArray = readonly RecursiveArray[];
type RecursiveTuple = readonly [RecursiveTuple];

export type ArrayKeys = keyof RecursiveArray;
export type TupleKeys = keyof RecursiveTuple;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('ArrayKeys')?.type.type).toMatchObject({
		kind: 'array',
		isReadonly: true,
		elementType: { kind: 'array', isReadonly: true },
	});
	expect(exportByName('TupleKeys')?.type.type).toMatchObject({
		kind: 'tuple',
		isReadonly: true,
		types: [{ kind: 'tuple', isReadonly: true }],
	});
});

it('preserves keyof syntax in index-signature and mapped-template values', () => {
	const filePath = '/virtual/keyof-index-signatures.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export interface StringDictionary {
  [name: string]: keyof Params;
}

export interface NumberDictionary {
  [index: number]: keyof Params;
}

export type MappedDictionary<K extends string> = {
  [P in K]: keyof Params;
};

export type DictionaryKeys = keyof StringDictionary;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const expectedValueType = {
		kind: 'typeOperator',
		operator: 'keyof',
		type: { kind: 'object', typeName: { name: 'Params' }, properties: [] },
		resolvedType: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
		resolutionKind: 'exact',
	};

	expect(exportByName('StringDictionary')?.type.indexSignature).toMatchObject({
		keyName: 'name',
		keyType: 'string',
		valueType: expectedValueType,
	});
	expect(exportByName('NumberDictionary')?.type.indexSignature).toMatchObject({
		keyName: 'index',
		keyType: 'number',
		valueType: expectedValueType,
	});
	expect(exportByName('MappedDictionary')?.type.indexSignature).toMatchObject({
		keyName: 'P',
		keyType: 'string',
		valueType: expectedValueType,
	});
	expect(exportByName('DictionaryKeys')?.type.type).toMatchObject({
		kind: 'object',
		typeName: { name: 'StringDictionary' },
		properties: [],
		indexSignature: {
			keyName: 'name',
			keyType: 'string',
			valueType: expectedValueType,
		},
	});
});

it('preserves keyof aliases through named and renamed re-exports', () => {
	const sourcePath = '/virtual/keyof-reexport-source.ts';
	const entryPath = '/virtual/keyof-reexport-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface AlphaParams {
  alpha: string;
}

export interface BetaParams {
  beta: string;
  shared: boolean;
}

export type AlphaKeys = keyof AlphaParams;
export type BetaKeys = keyof BetaParams;`,
		[entryPath]: `export { type AlphaKeys, type BetaKeys as RenamedBetaKeys } from './keyof-reexport-source';`,
	});

	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'AlphaKeys',
			type: {
				kind: 'typeOperator',
				operator: 'keyof',
				type: { typeName: { name: 'AlphaParams' } },
				resolvedType: { kind: 'literal', value: '"alpha"' },
				resolutionKind: 'exact',
			},
		},
		{
			name: 'RenamedBetaKeys',
			reexportedFrom: 'BetaKeys',
			type: {
				kind: 'typeOperator',
				operator: 'keyof',
				type: { typeName: { name: 'BetaParams' } },
				resolvedType: {
					kind: 'union',
					types: [
						{ kind: 'literal', value: '"beta"' },
						{ kind: 'literal', value: '"shared"' },
					],
				},
				resolutionKind: 'exact',
			},
		},
	]);
	expect(moduleDefinition.exports[0]).not.toHaveProperty('reexportedFrom');
});

it('preserves keyof through concrete alias chains on re-export', () => {
	const sourcePath = '/virtual/keyof-chained-reexport-source.ts';
	const entryPath = '/virtual/keyof-chained-reexport-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}

type MaybeKeys<T> = keyof T | undefined;
export type Concrete = MaybeKeys<Params>;`,
		[entryPath]: `export { type Concrete } from './keyof-chained-reexport-source';`,
	});

	const moduleDefinition = parseSerializedModule(entryPath, program);
	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'Concrete',
		type: {
			kind: 'union',
			typeName: { name: 'Concrete' },
			types: [
				{ kind: 'typeOperator', operator: 'keyof' },
				{ kind: 'intrinsic', intrinsic: 'undefined' },
			],
		},
	});
});

it('preserves imported keyof alias chains through named barrel re-exports', () => {
	const dependencyPath = '/virtual/keyof-barrel-dependency.ts';
	const sourcePath = '/virtual/keyof-barrel-source.ts';
	const barrelPath = '/virtual/keyof-barrel-entry.ts';
	const program = createInMemoryProgram({
		[dependencyPath]: `export interface Params {
  alpha: string;
}
export type Keys = keyof Params;`,
		[sourcePath]: `import type { Keys } from './keyof-barrel-dependency';
export type PublicKeys = Keys;`,
		[barrelPath]: `export { type PublicKeys } from './keyof-barrel-source';`,
	});
	const moduleDefinition = parseSerializedModule(barrelPath, program);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'PublicKeys',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
			resolvedType: { kind: 'literal', value: '"alpha"' },
		},
	});
});

it('preserves keyof aliases through local import-then-export specifiers', () => {
	const sourcePath = '/virtual/keyof-import-export-source.ts';
	const entryPath = '/virtual/keyof-import-export-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
		[entryPath]: `import type { Keys, Keys as ImportedKeys } from './keyof-import-export-source';
export type { Keys, ImportedKeys as RenamedKeys };`,
	});
	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'Keys',
			type: { kind: 'typeOperator', operator: 'keyof' },
		},
		{
			name: 'RenamedKeys',
			type: { kind: 'typeOperator', operator: 'keyof' },
		},
	]);
});

it('preserves keyof operators in return and container element types', () => {
	const filePath = '/virtual/keyof-nested-positions.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type KeyFactory = () => keyof Params;
export type KeyArray = (keyof Params)[];
export type GenericKeyArray = Array<keyof Params>;
export type KeyTuple = [keyof Params];
export type ReadonlyKeyArray = readonly (keyof Params)[];
export type ReadonlyKeyTuple = readonly [keyof Params];
export type NamedKeyTuple = [key?: keyof Params];
export type RestKeyTuple = [head: keyof Params, ...tail: (keyof Params)[]];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('KeyFactory')?.type.callSignatures[0].returnValueType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('KeyArray')?.type.elementType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('GenericKeyArray')?.type.elementType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('KeyTuple')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('ReadonlyKeyArray')?.type.elementType).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('ReadonlyKeyTuple')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('NamedKeyTuple')?.type.types[0]).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'intrinsic', intrinsic: 'undefined' },
		],
	});
	expect(exportByName('RestKeyTuple')?.type.types).toMatchObject([
		{ kind: 'typeOperator', operator: 'keyof' },
		{ kind: 'typeOperator', operator: 'keyof' },
	]);
});

it('preserves keyof through referenced aliases at nested and generic boundaries', () => {
	const filePath = '/virtual/keyof-referenced-alias-boundaries.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type Keys = keyof Params;
type GenericKeys<T> = keyof T;
type GenericArray<T> = Array<keyof T>;

export function returns(): Keys {
  return 'a';
}
export type KeyArray = Keys[];
export type GenericAlias<T> = GenericKeys<T>;
export type ConcreteArray = GenericArray<Params>;
export class Example {
  field!: Keys;
}
export interface Dictionary {
  [name: string]: Keys;
}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);
	const operator = { kind: 'typeOperator', operator: 'keyof' };

	expect(exportByName('returns')?.type.callSignatures[0].returnValueType).toMatchObject(operator);
	expect(exportByName('KeyArray')?.type.elementType).toMatchObject(operator);
	expect(exportByName('GenericAlias')?.type).toMatchObject({
		...operator,
		type: { kind: 'typeParameter', name: 'T' },
		resolutionKind: 'baseConstraint',
	});
	expect(exportByName('ConcreteArray')?.type.elementType).toMatchObject({
		...operator,
		type: { typeName: { name: 'Params' } },
		resolutionKind: 'exact',
	});
	expect(exportByName('Example')?.type.properties[0].type).toMatchObject(operator);
	expect(exportByName('Dictionary')?.type.indexSignature.valueType).toMatchObject(operator);
});

it('preserves local imported keyof aliases behind a public alias', () => {
	const sourcePath = '/virtual/keyof-imported-alias-source.ts';
	const entryPath = '/virtual/keyof-imported-alias-entry.ts';
	const program = createInMemoryProgram({
		[sourcePath]: `export interface Params {
  a: string;
  b: number;
}
export type Keys = keyof Params;`,
		[entryPath]: `import type { Keys } from './keyof-imported-alias-source';
export type PublicKeys = Keys;`,
	});
	const moduleDefinition = parseSerializedModule(entryPath, program);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'PublicKeys',
		type: {
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
		},
	});
});

it('preserves qualified and project-mapped keyof alias references', () => {
	const program = createInMemoryProgram(
		{
			[referenceFormsDependencyPath]: referenceFormsDependencySource,
			[referenceFormsSourcePath]: referenceFormsSource,
		},
		referenceFormsCompilerOptions,
	);
	const moduleDefinition = parseSerializedModule(referenceFormsSourcePath, program);
	const exportByName = createExportLookup(moduleDefinition);
	expectReferenceFormExports(exportByName);
});

it('preserves project reference forms through export specifiers', () => {
	const program = createInMemoryProgram(
		{
			[referenceFormsDependencyPath]: referenceFormsDependencySource,
			[referenceFormsSourcePath]: referenceFormsSource,
			[referenceFormsEntryPath]: referenceFormsEntrySource,
		},
		referenceFormsCompilerOptions,
	);
	const moduleDefinition = parseSerializedModule(referenceFormsEntryPath, program);
	const exportByName = createExportLookup(moduleDefinition);
	expectReferenceFormExports(exportByName);
});

it('does not treat unrelated generic array-alias arguments as element syntax', () => {
	const filePath = '/virtual/keyof-array-alias-arguments.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

type AsStrings<Ignored> = string[];
type Reordered<First, Element> = Element[];

export type IgnoredArgument = AsStrings<keyof Params>;
export type ReorderedArgument = Reordered<keyof Params, number>;`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('IgnoredArgument')?.type.elementType).toEqual({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
	expect(exportByName('ReorderedArgument')?.type.elementType).toEqual({
		kind: 'intrinsic',
		intrinsic: 'number',
	});
});

it('resolves keyof alias chains in their lexical namespace scope', () => {
	const filePath = '/virtual/keyof-namespace-shadowing.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`type Keys = string;

export namespace Nested {
  export interface Params {
    nested: string;
  }
  export type Keys = keyof Params;
  export type PublicKeys = Keys;
}`,
		),
	);
	const publicKeys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Nested.PublicKeys',
	);

	expect(publicKeys?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
		type: { typeName: { name: 'Params', namespaces: ['Nested'] } },
	});
});

it('does not treat locally shadowed Array names as built-in containers', () => {
	const filePath = '/virtual/keyof-shadowed-array-names.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
}

type Array<Ignored> = string[];
type ReadonlyArray<Ignored> = number[];
type Readonly<Ignored> = boolean[];

export type Mutable = Array<keyof Params>;
export type ReadonlyValues = ReadonlyArray<keyof Params>;
export type ShadowedUtility = Readonly<keyof Params>;
export type MutableElement = Array<keyof Params>[number];
export type ReadonlyElement = ReadonlyArray<keyof Params>[number];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('Mutable')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'string' },
	});
	expect(exportByName('Mutable')?.type).not.toHaveProperty('isReadonly');
	expect(exportByName('ReadonlyValues')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'number' },
	});
	expect(exportByName('ReadonlyValues')?.type).not.toHaveProperty('isReadonly');
	expect(exportByName('ShadowedUtility')?.type).toMatchObject({
		kind: 'array',
		elementType: { kind: 'intrinsic', intrinsic: 'boolean' },
	});
	expect(exportByName('ShadowedUtility')?.type).not.toHaveProperty('isReadonly');
	expect(exportByName('MutableElement')?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'string',
	});
	expect(exportByName('ReadonlyElement')?.type).toMatchObject({
		kind: 'intrinsic',
		intrinsic: 'number',
	});
});

it('does not change unrelated tuple member aliases when a sibling uses keyof', () => {
	const filePath = '/virtual/keyof-tuple-sibling.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
}

type WithBase<T> = { [K in keyof T]: T[K] };
type PropsOf<T> = WithBase<T>;

export type WithoutKeyof<T> = [PropsOf<T>, number];
export type WithKeyof<T> = [PropsOf<T>, keyof Params];`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('WithoutKeyof')?.type.types[0].typeName).toMatchObject({ name: 'WithBase' });
	expect(exportByName('WithKeyof')?.type.types[0].typeName).toMatchObject({ name: 'WithBase' });
	expect(exportByName('WithKeyof')?.type.types[1]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});

it('preserves parenthesized and union-nested keyof constraints consistently', () => {
	const filePath = '/virtual/keyof-parenthesized.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export type ParenthesizedKeys = (keyof Params);
export function find<T, K extends (keyof T)>(key: K): void {}
export function findOrFallback<T, K extends keyof T | 'fallback'>(key: K): void {}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	expect(exportByName('ParenthesizedKeys')?.type).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});

	const parenthesizedSignature = exportByName('find')?.type.callSignatures[0];
	expect(parenthesizedSignature.parameters[0].type.constraint).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(parenthesizedSignature.parameters[0].type.constraint).toEqual(
		parenthesizedSignature.typeParameters[1].constraint,
	);

	const unionSignature = exportByName('findOrFallback')?.type.callSignatures[0];
	expect(unionSignature.parameters[0].type.constraint).toEqual(
		unionSignature.typeParameters[1].constraint,
	);
	expect(unionSignature.typeParameters[1].constraint).toMatchObject({
		kind: 'union',
		types: [
			{ kind: 'typeOperator', operator: 'keyof' },
			{ kind: 'literal', value: '"fallback"' },
		],
	});
});

it('preserves keyof syntax in class properties, intersections, conditionals, and defaults', () => {
	const filePath = '/virtual/keyof-additional-contexts.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

export class Example {
  private accessorValue!: keyof Params;

  constructor(
    public parameterKey: keyof Params,
    public readonly optionalKey?: keyof Params,
  ) {}

  instance!: keyof Params;
  static value: keyof Params;

  get accessorKey(): keyof Params {
    return 'a';
  }

  get pairedKey(): keyof Params {
    return this.accessorValue;
  }

  set pairedKey(value: keyof Params) {
    this.accessorValue = value;
  }

  get asymmetricKey(): keyof Params {
    return this.accessorValue;
  }

  set asymmetricKey(value: keyof Params | undefined) {
    this.accessorValue = value ?? 'a';
  }

  get inferredKey() {
    return 'a' as const;
  }

  set inferredKey(value: keyof Params) {}

  set setterKey(value: keyof Params) {}
}

export type ExampleInstance = Example;

export type Intersection<T> = keyof T & string;
export type NestedIntersectionLeft<T, U> = (keyof T & U) & string;
export type NestedIntersectionRight<T, U> = U & (keyof T & string);
export type Conditional<T> = T extends unknown ? keyof T : never;
export function withDefault<T = keyof Params>(value: T): void {}`,
		),
	);
	const exportByName = createExportLookup(moduleDefinition);

	const exampleProperties = exportByName('Example')?.type.properties;
	const propertyByName = (name: string) =>
		exampleProperties.find((property: { name: string }) => property.name === name);
	expect(propertyByName('parameterKey')).toMatchObject({
		type: { kind: 'typeOperator', operator: 'keyof' },
	});
	expect(propertyByName('optionalKey')).toMatchObject({
		readonly: true,
		optional: true,
		type: {
			kind: 'union',
			types: [
				{ kind: 'typeOperator', operator: 'keyof' },
				{ kind: 'intrinsic', intrinsic: 'undefined' },
			],
		},
	});
	for (const propertyName of [
		'instance',
		'value',
		'accessorKey',
		'pairedKey',
		'asymmetricKey',
		'setterKey',
	]) {
		expect(propertyByName(propertyName)).toMatchObject({
			type: { kind: 'typeOperator', operator: 'keyof' },
		});
	}
	expect(propertyByName('inferredKey')).toMatchObject({
		type: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
	});
	const instanceProperties = exportByName('ExampleInstance')?.type.properties;
	expect(
		instanceProperties.find((property: { name: string }) => property.name === 'inferredKey'),
	).toMatchObject({
		type: {
			kind: 'union',
			types: [
				{ kind: 'literal', value: '"a"' },
				{ kind: 'literal', value: '"b"' },
			],
		},
	});
	expect(exportByName('Intersection')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
	expect(exportByName('NestedIntersectionLeft')?.type.types).toMatchObject([
		{ kind: 'typeOperator', operator: 'keyof' },
		{ kind: 'typeParameter', name: 'U' },
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	expect(exportByName('NestedIntersectionRight')?.type.types).toMatchObject([
		{ kind: 'typeParameter', name: 'U' },
		{ kind: 'typeOperator', operator: 'keyof' },
		{ kind: 'intrinsic', intrinsic: 'string' },
	]);
	expect(exportByName('Conditional')?.type.types[0]).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});

	const signature = exportByName('withDefault')?.type.callSignatures[0];
	expect(signature.parameters[0].type.defaultValue).toEqual(
		signature.typeParameters[0].defaultValue,
	);
	expect(signature.typeParameters[0].defaultValue).toMatchObject({
		kind: 'typeOperator',
		operator: 'keyof',
	});
});

it('preserves class member keyof syntax when the instance is reached through an alias', () => {
	const filePath = '/virtual/keyof-class-instance-alias.ts';
	const moduleDefinition = parseSerializedModule(
		filePath,
		createInMemoryProgram(
			filePath,
			`interface Params {
  a: string;
  b: number;
}

class Example {
  field!: keyof Params;

  constructor(public parameter: keyof Params) {}

  get accessor(): keyof Params {
    return this.field;
  }

  set accessor(value: keyof Params) {
    this.field = value;
  }
}

export type Instance = Example;`,
		),
	);
	const properties = moduleDefinition.exports[0]?.type.properties;

	expect(properties).toHaveLength(3);
	for (const property of properties) {
		expect(property.type).toMatchObject({
			kind: 'typeOperator',
			operator: 'keyof',
			type: { typeName: { name: 'Params' } },
			resolvedType: {
				kind: 'union',
				types: [
					{ kind: 'literal', value: '"a"' },
					{ kind: 'literal', value: '"b"' },
				],
			},
			resolutionKind: 'exact',
		});
	}
});
