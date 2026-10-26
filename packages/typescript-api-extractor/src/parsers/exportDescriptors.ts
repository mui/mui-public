import ts from 'typescript';
import { getDeclarationSpaces } from './declarationSpaces';
import { getExportReach } from './exportValuePaths';
import { type ScopedParserContext } from '../parserContext';
import { ParserError } from '../ParserError';
import { type DeclarationSpaces, type ExtendsTypeInfo } from '../models';
import { isInternalSymbolName } from './common';
import { declarationHasNodeModulesPathSegment } from './sourceFileUtils';
import { analyzeTypeAliasSource } from './typeResolvers/authoredTypeAlias';

interface ExportDescriptorResolutionState {
	nextTypeResolutionOrder: number;
}

/**
 * Threaded context shared by every descriptor resolver. `context` and
 * `resolutionState` stay stable for a whole top-level resolution, while
 * `parentNamespaces` and `symbolScope` grow as the resolver descends into
 * namespace members. Bundling them keeps the recursive call sites from
 * threading the same four positional arguments through every helper.
 */
interface ExportDescriptorScope {
	context: ScopedParserContext;
	parentNamespaces: string[];
	symbolScope: string[];
	resolutionState: ExportDescriptorResolutionState;
}

/**
 * Normalized description of one exported API surface before it is converted to
 * an `ExportNode`. Keeping this shape separate from model construction lets
 * export-target resolution, namespace merging, re-export metadata, and warning
 * emission stay testable without also running the full type resolver.
 */
export interface ExportDescriptor {
	/** Public export name for this descriptor, without parent namespace prefixes. */
	name: string;
	/** Target symbol used for documentation and final type resolution. */
	symbol: ts.Symbol;
	/**
	 * Lazily acquires the TypeScript type when this descriptor is converted into
	 * an `ExportNode`. This is deliberately not evaluated during normalization:
	 * `checker.getTypeAtLocation` mutates TypeScript's lazy internal caches, and
	 * batched upfront type queries can change observable union/property order.
	 *
	 * @returns The semantic type owned by this descriptor's target declaration.
	 */
	getType: () => ts.Type;
	/** Public namespace path applied when this descriptor came from a namespace export. */
	parentNamespaces: string[];
	/**
	 * Order used when descriptors are converted into `ExportNode`s and their types
	 * are resolved. This can differ from output order: merged namespace members are
	 * resolved before their owner export to preserve the legacy TypeScript/cache
	 * side effects that keep authored union member order stable.
	 */
	typeResolutionOrder: number;
	/** Symbol scopes replayed while converting the descriptor into warning-aware output nodes. */
	symbolScope: string[];
	/** Authored type node, when it affects alias or union preservation during type resolution. */
	typeNode?: ts.TypeNode;
	/**
	 * Declaration spaces of the export, read from its export symbol so that
	 * declarations merged onto a re-export count along with the target's, and
	 * with the value space masked when the export is reached only as a type.
	 */
	declarationSpaces: DeclarationSpaces;
	/** Original exported name when the public descriptor is a renamed re-export. */
	reexportedFrom?: string;
	/** Interface or class heritage metadata attached to the export. */
	extendsTypes?: ExtendsTypeInfo[];
}

/** A descriptor before its declaration spaces are attached. */
type ExportDescriptorDraft = Omit<ExportDescriptor, 'declarationSpaces'>;

/**
 * Where an export sits while its descriptors are resolved.
 */
export interface ExportDescriptorOptions {
	/** Namespace path inherited from enclosing namespace exports, prefixed onto the public name. */
	parentNamespaces?: string[];
	/** Symbol-stack entries from enclosing exports, extended with this symbol's name for warning metadata. */
	parentSymbolScope?: string[];
	/** Mutable counter shared across one top-level resolution that assigns each descriptor its type-resolution order. */
	resolutionState?: ExportDescriptorResolutionState;
	/**
	 * The module or namespace listing the export, which decides whether it is reached
	 * as a value, as a type only, or not at all. Without it, only the export symbol's
	 * own alias chain is considered.
	 */
	containerSymbol?: ts.Symbol;
}

