import ts from 'typescript';
import { expect, it } from 'vitest';
import { parseFromProgram } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';
import { getPreservableKeyofTypeNode } from './typeOperatorTypeNodes';

// These inputs are circular by construction, so TypeScript reports them as
// errors (TS2502). They cannot live under `test/fixtures` because those are
// typechecked, but the checker still answers property queries on them, so the
// extractor walks the same indexed-access syntax the guard has to terminate.

it('terminates self-referential indexed-access property syntax', () => {
	const filePath = '/virtual/self-referential-indexed-access.ts';
	const program = createInMemoryProgram({
		[filePath]: `export interface Foo {
  a: Foo['a'];
}

export type Alias = Foo['a'];
`,
	});

	expect(() => parseFromProgram(filePath, program)).not.toThrow();
});

it('terminates mutually recursive indexed-access property syntax', () => {
	const filePath = '/virtual/mutual-indexed-access.ts';
	const program = createInMemoryProgram({
		[filePath]: `export interface A {
  x: B['y'];
}

export interface B {
  y: A['x'];
}

export type UseIt = A['x'];
`,
	});

	expect(() => parseFromProgram(filePath, program)).not.toThrow();
});

it('terminates recursive indexed access reached through an index signature', () => {
	const filePath = '/virtual/recursive-index-signature.ts';
	const program = createInMemoryProgram({
		[filePath]: `export interface Bag {
  [key: string]: Bag[string];
}

export type Value = Bag[string];
`,
	});

	expect(() => parseFromProgram(filePath, program)).not.toThrow();
});

it('still follows non-circular indexed-access chains to their authored keyof syntax', () => {
	const filePath = '/virtual/indexed-access-keyof-chain.ts';
	const program = createInMemoryProgram({
		[filePath]: `interface Source {
  a: string;
  b: number;
}

interface Middle {
  value: keyof Source;
}

interface Outer {
  nested: Middle['value'];
}

export type Keys = Outer['nested'];
`,
	});

	const moduleDefinition = JSON.parse(JSON.stringify(parseFromProgram(filePath, program)));
	const keys = moduleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Keys',
	);

	expect(keys.type.kind).toBe('typeOperator');
	expect(keys.type.operator).toBe('keyof');
	expect(keys.type.type.typeName).toEqual({ name: 'Source' });
});

it('finds keyof through an indexed access on a substituted type parameter', () => {
	// `substituteTypeParameterTypeNode` only rewrites a bare root reference, so
	// `T['value']` keeps its nested `T`. The active arguments therefore have to
	// travel into the alias traversal for the operand to resolve to `Holder`.
	const filePath = '/virtual/indexed-access-substitution.ts';
	const program = createInMemoryProgram({
		[filePath]: `interface Foo {
  a: string;
  b: number;
}

interface Holder {
  value: keyof Foo;
}

declare function generic<T extends { value: unknown }>(x: T['value']): void;

type HolderReference = Holder;
`,
	});
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath)!;

	let indexedAccess: ts.IndexedAccessTypeNode | undefined;
	let holderReference: ts.TypeNode | undefined;
	let typeParameter: ts.Symbol | undefined;
	const visit = (node: ts.Node): void => {
		if (ts.isIndexedAccessTypeNode(node)) {
			indexedAccess = node;
		}
		if (ts.isTypeAliasDeclaration(node) && node.name.text === 'HolderReference') {
			holderReference = node.type;
		}
		if (ts.isFunctionDeclaration(node) && node.typeParameters) {
			typeParameter = checker.getSymbolAtLocation(node.typeParameters[0]!.name);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	const substitutions = new Map([[typeParameter!, holderReference!]]);

	expect(getPreservableKeyofTypeNode(indexedAccess!, checker, substitutions)?.getText()).toBe(
		"T['value']",
	);
	// Without the binding there is nothing to resolve `T` against, so the access
	// stays unpreservable and semantic resolution stands in.
	expect(getPreservableKeyofTypeNode(indexedAccess!, checker)).toBeUndefined();
});
