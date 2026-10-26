import ts from 'typescript';
import { type DeclarationSpaces } from '../models';

/**
 * Determines which declaration spaces an export occupies. See
 * {@link DeclarationSpaces} for the semantics.
 *
 * Every symbol on the alias chain contributes its own flags: an alias merged
 * with a local declaration occupies the spaces of both, and each hop of a
 * re-export chain can merge in more. Namespaces are recognized by an actual
 * namespace, module, or source-file declaration rather than
 * `SymbolFlags.Module`, because the binder also sets that flag for expando
 * assignments (`fn.extra = ...`).
 */
export function getDeclarationSpaces(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
): DeclarationSpaces {
	const chain = getAliasChain(symbol, checker);
	const flags = getCombinedFlags(chain);

	return {
		isValue: (flags & ts.SymbolFlags.Value) !== 0,
		isType: (flags & ts.SymbolFlags.Type) !== 0,
		isNamespace: chain.some(isNamespaceSymbol),
	};
}

/**
 * Whether an export reached only through type-only sites still has something to
 * export: a type meaning anywhere along its alias chain, or a namespace that is
 * not merged onto a function or variable. A function or variable is dropped
 * along with any namespace merged onto it, since only its value would remain.
 */
export function isRetainedWithoutValue(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const chain = getAliasChain(symbol, checker);
	const flags = getCombinedFlags(chain);
	if (flags & ts.SymbolFlags.Type) {
		return true;
	}

	return (
		(flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) === 0 &&
		chain.some(isNamespaceSymbol)
	);
}

/**
 * A source file only declares a namespace through its module symbol. The
 * synthetic `export=` property of a JSON module is declared by the JSON file
 * too, but it is a plain value. A namespace import carries namespace meaning
 * even when its module cannot be resolved.
 */
function isNamespaceSymbol(symbol: ts.Symbol): boolean {
	return (
		symbol.declarations?.some(
			(declaration) =>
				ts.isModuleDeclaration(declaration) ||
				ts.isNamespaceImport(declaration) ||
				(ts.isSourceFile(declaration) && (symbol.flags & ts.SymbolFlags.Module) !== 0),
		) ?? false
	);
}

function getAliasChain(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol[] {
	const chain: ts.Symbol[] = [];
	let current: ts.Symbol | undefined = symbol;
	while (current && !chain.includes(current)) {
		chain.push(current);
		// An alias into an unresolvable module has no immediate target; the fully
		// resolved alias then carries the checker's fallback symbol.
		current =
			current.flags & ts.SymbolFlags.Alias
				? (checker.getImmediateAliasedSymbol(current) ?? checker.getAliasedSymbol(current))
				: undefined;
	}

	return chain;
}

function getCombinedFlags(chain: ts.Symbol[]): ts.SymbolFlags {
	return chain.reduce<ts.SymbolFlags>(
		(flags, current) => flags | current.flags,
		ts.SymbolFlags.None,
	);
}