/**
 * Normalizes one TypeScript export symbol into descriptor records.
 *
 * Example: `export namespace Dialog { export type Props = ... }` returns
 * descriptors for the namespace members rather than an output node for the
 * namespace declaration itself.
 *
 * @param exportSymbol Module-level export symbol being normalized; its name becomes the public descriptor name.
 * @param context Parser context providing the TypeScript checker and scope helpers.
 * @param options Where the export sits; see {@link ExportDescriptorOptions}.
 * @returns One or more normalized descriptors, or `undefined` when the symbol has no extractable declaration or reaches its container only as a value that type-only sites strip.
 */
export function resolveExportDescriptors(
	exportSymbol: ts.Symbol,
	context: ScopedParserContext,
	{
		parentNamespaces = [],
		parentSymbolScope = [],
		resolutionState = { nextTypeResolutionOrder: 0 },
		containerSymbol,
	}: ExportDescriptorOptions = {},
): ExportDescriptor[] | undefined {
	return context.runWithSymbolScope(exportSymbol.name, () => {
		try {
			const reach = getExportReach(exportSymbol, containerSymbol, context.checker);
			if (reach === 'hidden') {
				return;
			}

			const scope: ExportDescriptorScope = {
				context,
				parentNamespaces,
				symbolScope: [...parentSymbolScope, exportSymbol.name],
				resolutionState,
			};

			const declarations = exportSymbol.declarations;
			if (!declarations || declarations.length === 0) {
				return;
			}

			const exportDeclaration = declarations[0];
			const namespaceDescriptors = resolveMergedNamespaceDescriptors(
				exportSymbol,
				exportSymbol.name,
				scope,
			);

			let descriptors: ExportDescriptor[] | undefined;
			if (ts.isModuleDeclaration(exportDeclaration)) {
				descriptors = asNonEmptyDescriptors(namespaceDescriptors);
			} else if (ts.isNamespaceExport(exportDeclaration)) {
				descriptors = resolveNamespaceExportDescriptors(exportSymbol, scope);
			} else if (ts.isExportSpecifier(exportDeclaration)) {
				descriptors = resolveExportSpecifierDescriptors(
					exportSymbol,
					exportDeclaration,
					scope,
					namespaceDescriptors,
				);
			} else {
				descriptors = withNamespaceDescriptors(
					withDeclarationSpaces(
						resolveDeclarationExportDescriptor(exportSymbol, exportDeclaration, scope),
						exportSymbol,
						context.checker,
					),
					namespaceDescriptors,
				);
			}

			// The members of a namespace merged onto a type-only export are type-only too.
			return withTypeOnlyExport(descriptors, reach === 'typeOnly');
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}

/**
 * Handles `export * as Name from './module'` namespace re-exports.
 *
 * Example: `export * as Component from './parts'` gives every member from
 * `./parts` the parent namespace `Component`.
 *
 * @param exportSymbol The `export * as Name` alias symbol.
 * @param scope Current resolution scope (checker/scope helpers, namespace path, symbol scope, order counter).
 */
function resolveNamespaceExportDescriptors(
	exportSymbol: ts.Symbol,
	scope: ExportDescriptorScope,
): ExportDescriptor[] | undefined {
	const aliasedSymbol = scope.context.checker.getAliasedSymbol(exportSymbol);
	if (!aliasedSymbol) {
		return;
	}

	return asNonEmptyDescriptors(
		resolveNamespaceMemberDescriptors(aliasedSymbol, exportSymbol.name, scope),
	);
}

/**
 * Handles named export specifiers, including aliases and re-exports.
 *
 * Example: `export { ComponentRoot as Root } from './root'` targets the
 * `ComponentRoot` symbol, records `reexportedFrom: 'ComponentRoot'`, and keeps
 * the public descriptor name `Root`.
 *
 * @param exportSymbol The export specifier's public symbol (the `as` name).
 * @param exportDeclaration The export specifier declaration being normalized.
 * @param scope Current resolution scope.
 * @param namespaceDescriptors Descriptors already collected for namespaces merged onto this symbol.
 */
function resolveExportSpecifierDescriptors(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ExportSpecifier,
	scope: ExportDescriptorScope,
	namespaceDescriptors: ExportDescriptor[],
): ExportDescriptor[] | undefined {
	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const targetSymbol = resolveExportSpecifierTarget(exportSymbol, exportDeclaration, context);
	if (!targetSymbol) {
		return withNamespaceDescriptors(undefined, namespaceDescriptors);
	}

	const targetNamespaceDescriptors = resolveMergedNamespaceDescriptors(
		targetSymbol,
		exportSymbol.name,
		scope,
	);
	const isReExport = isModuleReExportSpecifier(exportDeclaration);
	const reexportedFrom =
		isReExport && targetSymbol.name !== exportSymbol.name ? targetSymbol.name : undefined;
	const targetTypeAlias = findAliasedTypeAliasDeclaration(targetSymbol, context.checker);
	const targetTypeNode = targetTypeAlias?.type;
	return withNamespaceDescriptors(
		{
			name: exportSymbol.name,
			symbol: targetSymbol,
			declarationSpaces: getDeclarationSpaces(exportSymbol, context.checker),
			getType: () => getExportSpecifierType(targetSymbol, exportDeclaration, context),
			parentNamespaces,
			typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
			symbolScope,
			reexportedFrom,
			typeNode:
				targetTypeAlias &&
				shouldPreserveTypeAliasNode(targetTypeAlias, reexportedFrom, context.includeExternalTypes)
					? targetTypeNode
					: undefined,
		},
		[...namespaceDescriptors, ...targetNamespaceDescriptors],
	);
}

function shouldPreserveTypeAliasNode(
	declaration: ts.TypeAliasDeclaration,
	reexportedFrom: string | undefined,
	includeExternalTypes: boolean,
): boolean {
	const isExternal = declarationHasNodeModulesPathSegment(declaration);
	if (isExternal && !reexportedFrom) {
		return true;
	}

	const analysis = analyzeTypeAliasSource(declaration, includeExternalTypes);
	return (
		(isExternal && analysis.replaysKeyof) ||
		analysis.referencesProjectImport ||
		analysis.containsKeyof
	);
}

function findAliasedTypeAliasDeclaration(
	symbol: ts.Symbol,
	checker: ts.TypeChecker,
	seen: Set<ts.Symbol> = new Set(),
): ts.TypeAliasDeclaration | undefined {
	if (seen.has(symbol)) {
		return undefined;
	}
	seen.add(symbol);

	const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
	if (declaration) {
		return declaration;
	}

	if (!(symbol.flags & ts.SymbolFlags.Alias)) {
		return undefined;
	}

	const aliasedSymbol = checker.getAliasedSymbol(symbol);
	return aliasedSymbol && aliasedSymbol !== symbol
		? findAliasedTypeAliasDeclaration(aliasedSymbol, checker, seen)
		: undefined;
}

/**
 * Dispatches concrete declaration kinds to the descriptor builder that knows
 * how to acquire their symbol and type.
 *
 * Example: `export interface Props {}` is routed to the interface builder,
 * while `export type Mode = 'a' | 'b'` is routed to the type-alias builder.
 *
 * @param exportSymbol The export symbol being normalized.
 * @param exportDeclaration The symbol's primary declaration, used to pick the matching builder.
 * @param scope Current resolution scope.
 */
function resolveDeclarationExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.Declaration,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	if (ts.isExportAssignment(exportDeclaration)) {
		return resolveDefaultExportDescriptor(exportSymbol, exportDeclaration, scope);
	}

	if (ts.isVariableDeclaration(exportDeclaration) || ts.isFunctionDeclaration(exportDeclaration)) {
		return resolveValueExportDescriptor(exportSymbol, exportDeclaration, scope);
	}

	if (ts.isInterfaceDeclaration(exportDeclaration)) {
		return resolveInterfaceExportDescriptor(exportSymbol, exportDeclaration, scope);
	}

	if (ts.isEnumDeclaration(exportDeclaration)) {
		return resolveEnumExportDescriptor(exportSymbol, exportDeclaration, scope);
	}

	if (ts.isClassDeclaration(exportDeclaration)) {
		return resolveClassExportDescriptor(exportSymbol, exportDeclaration, scope);
	}

	if (ts.isTypeAliasDeclaration(exportDeclaration)) {
		return resolveTypeAliasExportDescriptor(exportSymbol, exportDeclaration, scope);
	}
}

/**
 * Handles `export default value` assignments.
 *
 * Example: `export default Button` resolves the symbol at `Button` and emits a
 * descriptor using the compiler's synthetic default export name.
 *
 * @param exportSymbol The synthetic default export symbol.
 * @param exportDeclaration The `export default` assignment.
 * @param scope Current resolution scope.
 */
function resolveDefaultExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ExportAssignment,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.expression);
	if (!exportedSymbol) {
		warnMissingDefaultExportSymbol(exportDeclaration, context);
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		getType: () => context.checker.getTypeOfSymbol(exportedSymbol),
		parentNamespaces,
		typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
		symbolScope,
	};
}

