import ts from 'typescript';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import {
	parseFile,
	parseFromProgram,
	TypeOperatorNode,
	type ModuleNode,
	type ParserOptions,
	type ParserWarning,
	type ResolvedModuleNode,
	type SyntaxOnlyModuleNode,
	type TypeOperatorResolutionKind,
} from './index';
import { type ScopedParserContext } from './parserContext';
import { parseExport } from './parsers/exportParser';
import { createInMemoryProgram } from '../test/support/inMemoryProgram';

afterEach(() => {
	vi.restoreAllMocks();
});

// Open string unions such as `'small' | (string & {})` suggest known values while still
// accepting any string. `keyof` cannot resolve their `string & {}` key, so that key falls
// back to `any` and warns.
const openUnionKeys = "keyof Record<'small' | 'large' | (string & {}), number>";
const unsupportedTypeSource = `export type SizeKey = ${openUnionKeys};`;
const repeatedUnsupportedTypeSource = `type SizeKey = ${openUnionKeys};

export interface Props {
  a: SizeKey;
  b: SizeKey;
}`;
const symbolStackRestorationSource = `type SizeKey = ${openUnionKeys};

export interface Props {
  nested: SizeKey;
}

export type AfterProps = SizeKey;`;
const preciseWarningSource = `export function functionReturn():
  keyof Record<'function' | (string & {}), number> {
  return undefined as any;
}

export class ClassWarnings {
  methodParam(
    value: keyof Record<'param' | (string & {}), number>,
  ): void {}

  methodReturn():
    keyof Record<'return' | (string & {}), number> {
    return undefined as any;
  }

  property:
    keyof Record<'property' | (string & {}), number>;
}`;
const sourceNodeRestorationSource = `export function withReturn():
  keyof Record<'return' | (string & {}), number> {
  return undefined as any;
}

export type AfterReturn = keyof Record<'alias' | (string & {}), number>;`;
const aliasWithExtraResolvedTypeArgumentsSource = `interface Extras<T> {
  pending: T;
}

type Result<T> = [T, (next: T) => void, Extras<T>];

interface Options<T, P> {
  causesLayoutShift: (t: T) => boolean;
  preload?: (t: T) => P | Promise<P>;
}

type FixedOptions<P> = Options<string | null, P>;

export function useThing<T, P = void>(
  initial: T,
  options: Options<T, P>,
): Result<T> {
  return [initial, () => {}, { pending: initial }] as Result<T>;
}

export function useFixed<P = void>(
  options: FixedOptions<P>,
): Result<string | null> {
  return useThing<string | null, P>(null, options);
}`;

function expectKind<TNode extends { kind: string }, TKind extends TNode['kind']>(
	node: TNode,
	kind: TKind,
): asserts node is Extract<TNode, { kind: TKind }> {
	expect(node.kind).toBe(kind);
	if (node.kind !== kind) {
		throw new Error(`Expected node kind "${kind}", received "${node.kind}"`);
	}
}

function getExpectedUnsupportedTypeWarningMessage(filePath: string): string {
	return `Type extraction warning: Unable to handle type "string & {}" with flag "Intersection" while resolving "${openUnionKeys}" at "${filePath}:1:23". Using any instead.`;
}

it('reports unsupported type fallbacks through onWarning', () => {
	const filePath = '/virtual/unsupported-type-warning.ts';
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const parserOptions: ParserOptions = {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	};

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource), parserOptions);

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'unsupported-type-fallback',
		filePath,
		line: 1,
		column: 23,
		parsedSymbolStack: [filePath, 'SizeKey'],
		typeFlags: ['Intersection'],
		typeText: 'string & {}',
		sourceText: openUnionKeys,
	});
	expect(warnings[0]!.message).toBe(getExpectedUnsupportedTypeWarningMessage(filePath));
	expect(warnings[0]!.message).toContain('Type extraction warning:');
	expect(warnings[0]!.message).not.toContain('IncludesWildcard');
});

