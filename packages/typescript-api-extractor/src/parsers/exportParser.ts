import ts from 'typescript';
import { ExportNode, TypeName, withTypeName, type AnyType } from '../models';
import { ParserError } from '../ParserError';
import { type ScopedParserContext } from '../parserContext';
import { isInternalSymbolName } from './common';
import { getDocumentationFromSymbol } from './documentationParser';
import { type ExportDescriptor, resolveExportDescriptors } from './exportDescriptors';
import { resolveType } from './typeResolver';

/**
 * Converts one TypeScript module export symbol into output `ExportNode`s.
 *
 * Example: `export { ComponentRoot as Root }` becomes a descriptor for `Root`
 * plus descriptors for merged namespace members such as `Root.Props`.
 */
export function parseExport(
	exportSymbol: ts.Symbol,
	parserContext: ScopedParserContext,
	parentNamespaces: string[] = [],
	containerSymbol?: ts.Symbol,
): ExportNode[] | undefined {
	const descriptors = resolveExportDescriptors(exportSymbol, parserContext, {
		parentNamespaces,
		containerSymbol,
	});
	if (!descriptors) {
		return;
	}

	const nodesByDescriptor = new Map<ExportDescriptor, ExportNode[] | undefined>();
	for (const descriptor of getTypeResolutionOrderedDescriptors(descriptors)) {
		nodesByDescriptor.set(descriptor, createExportNodesFromDescriptor(descriptor, parserContext));
	}

	// Descriptor order is the emitted API order. Type-resolution order is kept
	// separate because merged namespace members historically resolved before
	// their owner export, and TypeScript's lazy type/cache behavior can make that
	// observable in authored union member order.
	const exports = descriptors.flatMap((descriptor) => nodesByDescriptor.get(descriptor) ?? []);

	return exports.length > 0 ? exports : undefined;
}

/**
 * Returns descriptors in the order that should trigger type resolution.
 *
 * Example: a merged `Root` export emits as `Root`, `Root.Props`, but resolves
 * `Root.Props` first to match the pre-descriptor parser's recursive traversal.
 */
function getTypeResolutionOrderedDescriptors(descriptors: ExportDescriptor[]): ExportDescriptor[] {
	return [...descriptors].sort(
		(left, right) => left.typeResolutionOrder - right.typeResolutionOrder,
	);
}

/**
 * Builds the final output node for a normalized export descriptor.
 *
 * Example: a `Props` descriptor under parent namespace `Root` becomes an
 * `ExportNode` named `Root.Props`.
 */
function createExportNodesFromDescriptor(
	descriptor: ExportDescriptor,
	parserContext: ScopedParserContext,
): ExportNode[] | undefined {
	return runWithSymbolScopes(parserContext, descriptor.symbolScope, () => {
		try {
			const sourceNode = descriptor.typeNode ?? descriptor.symbol.declarations?.[0];

			return parserContext.runWithSourceNodeScope(sourceNode, () => {
				let parsedType = resolveType(descriptor.getType(), descriptor.typeNode, parserContext);
				if (!parsedType) {
					return;
				}

				parsedType = applyExportTypeNameContext(parsedType, descriptor);
				const exportName =
					descriptor.parentNamespaces.length > 0
						? [...descriptor.parentNamespaces, descriptor.name].join('.')
						: descriptor.name;

				return [
					new ExportNode(
						exportName,
						parsedType,
						getDocumentationFromSymbol(descriptor.symbol, parserContext.checker),
						descriptor.declarationSpaces,
						descriptor.reexportedFrom,
						descriptor.extendsTypes,
					),
				];
			});
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, parserContext.parsedSymbolStack);
			}

			throw error;
		}
	});
}

/**
 * Applies public export naming to resolved type nodes without re-resolving them.
 *
 * Example: `export * as Component` should expose `Component.Root`, even if the
 * underlying declaration was originally named `ComponentRoot`.
 */
function applyExportTypeNameContext<T extends AnyType>(
	parsedType: T,
	descriptor: ExportDescriptor,
): T {
	if (!('typeName' in parsedType)) {
		return parsedType;
	}

	let typeName = (parsedType as { typeName: TypeName | undefined }).typeName;
	let typeNameChanged = false;

	// Fix type names for resolved anonymous/internal symbols. Re-exported aliases
	// can otherwise lose their authored export name and surface as `__type`.
	if (typeName?.name != null && isInternalSymbolName(typeName.name)) {
		typeName = new TypeName(descriptor.name, typeName.namespaces, typeName.typeArguments);
		typeNameChanged = true;
	}

	// Namespace exports define a new public reference path, so the exported node
	// should use the namespace context even when the underlying type came from
	// another module or declaration name.
	if (descriptor.parentNamespaces.length > 0) {
		// Apply namespace context after anonymous-name repair. The old sequential
		// export parser first replaced `__type` with the public member name and
		// then overwrote the namespace, so `export * as NS` exposed `NS.member`
		// even for anonymous external object declarations.
		typeName = new TypeName(descriptor.name, descriptor.parentNamespaces, typeName?.typeArguments);
		typeNameChanged = true;
	}

	return typeNameChanged && typeName ? withTypeName(parsedType, typeName) : parsedType;
}

/**
 * Replays the descriptor's symbol stack around output-node construction.
 *
 * Example: a namespace member descriptor with scope `['Root', 'Props']` pushes
 * both entries while type-resolution warnings are produced.
 */
function runWithSymbolScopes<T>(
	parserContext: ScopedParserContext,
	symbolScope: string[],
	callback: () => T,
): T {
	const [symbolName, ...remainingSymbolScope] = symbolScope;
	if (!symbolName) {
		return callback();
	}

	return parserContext.runWithSymbolScope(symbolName, () =>
		runWithSymbolScopes(parserContext, remainingSymbolScope, callback),
	);
}