/**
 * Handles value declarations exported directly from the module.
 *
 * Example: `export const useThing = ...` and `export function useThing() {}`
 * both resolve their declaration name and use `getTypeOfSymbol`.
 *
 * @param exportSymbol The export symbol being normalized.
 * @param exportDeclaration The exported variable or function declaration.
 * @param scope Current resolution scope.
 */
function resolveValueExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.VariableDeclaration | ts.FunctionDeclaration,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	if (!exportDeclaration.name) {
		return;
	}

	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		getType: () => context.checker.getTypeOfSymbol(exportedSymbol),
		parentNamespaces,
		typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
		symbolScope,
	};
}

/**
 * Handles interface declarations and records explicit `extends` metadata.
 *
 * Example: `export interface AlertProps extends Dialog.Props {}` keeps
 * `extendsTypes` so consumers can see the authored inheritance relationship.
 *
 * @param exportSymbol The export symbol being normalized.
 * @param exportDeclaration The interface declaration whose heritage clauses supply `extends` metadata.
 * @param scope Current resolution scope.
 */
function resolveInterfaceExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.InterfaceDeclaration,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		getType: () => context.checker.getTypeAtLocation(exportDeclaration),
		parentNamespaces,
		typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
		symbolScope,
		extendsTypes: extractExtendsTypes(exportDeclaration.heritageClauses, context.checker),
	};
}

