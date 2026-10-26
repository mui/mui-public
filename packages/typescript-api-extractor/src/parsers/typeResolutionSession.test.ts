import ts from 'typescript';
import { expect, it } from 'vitest';
import { ObjectNode } from '../index';
import { parseFromProgram } from '../index';
import { resolveType } from './typeResolver';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';
import { createTestParserContext } from '../../test/support/parserContext';

const filePath = '/virtual/session.ts';

function getDeclaredType(program: ts.Program, exportName: string): ts.Type {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath)!;
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile)!;
	const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === exportName)!;
	return checker.getDeclaredTypeOfSymbol(symbol);
}

it('returns the cached node when the same type is resolved again at the same depth', () => {
	const program = createInMemoryProgram(
		filePath,
		'export interface Point { x: number; y: number; }',
	);
	const { context } = createTestParserContext(program, filePath);
	const type = getDeclaredType(program, 'Point');

	const first = resolveType(type, undefined, context);
	const second = resolveType(type, undefined, context);

	expect(first).toBeInstanceOf(ObjectNode);
	expect((first as ObjectNode).properties).toHaveLength(2);
	// Identity proves the second call hit the cache rather than re-resolving.
	expect(second).toBe(first);
});

it('breaks recursive types with a shallow placeholder instead of recursing forever', () => {
	const program = createInMemoryProgram(
		filePath,
		'export interface Node { value: number; next: Node; }',
	);
	const { context } = createTestParserContext(program, filePath);
	const type = getDeclaredType(program, 'Node');

	const resolved = resolveType(type, undefined, context) as ObjectNode;
	const next = resolved.properties.find((property) => property.name === 'next')!;

	expect(next.type).toBeInstanceOf(ObjectNode);
	// The self-reference resolves to a shallow node carrying the type name but no
	// expanded members, which is how the session terminates the cycle.
	expect((next.type as ObjectNode).properties).toHaveLength(0);
});

it('does not warn for fully supported types', () => {
	const program = createInMemoryProgram(
		filePath,
		'export interface Point { x: number; y: number; }',
	);
	const { context, warnings } = createTestParserContext(program, filePath);
	const type = getDeclaredType(program, 'Point');

	resolveType(type, undefined, context);

	expect(warnings).toHaveLength(0);
});

it('terminates authored syntax replay that selects the node being replayed', () => {
	// `Foo['a' | 'b']` selects both properties. One of them is annotated with the
	// very same indexed access, so replaying the keyof-bearing sibling walks back
	// into the node the replay started from. Cycle detection on the semantic path
	// never sees this, because a successful replay returns before reaching it.
	const replayFilePath = '/virtual/authored-syntax-replay-cycle.ts';
	const program = createInMemoryProgram({
		[replayFilePath]: `export interface Source {
  x: string;
  y: number;
}

export interface Foo {
  a: Foo['a' | 'b'];
  b: keyof Source;
}

export type Result = Foo['a' | 'b'];
`,
	});

	expect(() => parseFromProgram(replayFilePath, program)).not.toThrow();
});
