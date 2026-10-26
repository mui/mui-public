import ts from 'typescript';
import { isRetainedWithoutValue } from './declarationSpaces';

/**
 * Tracks what a walk has visited, so cyclic re-exports terminate.
 */
interface ValuePathVisits {
	aliases: Set<ts.Symbol>;
	containerExports: Map<ts.Symbol, Set<ts.__String>>;
}

/**
 * How an export arrives: with its runtime value, as a type only, or not at all.
 * Only a path that crosses no type-only site (`export type { X }`,
 * `import type { X }`, `export type * from`) carries the value. An export
 * reached only through type-only star exports is hidden when nothing but a value
 * would remain (see {@link isRetainedWithoutValue}).
 */
export type ExportReach = 'value' | 'typeOnly' | 'hidden';

/**
 * Classifies one export. Given the module or namespace it is listed in, every
 * path to it is followed module by module, star exports included, because the
 * checker resolves them in one jump that hides type-only barrels. For example,
 * with `export type * from './barrel'` and a barrel doing
 * `export * from './enums'`, an enum from `enums.ts` arrives as a type only.
 * Without a container, only the export symbol's own alias chain is followed.
 *
 * @param exportSymbol The export symbol as the checker lists it.
 * @param containerSymbol The module or namespace symbol listing the export.
 * @param checker Type checker for resolving aliases and module specifiers.
 */
export function getExportReach(
	exportSymbol: ts.Symbol,
	containerSymbol: ts.Symbol | undefined,
	checker: ts.TypeChecker,
): ExportReach {
	const visits: ValuePathVisits = { aliases: new Set(), containerExports: new Map() };
	if (!containerSymbol) {
		return aliasHasValuePath(exportSymbol, checker, visits) ? 'value' : 'typeOnly';
	}

	if (containerExportHasValuePath(containerSymbol, exportSymbol.escapedName, checker, visits)) {
		return 'value';
	}

	const isStarExport = !containerSymbol.exports?.has(exportSymbol.escapedName);
	return isStarExport && !isRetainedWithoutValue(exportSymbol, checker) ? 'hidden' : 'typeOnly';
}

function containerExportHasValuePath(
	containerSymbol: ts.Symbol,
	exportName: ts.__String,
	checker: ts.TypeChecker,
	visits: ValuePathVisits,
): boolean {
	let visitedNames = visits.containerExports.get(containerSymbol);
	if (!visitedNames) {
		visitedNames = new Set();
		visits.containerExports.set(containerSymbol, visitedNames);
	}
	if (visitedNames.has(exportName)) {
		return false;
	}
	visitedNames.add(exportName);

	// Local exports shadow star exports of the same name.
	const localExport = containerSymbol.exports?.get(exportName);
	if (localExport) {
		return aliasHasValuePath(localExport, checker, visits);
	}

	// An `export =` module exports everything through that one assignment: named
	// imports read the assigned symbol's members, a synthetic default reads the
	// assignment itself.
	const exportEquals = containerSymbol.exports?.get(ts.InternalSymbolName.ExportEquals);
	if (exportEquals) {
		const assignedSymbol =
			exportEquals.flags & ts.SymbolFlags.Alias
				? checker.getAliasedSymbol(exportEquals)
				: exportEquals;
		if (
			exportName !== ts.InternalSymbolName.Default &&
			assignedSymbol !== containerSymbol &&
			checker.tryGetMemberInModuleExports(ts.unescapeLeadingUnderscores(exportName), assignedSymbol)
		) {
			return containerExportHasValuePath(assignedSymbol, exportName, checker, visits);
		}

		return aliasHasValuePath(exportEquals, checker, visits);
	}

	const memberName = ts.unescapeLeadingUnderscores(exportName);
	return getValueStarExportTargets(containerSymbol, checker).some(
		(targetModule) =>
			checker.tryGetMemberInModuleExports(memberName, targetModule) !== undefined &&
			containerExportHasValuePath(targetModule, exportName, checker, visits),
	);
}