/**
 * Handles enum declarations and emits the missing-enum warning when TypeScript
 * reports an enum symbol without a usable declaration.
 *
 * Example: `export enum Side { Start }` resolves through the enum declaration
 * before model construction.
 *
 * @param exportSymbol The export symbol being normalized.
 * @param exportDeclaration The enum declaration.
 * @param scope Current resolution scope.
 */
function resolveEnumExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.EnumDeclaration,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	const enumDeclaration = exportedSymbol.declarations?.[0];
	if (!enumDeclaration) {
		warnMissingEnumDeclaration(exportedSymbol, exportDeclaration, context);
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		getType: () => context.checker.getTypeAtLocation(enumDeclaration),
		parentNamespaces,
		typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
		symbolScope,
	};
}

/**
 * Handles class declarations as constructor types rather than instance types.
 *
 * Example: `export class Dialog {}` uses `getTypeOfSymbol` so construct
 * signatures are available to the class resolver.
 *
 * @param exportSymbol The export symbol being normalized.
 * @param exportDeclaration The class declaration, resolved as a constructor type.
 * @param scope Current resolution scope.
 */
function resolveClassExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ClassDeclaration,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	if (!exportDeclaration.name) {
		return;
	}

	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		getType: () => context.checker.getTypeOfSymbol(exportedSymbol),
		parentNamespaces,
		typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
		symbolScope,
	};
}

