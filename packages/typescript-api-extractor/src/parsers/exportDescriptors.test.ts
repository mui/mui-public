import ts from 'typescript';
import { expect, it } from 'vitest';
import { resolveExportDescriptors } from './exportDescriptors';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';
import { createTestParserContext } from '../../test/support/parserContext';

function getModuleExport(program: ts.Program, filePath: string, exportName: string): ts.Symbol {
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Missing source file: ${filePath}`);
	}

	const checker = program.getTypeChecker();
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!moduleSymbol) {
		throw new Error(`Missing module symbol: ${filePath}`);
	}

	const exportSymbol = checker
		.getExportsOfModule(moduleSymbol)
		.find((symbol) => symbol.name === exportName);
	if (!exportSymbol) {
		throw new Error(`Missing export: ${exportName}`);
	}

	return exportSymbol;
}

it('normalizes aliased re-exports and merged namespace members before node construction', () => {
	const inputPath = '/virtual/input.ts';
	const program = createInMemoryProgram({
		[inputPath]: "export { ComponentRoot as Root } from './source';",
		'/virtual/source.ts': `export function ComponentRoot(): void {}

export namespace ComponentRoot {
  export interface Props {
    value: string;
  }
}`,
	});
	const { context } = createTestParserContext(program, inputPath);
	const exportSymbol = getModuleExport(program, inputPath, 'Root');

	const descriptors = resolveExportDescriptors(exportSymbol, context);

	// Descriptor order is part of the export contract: main export first, then
	// namespace members under the public alias path.
	expect(
		descriptors?.map((descriptor) => ({
			name: descriptor.name,
			parentNamespaces: descriptor.parentNamespaces,
			reexportedFrom: descriptor.reexportedFrom,
			scope: descriptor.symbolScope,
			symbolName: descriptor.symbol.name,
			typeResolutionOrder: descriptor.typeResolutionOrder,
		})),
	).toEqual([
		{
			name: 'Root',
			parentNamespaces: [],
			reexportedFrom: 'ComponentRoot',
			scope: ['Root'],
			symbolName: 'ComponentRoot',
			typeResolutionOrder: 1,
		},
		{
			name: 'Props',
			parentNamespaces: ['Root'],
			reexportedFrom: undefined,
			scope: ['Root', 'Props'],
			symbolName: 'Props',
			typeResolutionOrder: 0,
		},
	]);
	expect(context.parsedSymbolStack).toEqual([]);
});