it('logs unsupported type fallbacks by default', () => {
	const filePath = '/virtual/default-unsupported-type-warning.ts';
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

	parseFromProgram(filePath, createInMemoryProgram(filePath, unsupportedTypeSource));

	expect(warn).toHaveBeenCalledTimes(1);
	expect(warn).toHaveBeenCalledWith(getExpectedUnsupportedTypeWarningMessage(filePath));
});

it('reports unsupported type fallbacks for every use of a repeated type', () => {
	const filePath = '/virtual/repeated-unsupported-type-warning.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, repeatedUnsupportedTypeSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(2);
	expect(unsupportedWarnings).toEqual([
		expect.objectContaining({
			line: 1,
			column: 16,
			sourceText: openUnionKeys,
			parsedSymbolStack: [filePath, 'Props', 'property: a'],
		}),
		expect.objectContaining({
			line: 1,
			column: 16,
			sourceText: openUnionKeys,
			parsedSymbolStack: [filePath, 'Props', 'property: b'],
		}),
	]);
});

// Warning metadata is the public symptom of parser-context scope leaks, so these
// tests pin down stack restoration without coupling to the context implementation.
it('restores parser context after nested property warnings', () => {
	const filePath = '/virtual/symbol-stack-restoration.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, symbolStackRestorationSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(2);
	expect(unsupportedWarnings).toEqual([
		expect.objectContaining({
			sourceText: openUnionKeys,
			parsedSymbolStack: [filePath, 'Props', 'property: nested'],
		}),
		expect.objectContaining({
			sourceText: openUnionKeys,
			parsedSymbolStack: [filePath, 'AfterProps'],
		}),
	]);
});

it('restores source-node context after nested signature warnings', () => {
	const filePath = '/virtual/source-node-restoration.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, sourceNodeRestorationSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(2);
	expect(unsupportedWarnings).toEqual([
		expect.objectContaining({
			line: 2,
			sourceText: "keyof Record<'return' | (string & {}), number>",
			parsedSymbolStack: [filePath, 'withReturn'],
		}),
		expect.objectContaining({
			line: 6,
			sourceText: "keyof Record<'alias' | (string & {}), number>",
			parsedSymbolStack: [filePath, 'AfterReturn'],
		}),
	]);
});

it('reports precise type locations in functions, class signatures, and class properties', () => {
	const filePath = '/virtual/precise-warning-locations.ts';
	const warnings: ParserWarning[] = [];

	parseFromProgram(filePath, createInMemoryProgram(filePath, preciseWarningSource), {
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	const unsupportedWarnings = warnings.filter(
		(warning) => warning.code === 'unsupported-type-fallback',
	);

	expect(unsupportedWarnings).toHaveLength(4);
	expect(unsupportedWarnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				line: 2,
				column: 3,
				sourceText: "keyof Record<'function' | (string & {}), number>",
				parsedSymbolStack: [filePath, 'functionReturn'],
			}),
			expect.objectContaining({
				line: 8,
				column: 12,
				sourceText: "keyof Record<'param' | (string & {}), number>",
				parsedSymbolStack: [filePath, 'ClassWarnings', 'parameter: value'],
			}),
			expect.objectContaining({
				line: 12,
				column: 5,
				sourceText: "keyof Record<'return' | (string & {}), number>",
				parsedSymbolStack: [filePath, 'ClassWarnings'],
			}),
			expect.objectContaining({
				line: 17,
				column: 5,
				sourceText: "keyof Record<'property' | (string & {}), number>",
				parsedSymbolStack: [filePath, 'ClassWarnings'],
				typeFlags: ['Intersection'],
				typeText: 'string & {}',
			}),
		]),
	);
	for (const warning of unsupportedWarnings) {
		expect(warning.line).not.toBe(1);
		expect(warning.column).not.toBe(1);
	}
});