/**
 * Handles type aliases and preserves the authored type node for resolution.
 *
 * Example: `export type Value = 'a' | 'b'` stores the union syntax node so the
 * type resolver can preserve authored union structure and aliases.
 *
 * @param exportSymbol The export symbol being normalized.
 * @param exportDeclaration The type-alias declaration whose `type` node is preserved for resolution.
 * @param scope Current resolution scope.
 */
function resolveTypeAliasExportDescriptor(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.TypeAliasDeclaration,
	scope: ExportDescriptorScope,
): ExportDescriptorDraft | undefined {
	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const exportedSymbol = context.checker.getSymbolAtLocation(exportDeclaration.name);
	if (!exportedSymbol) {
		return;
	}

	return {
		name: exportSymbol.name,
		symbol: exportedSymbol,
		getType: () => context.checker.getTypeAtLocation(exportDeclaration),
		parentNamespaces,
		typeResolutionOrder: getNextTypeResolutionOrder(resolutionState),
		symbolScope,
		typeNode: exportDeclaration.type,
	};
}

/**
 * Resolves the symbol an export specifier ultimately targets, following module
 * re-export aliases when the specifier comes from another module.
 *
 * @param exportSymbol The export specifier's public symbol.
 * @param exportDeclaration The export specifier declaration.
 * @param context Parser context providing the TypeScript checker.
 */
function resolveExportSpecifierTarget(
	exportSymbol: ts.Symbol,
	exportDeclaration: ts.ExportSpecifier,
	context: ScopedParserContext,
): ts.Symbol | undefined {
	if (!isModuleReExportSpecifier(exportDeclaration)) {
		return context.checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
	}

	const aliasedSymbol = context.checker.getAliasedSymbol(exportSymbol);
	return aliasedSymbol && aliasedSymbol !== exportSymbol
		? aliasedSymbol
		: context.checker.getExportSpecifierLocalTargetSymbol(exportDeclaration);
}

/**
 * Acquires the TypeScript type for an export specifier target, preferring the
 * constructor type for classes and following import aliases to their source.
 *
 * @param targetSymbol The symbol the specifier targets.
 * @param exportDeclaration The export specifier declaration.
 * @param context Parser context providing the TypeScript checker.
 */
function getExportSpecifierType(
	targetSymbol: ts.Symbol,
	exportDeclaration: ts.ExportSpecifier,
	context: ScopedParserContext,
): ts.Type {
	const targetDeclaration = targetSymbol.declarations?.[0];
	if (targetDeclaration && ts.isImportSpecifier(targetDeclaration)) {
		const resolvedSymbol = context.checker.getAliasedSymbol(targetSymbol);
		const resolvedDeclaration = resolvedSymbol?.declarations?.[0];
		if (
			resolvedDeclaration &&
			(ts.isClassDeclaration(resolvedDeclaration) || ts.isClassExpression(resolvedDeclaration))
		) {
			return context.checker.getTypeOfSymbol(resolvedSymbol);
		}

		return context.checker.getTypeAtLocation(exportDeclaration);
	}

	if (
		targetDeclaration &&
		(ts.isClassDeclaration(targetDeclaration) || ts.isClassExpression(targetDeclaration))
	) {
		return context.checker.getTypeOfSymbol(targetSymbol);
	}

	if (targetDeclaration) {
		return context.checker.getTypeAtLocation(targetDeclaration);
	}

	return context.checker.getTypeOfSymbol(targetSymbol);
}

