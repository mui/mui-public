import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { type ScopedParserContext } from '../parserContext';
import { type ExportDescriptor } from './exportDescriptors';
import { parseExport } from './exportParser';

const mocks = vi.hoisted(() => ({
	getDocumentationFromSymbol: vi.fn(),
	resolveExportDescriptors: vi.fn(),
	resolveType: vi.fn(),
}));

vi.mock('./documentationParser', () => ({
	getDocumentationFromSymbol: mocks.getDocumentationFromSymbol,
}));

vi.mock('./exportDescriptors', () => ({
	resolveExportDescriptors: mocks.resolveExportDescriptors,
}));

vi.mock('./typeResolver', () => ({
	resolveType: mocks.resolveType,
}));

afterEach(() => {
	vi.clearAllMocks();
});

function createSymbol(name: string): ts.Symbol {
	return {
		name,
		declarations: [],
	} as unknown as ts.Symbol;
}

function createDescriptor(
	name: string,
	typeResolutionOrder: number,
	parentNamespaces: string[] = [],
): ExportDescriptor {
	return {
		name,
		symbol: createSymbol(name),
		getType: () => ({ debugName: name }) as unknown as ts.Type,
		parentNamespaces,
		typeResolutionOrder,
		symbolScope: [...parentNamespaces, name],
		declarationSpaces: { isValue: true, isType: false, isNamespace: false },
	};
}

function createParserContext(): ScopedParserContext {
	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [];

	return {
		parsedSymbolStack,
		sourceNodeStack,
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
	} as ScopedParserContext;
}

it('resolves descriptor types in legacy traversal order while preserving emitted order', () => {
	const resolvedTypes: string[] = [];
	mocks.resolveExportDescriptors.mockReturnValue([
		createDescriptor('Root', 1),
		createDescriptor('Props', 0, ['Root']),
	]);
	mocks.resolveType.mockImplementation((type: { debugName: string }) => {
		resolvedTypes.push(type.debugName);
		return {
			kind: 'intrinsic',
			intrinsic: 'string',
			toString: () => 'string',
		};
	});

	const exports = parseExport(createSymbol('Root'), createParserContext());

	// Merged namespace members resolve first to preserve TypeScript/cache side
	// effects, but the public API still emits the owner export before its members.
	expect(resolvedTypes).toEqual(['Props', 'Root']);
	expect(exports?.map((exportNode) => exportNode.name)).toEqual(['Root', 'Root.Props']);
});