it('parses generic aliases whose resolved types expose extra type arguments', () => {
	const filePath = '/virtual/alias-extra-resolved-type-arguments.ts';

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, aliasWithExtraResolvedTypeArgumentsSource),
	);

	expect(moduleDefinition.exports).toMatchObject([
		{
			name: 'useThing',
			type: {
				callSignatures: [
					{
						returnValueType: {
							kind: 'tuple',
							typeName: {
								name: 'Result',
								typeArguments: [
									expect.objectContaining({ equalToDefault: false }),
									expect.objectContaining({ equalToDefault: false }),
									expect.objectContaining({ equalToDefault: false }),
								],
							},
						},
					},
				],
			},
		},
		{
			name: 'useFixed',
			type: {
				callSignatures: [
					{
						parameters: [
							{
								type: {
									typeName: {
										name: 'FixedOptions',
										typeArguments: [
											expect.objectContaining({ equalToDefault: false }),
											expect.objectContaining({ equalToDefault: false }),
										],
									},
								},
							},
						],
					},
				],
			},
		},
	]);
});

it('correlates type operator payloads with the selected output mode', () => {
	const filePath = '/virtual/type-operator-output-types.ts';
	const source = `export interface Props { key: keyof { value: string } }
interface Box<T> { value: T }
export function useBox(value: Box<keyof Props>): void {}`;
	const program = createInMemoryProgram(filePath, source);

	const resolvedModule = parseFromProgram(filePath, program);
	const compatibleModule: ModuleNode = resolvedModule;
	const resolvedType = resolvedModule.exports.find(
		(parsedExport) => parsedExport.name === 'Props',
	)!.type;
	expectKind(resolvedType, 'object');
	const resolvedOperator = resolvedType.properties[0]!.type;
	expectKind(resolvedOperator, 'typeOperator');
	expect(resolvedOperator.resolvedType.kind).toBeDefined();
	const resolutionKind: TypeOperatorResolutionKind = resolvedOperator.resolutionKind;
	expect(resolutionKind).toBe('exact');

	const explicitResolvedModule = parseFromProgram(filePath, program, {
		typeOperatorOutput: 'resolved',
	});
	const explicitResolvedType = explicitResolvedModule.exports.find(
		(parsedExport) => parsedExport.name === 'Props',
	)!.type;
	expectKind(explicitResolvedType, 'object');
	const explicitResolvedOperator = explicitResolvedType.properties[0]!.type;
	expectKind(explicitResolvedOperator, 'typeOperator');
	expect(explicitResolvedOperator.resolvedType.kind).toBeDefined();

	const syntaxOnlyModule = parseFromProgram(filePath, program, {
		typeOperatorOutput: 'syntaxOnly',
	});
	const compatibleSyntaxOnlyModule: ModuleNode = syntaxOnlyModule;
	const syntaxOnlyType = syntaxOnlyModule.exports.find(
		(parsedExport) => parsedExport.name === 'Props',
	)!.type;
	expectKind(syntaxOnlyType, 'object');
	const syntaxOnlyOperator = syntaxOnlyType.properties[0]!.type;
	expectKind(syntaxOnlyOperator, 'typeOperator');
	expect(syntaxOnlyOperator).toBeInstanceOf(TypeOperatorNode);
	expectTypeOf(syntaxOnlyOperator.resolvedType).toEqualTypeOf<undefined>();
	expect(syntaxOnlyOperator).not.toHaveProperty('resolvedType');
	if (syntaxOnlyOperator instanceof TypeOperatorNode) {
		expectTypeOf(syntaxOnlyOperator.resolvedType).toEqualTypeOf<undefined>();
	}

	const syntaxOnlyFunction = syntaxOnlyModule.exports.find(
		(parsedExport) => parsedExport.name === 'useBox',
	)!.type;
	expectKind(syntaxOnlyFunction, 'function');
	const parameterType = syntaxOnlyFunction.callSignatures[0]!.parameters[0]!.type;
	expectKind(parameterType, 'object');
	const typeArgument = parameterType.typeName?.typeArguments?.[0]?.type;
	if (!typeArgument) {
		throw new Error('Expected the Box type argument to preserve its operator');
	}
	expectKind(typeArgument, 'typeOperator');
	expectTypeOf(typeArgument.resolvedType).toEqualTypeOf<undefined>();

	const syntaxOnlyCopy = syntaxOnlyModule.exports
		.find((parsedExport) => parsedExport.name === 'useBox')!
		.withType(syntaxOnlyFunction);
	expectKind(syntaxOnlyCopy.type, 'function');
	const copiedParameterType = syntaxOnlyCopy.type.callSignatures[0]!.parameters[0]!.type;
	expectKind(copiedParameterType, 'object');
	const copiedTypeArgument = copiedParameterType.typeName?.typeArguments?.[0]?.type;
	if (!copiedTypeArgument) {
		throw new Error('Expected the copied type argument to preserve its operator');
	}
	expectKind(copiedTypeArgument, 'typeOperator');
	expectTypeOf(copiedTypeArgument.resolvedType).toEqualTypeOf<undefined>();

	const dynamicOptions: ParserOptions = { typeOperatorOutput: 'syntaxOnly' };
	const dynamicModule = parseFromProgram(filePath, program, dynamicOptions);
	const dynamicType = dynamicModule.exports.find(
		(parsedExport) => parsedExport.name === 'Props',
	)!.type;
	expectKind(dynamicType, 'object');
	const dynamicOperator = dynamicType.properties[0]!.type;
	expectKind(dynamicOperator, 'typeOperator');
	expect(dynamicOperator).toBeInstanceOf(TypeOperatorNode);
	type DynamicPayloadCanBeUndefined = undefined extends typeof dynamicOperator.resolvedType
		? true
		: false;
	expectTypeOf<DynamicPayloadCanBeUndefined>().toEqualTypeOf<true>();
	if (dynamicOperator instanceof TypeOperatorNode) {
		type InstancePayloadCanBeUndefined = undefined extends typeof dynamicOperator.resolvedType
			? true
			: false;
		expectTypeOf<InstancePayloadCanBeUndefined>().toEqualTypeOf<true>();
	}
	if (dynamicOperator.resolvedType) {
		expect(dynamicOperator.resolvedType.kind).toBeDefined();
	}
	expect(dynamicOperator.resolvedType).toBeUndefined();

	expect(compatibleModule.exports[0]).toBeDefined();
	expect(compatibleSyntaxOnlyModule.exports[0]).toBeDefined();
	expect(resolvedModule.exports[0]).toBeDefined();
	expect(syntaxOnlyModule.exports[0]).toBeDefined();
});