/**
 * Collects descriptors for any namespace (module) declarations merged onto a
 * symbol, such as a function or class that also declares a namespace.
 *
 * @param namespaceOwnerSymbol Symbol whose declarations may include namespace declarations.
 * @param namespaceExportName Public name under which the merged members are exposed.
 * @param scope Current resolution scope.
 */
function resolveMergedNamespaceDescriptors(
	namespaceOwnerSymbol: ts.Symbol,
	namespaceExportName: string,
	scope: ExportDescriptorScope,
): ExportDescriptor[] {
	const namespaceDescriptors: ExportDescriptor[] = [];
	const declarations = namespaceOwnerSymbol.declarations;
	if (!declarations) {
		return namespaceDescriptors;
	}

	for (const declaration of declarations) {
		if (!ts.isModuleDeclaration(declaration)) {
			continue;
		}

		const namespaceSymbol = scope.context.checker.getSymbolAtLocation(declaration.name);
		if (!namespaceSymbol) {
			continue;
		}

		namespaceDescriptors.push(
			...resolveNamespaceMemberDescriptors(namespaceSymbol, namespaceExportName, scope),
		);
	}

	return namespaceDescriptors;
}

/**
 * Normalizes every member exported from a namespace symbol, prepending the
 * namespace name onto each member's namespace path.
 *
 * @param namespaceSymbol Namespace symbol whose module exports become member descriptors.
 * @param namespaceExportName Public name prepended to each member's namespace path.
 * @param scope Current resolution scope.
 */
function resolveNamespaceMemberDescriptors(
	namespaceSymbol: ts.Symbol,
	namespaceExportName: string,
	scope: ExportDescriptorScope,
): ExportDescriptor[] {
	const { context, parentNamespaces, symbolScope, resolutionState } = scope;
	const namespaceMembers = context.checker.getExportsOfModule(namespaceSymbol);
	const descriptors: ExportDescriptor[] = [];

	for (const member of namespaceMembers) {
		const memberDescriptors = resolveExportDescriptors(member, context, {
			parentNamespaces: [...parentNamespaces, namespaceExportName],
			parentSymbolScope: symbolScope,
			resolutionState,
			containerSymbol: namespaceSymbol,
		});
		if (memberDescriptors) {
			descriptors.push(...memberDescriptors);
		}
	}

	return descriptors;
}

/**
 * Returns the next type-resolution order value and advances the shared counter.
 *
 * @param state Shared resolution state holding the next order value.
 */
function getNextTypeResolutionOrder(state: ExportDescriptorResolutionState): number {
	return state.nextTypeResolutionOrder++;
}

/**
 * Combines an owner descriptor with its merged namespace descriptors, returning
 * undefined when nothing was produced.
 *
 * @param mainDescriptor The owner export's descriptor, if one was produced.
 * @param namespaceDescriptors Descriptors collected for merged namespace members.
 */
function withNamespaceDescriptors(
	mainDescriptor: ExportDescriptor | undefined,
	namespaceDescriptors: ExportDescriptor[],
): ExportDescriptor[] | undefined {
	const descriptors = mainDescriptor
		? [mainDescriptor, ...namespaceDescriptors]
		: namespaceDescriptors;
	return asNonEmptyDescriptors(descriptors);
}

/**
 * Returns the descriptor list, or undefined when it is empty.
 *
 * @param descriptors Candidate descriptor list.
 */
function asNonEmptyDescriptors(descriptors: ExportDescriptor[]): ExportDescriptor[] | undefined {
	return descriptors.length > 0 ? descriptors : undefined;
}

/**
 * Completes a draft with the declaration spaces of its export symbol.
 *
 * @param draft The descriptor draft, if one was produced.
 * @param exportSymbol The export symbol the spaces are read from.
 * @param checker Type checker for walking the export symbol's alias chain.
 */
function withDeclarationSpaces(
	draft: ExportDescriptorDraft | undefined,
	exportSymbol: ts.Symbol,
	checker: ts.TypeChecker,
): ExportDescriptor | undefined {
	return draft && { ...draft, declarationSpaces: getDeclarationSpaces(exportSymbol, checker) };
}

