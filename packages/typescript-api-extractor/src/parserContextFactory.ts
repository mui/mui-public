import ts from 'typescript';
import { type ParserOptions, type ShouldResolveObjectData } from './parser';
import { type ScopedParserContext } from './parserContext';

/**
 * Builds the scoped parser context shared by production parsing and focused tests.
 *
 * @param checker - TypeScript checker for the program being extracted.
 * @param sourceFile - Root source file whose exports are being extracted.
 * @param program - Program that owns the checker and source file.
 * @param parserOptions - Optional public policy overrides and warning handler.
 * @returns A context with balanced symbol, source-node, and substitution scopes.
 */
export function createParserContext(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	program: ts.Program,
	parserOptions: ParserOptions = {},
): ScopedParserContext {
	const parsedSymbolStack: string[] = [];
	const sourceNodeStack: ts.Node[] = [sourceFile];
	// The scope callbacks close over `context` so they can temporarily replace
	// substitution maps on the same object observed by every nested resolver.
	// The object is assigned before any callback can execute.
	const context: ScopedParserContext = {
		checker,
		sourceFile,
		typeStack: [],
		authoredSyntaxStack: [],
		compilerOptions: program.getCompilerOptions(),
		parsedSymbolStack,
		sourceNodeStack,
		program,
		propertyDepth: 0,
		resolvedTypeCache: new Map(),
		...resolveParserOptions(parserOptions),
		runWithSymbolScope: (symbolName, callback) =>
			runWithStackEntryScope(parsedSymbolStack, symbolName, callback),
		runWithSourceNodeScope: (sourceNode, callback) =>
			sourceNode ? runWithStackEntryScope(sourceNodeStack, sourceNode, callback) : callback(),
		runWithPropertyValueScope: (callback) => {
			context.propertyDepth += 1;

			try {
				return callback();
			} finally {
				context.propertyDepth -= 1;
			}
		},
		runWithTypeParameterSubstitutionScope: (
			typeParameterSubstitutions,
			callback,
			typeParameterTypeNodeSubstitutions,
		) => {
			const previousTypes = context.typeParameterSubstitutions;
			const previousTypeNodes = context.typeParameterTypeNodeSubstitutions;
			context.typeParameterSubstitutions = typeParameterSubstitutions;
			if (typeParameterTypeNodeSubstitutions) {
				context.typeParameterTypeNodeSubstitutions = typeParameterTypeNodeSubstitutions;
			}

			try {
				return callback();
			} finally {
				// Deleting an originally absent optional property is observably
				// different from restoring it to `undefined` during context spreads.
				restoreOptionalProperty(context, 'typeParameterSubstitutions', previousTypes);
				restoreOptionalProperty(context, 'typeParameterTypeNodeSubstitutions', previousTypeNodes);
			}
		},
	};

	return context;
}

function resolveParserOptions(parserOptions: ParserOptions) {
	return {
		shouldInclude: (data: { name: string; depth: number }) =>
			parserOptions.shouldInclude?.(data) ?? true,
		shouldResolveObject: (data: ShouldResolveObjectData) =>
			parserOptions.shouldResolveObject?.(data) ??
			((data.propertyDepth === 0 || data.propertyCount <= 50) && data.depth <= 10),
		includeExternalTypes: parserOptions.includeExternalTypes ?? false,
		typeOperatorOutput: parserOptions.typeOperatorOutput ?? 'resolved',
		onWarning:
			parserOptions.onWarning ??
			((warning) => {
				console.warn(warning.message);
			}),
	};
}

function runWithStackEntryScope<T, TEntry>(stack: TEntry[], entry: TEntry, callback: () => T): T {
	stack.push(entry);
	try {
		return callback();
	} finally {
		stack.pop();
	}
}

function restoreOptionalProperty<
	TKey extends 'typeParameterSubstitutions' | 'typeParameterTypeNodeSubstitutions',
>(context: ScopedParserContext, key: TKey, value: ScopedParserContext[TKey]): void {
	if (value) {
		context[key] = value;
	} else {
		delete context[key];
	}
}