it('correlates parseFile return types with literal and dynamic output modes', () => {
	const filePath = new URL(
		'../test/fixtures/type-literal-union-resolution/input.ts',
		import.meta.url,
	).pathname;
	const compilerOptions = {
		rootDir: new URL('../test/fixtures/type-literal-union-resolution', import.meta.url).pathname,
		strict: true,
		target: ts.ScriptTarget.ESNext,
	};

	const defaultModule = parseFile(filePath, compilerOptions);
	expectTypeOf(defaultModule).toEqualTypeOf<ResolvedModuleNode>();
	const resolvedModule = parseFile(filePath, compilerOptions, {
		typeOperatorOutput: 'resolved',
	});
	expectTypeOf(resolvedModule).toEqualTypeOf<ResolvedModuleNode>();
	const syntaxOnlyModule = parseFile(filePath, compilerOptions, {
		typeOperatorOutput: 'syntaxOnly',
	});
	expectTypeOf(syntaxOnlyModule).toEqualTypeOf<SyntaxOnlyModuleNode>();
	const dynamicOptions: ParserOptions = { typeOperatorOutput: 'syntaxOnly' };
	const dynamicModule = parseFile(filePath, compilerOptions, dynamicOptions);
	expectTypeOf(dynamicModule).toEqualTypeOf<ResolvedModuleNode | SyntaxOnlyModuleNode>();

	const getKeyofOperator = (module: ResolvedModuleNode | SyntaxOnlyModuleNode) => {
		const functionType = module.exports.find(
			(parsedExport) => parsedExport.name === 'acceptsKeyofProp',
		)!.type;
		expectKind(functionType, 'function');
		const parameterType = functionType.callSignatures[0]!.parameters[0]!.type;
		expectKind(parameterType, 'typeOperator');
		return parameterType;
	};
	const defaultOperator = getKeyofOperator(defaultModule);
	const resolvedOperator = getKeyofOperator(resolvedModule);
	const syntaxOnlyOperator = getKeyofOperator(syntaxOnlyModule);
	const dynamicOperator = getKeyofOperator(dynamicModule);

	expect(defaultOperator).toHaveProperty('resolvedType');
	expect(resolvedOperator).toHaveProperty('resolvedType');
	expect(syntaxOnlyOperator).not.toHaveProperty('resolvedType');
	expect(dynamicOperator).not.toHaveProperty('resolvedType');

	expect(defaultModule.exports).not.toHaveLength(0);
	expect(resolvedModule.exports).not.toHaveLength(0);
	expect(syntaxOnlyModule.exports).not.toHaveLength(0);
	expect(dynamicModule.exports).not.toHaveLength(0);
});