/**
 * Masks the value space of every descriptor reached only through type-only sites,
 * which strip the runtime binding. Returns the list unchanged otherwise.
 *
 * @param descriptors Descriptors produced for one export.
 * @param isTypeOnlyExport Whether the export is reached only through type-only sites.
 */
function withTypeOnlyExport(
	descriptors: ExportDescriptor[] | undefined,
	isTypeOnlyExport: boolean,
): ExportDescriptor[] | undefined {
	return isTypeOnlyExport
		? descriptors?.map((descriptor) => ({
				...descriptor,
				declarationSpaces: { ...descriptor.declarationSpaces, isValue: false },
			}))
		: descriptors;
}

/**
 * Returns whether an export specifier re-exports from another module
 * (`export { x } from './other'`) rather than re-exporting a local binding.
 *
 * @param exportDeclaration The export specifier declaration.
 */
function isModuleReExportSpecifier(exportDeclaration: ts.ExportSpecifier): boolean {
	return (
		ts.isExportDeclaration(exportDeclaration.parent.parent) &&
		exportDeclaration.parent.parent.moduleSpecifier !== undefined
	);
}

/**
 * Emits the recoverable warning for an enum symbol that has no usable
 * declaration, so the export can be skipped without aborting parsing.
 *
 * @param exportedSymbol The enum symbol missing a declaration.
 * @param exportDeclaration The enum declaration providing the warning location.
 * @param context Parser context used to format and dispatch the warning.
 */
function warnMissingEnumDeclaration(
	exportedSymbol: ts.Symbol,
	exportDeclaration: ts.EnumDeclaration,
	context: ScopedParserContext,
): void {
	const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
		exportDeclaration.getStart(context.sourceFile),
	);

	context.onWarning({
		code: 'missing-enum-declaration',
		message: `Type extraction warning: Could not find the declaration of enum "${exportedSymbol.name}" at "${context.sourceFile.fileName}:${line + 1}:${character + 1}". Skipping this export.`,
		filePath: context.sourceFile.fileName,
		line: line + 1,
		column: character + 1,
		parsedSymbolStack: [...context.parsedSymbolStack],
		enumName: exportedSymbol.name,
	});
}

/**
 * Emits the recoverable warning for a default export whose expression has no
 * resolvable symbol, so the export can be skipped without aborting parsing.
 *
 * @param exportDeclaration The `export default` assignment providing the warning location.
 * @param context Parser context used to format and dispatch the warning.
 */
function warnMissingDefaultExportSymbol(
	exportDeclaration: ts.ExportAssignment,
	context: ScopedParserContext,
): void {
	const expression = exportDeclaration.expression;
	const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
		expression.getStart(context.sourceFile),
	);
	const sourceText = expression.getText(context.sourceFile);

	context.onWarning({
		code: 'missing-default-export-symbol',
		message: `Type extraction warning: Could not find the symbol of default export "${sourceText}" at "${context.sourceFile.fileName}:${line + 1}:${character + 1}". Skipping this export.`,
		filePath: context.sourceFile.fileName,
		line: line + 1,
		column: character + 1,
		parsedSymbolStack: [...context.parsedSymbolStack],
		sourceText,
	});
}

/**
 * Extracts the type names from extends/implements clauses.
 * e.g., `interface X extends A, B.C` returns info for each extended type
 *
 * For utility types like Omit, Pick, Partial, etc., extracts the first type argument
 * as the base type being extended.
 *
 * @param heritageClauses The declaration's heritage clauses, or undefined when it has none.
 * @param checker TypeScript checker used to resolve extended type symbols.
 */