function aliasHasValuePath(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	visits: ValuePathVisits,
): boolean {
	if (symbol.flags & ts.SymbolFlags.Value || !(symbol.flags & ts.SymbolFlags.Alias)) {
		return true;
	}
	if (visits.aliases.has(symbol)) {
		return false;
	}
	visits.aliases.add(symbol);

	const declarations = symbol.declarations ?? [];
	if (declarations.some(ts.isTypeOnlyImportOrExportDeclaration)) {
		return false;
	}

	for (const declaration of declarations) {
		const moduleHop = getModuleHop(declaration);
		if (moduleHop) {
			const targetModule = checker.getSymbolAtLocation(moduleHop.moduleSpecifier);
			return (
				targetModule === undefined ||
				containerExportHasValuePath(targetModule, moduleHop.exportName, checker, visits)
			);
		}
	}

	const aliasedSymbol = checker.getImmediateAliasedSymbol(symbol);
	return aliasedSymbol === undefined || aliasHasValuePath(aliasedSymbol, checker, visits);
}

/**
 * The module and export name an import or re-export specifier reads from, so
 * the walk can continue through that module's own export paths.
 */
function getModuleHop(
	declaration: ts.Declaration,
): { moduleSpecifier: ts.Expression; exportName: ts.__String } | undefined {
	if (ts.isExportSpecifier(declaration)) {
		const moduleSpecifier = declaration.parent.parent.moduleSpecifier;
		return moduleSpecifier
			? { moduleSpecifier, exportName: getSpecifierExportName(declaration) }
			: undefined;
	}

	if (ts.isImportSpecifier(declaration)) {
		return {
			moduleSpecifier: declaration.parent.parent.parent.moduleSpecifier,
			exportName: getSpecifierExportName(declaration),
		};
	}

	if (ts.isImportClause(declaration)) {
		return {
			moduleSpecifier: declaration.parent.moduleSpecifier,
			exportName: ts.escapeLeadingUnderscores('default'),
		};
	}

	return undefined;
}

function getSpecifierExportName(specifier: ts.ImportOrExportSpecifier): ts.__String {
	return ts.escapeLeadingUnderscores((specifier.propertyName ?? specifier.name).text);
}

const valueStarExportTargetsByChecker = new WeakMap<
	ts.TypeChecker,
	WeakMap<ts.Symbol, ts.Symbol[]>
>();

/**
 * The modules a container re-exports with a plain `export * from`, resolved
 * once per container: every export of a barrel is walked through the same ones.
 */
function getValueStarExportTargets(
	containerSymbol: ts.Symbol,
	checker: ts.TypeChecker,
): ts.Symbol[] {
	let targetsByContainer = valueStarExportTargetsByChecker.get(checker);
	if (!targetsByContainer) {
		targetsByContainer = new WeakMap();
		valueStarExportTargetsByChecker.set(checker, targetsByContainer);
	}

	let targets = targetsByContainer.get(containerSymbol);
	if (!targets) {
		targets = (containerSymbol.declarations ?? []).flatMap((declaration) =>
			getContainerStatements(declaration).flatMap((statement) => {
				if (
					!ts.isExportDeclaration(statement) ||
					statement.exportClause ||
					statement.isTypeOnly ||
					!statement.moduleSpecifier
				) {
					return [];
				}

				const targetModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
				return targetModule ? [targetModule] : [];
			}),
		);
		targetsByContainer.set(containerSymbol, targets);
	}

	return targets;
}

function getContainerStatements(declaration: ts.Declaration): readonly ts.Statement[] {
	if (ts.isSourceFile(declaration)) {
		return declaration.statements;
	}

	return ts.isModuleDeclaration(declaration) &&
		declaration.body &&
		ts.isModuleBlock(declaration.body)
		? declaration.body.statements
		: [];
}