it('reports missing enum declarations through onWarning', () => {
	const sourceFile = ts.createSourceFile(
		'/virtual/missing-enum-declaration.ts',
		'export enum Missing {}',
		ts.ScriptTarget.ES2022,
		true,
	);
	const enumDeclaration = sourceFile.statements[0]!;
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [sourceFile];
	const context = {
		checker: {
			getSymbolAtLocation: () => ({ name: 'Missing' }),
		},
		sourceFile,
		parsedSymbolStack,
		sourceNodeStack,
		onWarning: (warning: ParserWarning) => {
			warnings.push(warning);
		},
		runWithSymbolScope: <T>(symbolName: string, callback: () => T): T => {
			parsedSymbolStack.push(symbolName);
			try {
				return callback();
			} finally {
				parsedSymbolStack.pop();
			}
		},
		runWithSourceNodeScope: <T>(sourceNode: ts.Node | undefined, callback: () => T): T => {
			if (sourceNode) {
				sourceNodeStack.push(sourceNode);
			}
			try {
				return callback();
			} finally {
				if (sourceNode) {
					sourceNodeStack.pop();
				}
			}
		},
		runWithTypeParameterSubstitutionScope: <T>(
			_substitutions: Map<ts.Symbol, ts.Type>,
			callback: () => T,
		): T => callback(),
	} as unknown as ScopedParserContext;

	parseExport(
		{
			name: 'Missing',
			declarations: [enumDeclaration],
		} as unknown as ts.Symbol,
		context,
	);

	expect(warn).not.toHaveBeenCalled();
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'missing-enum-declaration',
		filePath: sourceFile.fileName,
		line: 1,
		column: 1,
		parsedSymbolStack: ['Missing'],
		enumName: 'Missing',
	});
});

it('reports missing default export symbols through onWarning', () => {
	const filePath = '/virtual/missing-default-export-symbol.ts';
	const warnings: ParserWarning[] = [];
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});

	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, 'export default 1;'),
		{
			onWarning: (warning) => {
				warnings.push(warning);
			},
		},
	);

	expect(warn).not.toHaveBeenCalled();
	expect(error).not.toHaveBeenCalled();
	expect(moduleDefinition.exports).toEqual([]);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		code: 'missing-default-export-symbol',
		filePath,
		line: 1,
		column: 16,
		parsedSymbolStack: [filePath, 'default'],
		sourceText: '1',
	});
	expect(warnings[0]!.message).toBe(
		`Type extraction warning: Could not find the symbol of default export "1" at "${filePath}:1:16". Skipping this export.`,
	);
});