function extractExtendsTypes(
	heritageClauses: ts.NodeArray<ts.HeritageClause> | undefined,
	checker: ts.TypeChecker,
): ExtendsTypeInfo[] | undefined {
	if (!heritageClauses) {
		return undefined;
	}

	// Utility types where the first type argument is the base type
	const utilityTypes = new Set(['Omit', 'Pick', 'Partial', 'Required', 'Readonly']);

	const extendsTypes: ExtendsTypeInfo[] = [];
	for (const clause of heritageClauses) {
		// Only process 'extends' clauses (SyntaxKind.ExtendsKeyword)
		// Skip 'implements' clauses for now
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
			continue;
		}

		for (const typeExpr of clause.types) {
			const baseTypeName = typeExpr.expression.getText();

			// Check if this is a utility type wrapping another type
			// e.g., Omit<DialogRoot.Props, 'modal'> -> extract DialogRoot.Props
			if (
				utilityTypes.has(baseTypeName) &&
				typeExpr.typeArguments &&
				typeExpr.typeArguments.length > 0
			) {
				const firstTypeArg = typeExpr.typeArguments[0];
				// Get the base type name from the first type argument (without its own type arguments)
				const innerTypeName = ts.isTypeReferenceNode(firstTypeArg)
					? firstTypeArg.typeName.getText()
					: firstTypeArg.getText();

				// Try to resolve the actual symbol, following type alias chains
				const type = checker.getTypeAtLocation(firstTypeArg);
				const symbol = resolveUnderlyingSymbol(type, checker);
				const resolvedName = symbol?.name;

				const info: ExtendsTypeInfo = { name: innerTypeName };
				if (resolvedName && resolvedName !== innerTypeName && !isInternalSymbolName(resolvedName)) {
					info.resolvedName = resolvedName;
				}

				extendsTypes.push(info);
			} else {
				// Regular extends clause
				const type = checker.getTypeAtLocation(typeExpr);
				const symbol = resolveUnderlyingSymbol(type, checker);
				const resolvedName = symbol?.name;

				const info: ExtendsTypeInfo = { name: baseTypeName };
				if (resolvedName && resolvedName !== baseTypeName && !isInternalSymbolName(resolvedName)) {
					info.resolvedName = resolvedName;
				}

				extendsTypes.push(info);
			}
		}
	}

	return extendsTypes.length > 0 ? extendsTypes : undefined;
}

/**
 * Resolves the underlying symbol for a type, following type alias chains.
 * For generic type aliases like `type Props<T> = DialogProps<T>`, this returns
 * the symbol for `DialogProps` rather than `Props`.
 *
 * @param type The type whose underlying alias symbol is resolved.
 * @param checker TypeScript checker used to follow alias chains.
 */
function resolveUnderlyingSymbol(type: ts.Type, checker: ts.TypeChecker): ts.Symbol | undefined {
	const symbol = type.aliasSymbol ?? type.symbol;

	if (!symbol) {
		return undefined;
	}

	// For type aliases, follow the chain to find the underlying type
	// This handles generic type aliases like `type Props<T> = DialogProps<T>`
	const aliasDecl = symbol.declarations?.[0];
	if (aliasDecl && ts.isTypeAliasDeclaration(aliasDecl) && ts.isTypeReferenceNode(aliasDecl.type)) {
		// Get the symbol from the type reference name, not from the resolved type
		// This preserves the alias chain for generic types
		const targetTypeName = aliasDecl.type.typeName;
		const targetSymbol = checker.getSymbolAtLocation(targetTypeName);

		if (targetSymbol && !isInternalSymbolName(targetSymbol.name) && targetSymbol !== symbol) {
			// Check if the target is also a type alias - if so, recurse
			const targetDecl = targetSymbol.declarations?.[0];
			if (targetDecl && ts.isTypeAliasDeclaration(targetDecl)) {
				const targetType = checker.getDeclaredTypeOfSymbol(targetSymbol);
				const deeperSymbol = resolveUnderlyingSymbol(targetType, checker);
				if (deeperSymbol && deeperSymbol !== targetSymbol) {
					return deeperSymbol;
				}
			}
			return targetSymbol;
		}
	}

	return symbol;
}
