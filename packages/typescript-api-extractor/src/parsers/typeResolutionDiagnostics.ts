import ts from 'typescript';
import { type ParserContext } from '../parser';
import { hasExactFlag } from './typeResolutionUtils';

/**
 * Emits a structured warning when a TypeScript type shape cannot be represented
 * by the public model. Location selection is centralized here so all fallback
 * paths report the most precise source node available.
 */
export function reportUnsupportedTypeFallback(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
) {
	const location = getWarningLocation(type, typeNode, context);
	const typeFlags = getTypeFlagNames(type.flags);
	const formattedTypeFlags = typeFlags.join(' | ');
	const typeText = getWarningTypeText(type, context);
	const sourceText = getWarningSourceText(location.node);
	const resolvingText =
		sourceText && sourceText !== typeText ? ` while resolving "${sourceText}"` : '';

	context.onWarning({
		code: 'unsupported-type-fallback',
		message: `Type extraction warning: Unable to handle type "${typeText}" with flag "${formattedTypeFlags}"${resolvingText} at "${formatWarningLocation(location)}". Using any instead.`,
		filePath: location.filePath,
		line: location.line,
		column: location.column,
		parsedSymbolStack: [...context.parsedSymbolStack],
		typeFlags,
		typeText,
		sourceText,
	});
}

interface WarningLocation {
	filePath: string;
	line: number;
	column: number;
	node: ts.Node;
}

function getWarningLocation(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): WarningLocation {
	const node = getWarningNode(type, typeNode, context) ?? context.sourceFile;
	const sourceFile = node.getSourceFile();
	const start = node.getStart(sourceFile);
	const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);

	return {
		filePath: sourceFile.fileName,
		line: line + 1,
		column: character + 1,
		node,
	};
}

function getWarningNode(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ParserContext,
): ts.Node | undefined {
	return (
		getSymbolDeclaration(type.aliasSymbol) ??
		getSymbolDeclaration(type.getSymbol()) ??
		typeNode ??
		getCurrentSourceTypeNode(context) ??
		getSubstitutionTypeDeclaration(type) ??
		getCurrentSourceNode(context)
	);
}

function getSubstitutionTypeDeclaration(type: ts.Type): ts.Declaration | undefined {
	if (!hasExactFlag(type, ts.TypeFlags.Substitution)) {
		return undefined;
	}

	const substitutionType = type as ts.SubstitutionType;
	return (
		getSymbolDeclaration(substitutionType.baseType.aliasSymbol) ??
		getSymbolDeclaration(substitutionType.baseType.getSymbol()) ??
		getSymbolDeclaration(substitutionType.constraint.aliasSymbol) ??
		getSymbolDeclaration(substitutionType.constraint.getSymbol())
	);
}

function getCurrentSourceNode(context: ParserContext): ts.Node | undefined {
	return context.sourceNodeStack.at(-1);
}

function getCurrentSourceTypeNode(context: ParserContext): ts.TypeNode | undefined {
	return getTypeNodeFromNode(getCurrentSourceNode(context));
}

function getTypeNodeFromNode(node: ts.Node | undefined): ts.TypeNode | undefined {
	if (!node) {
		return undefined;
	}
	if (ts.isTypeNode(node)) {
		return node;
	}
	if (ts.isTypeAliasDeclaration(node)) {
		return node.type;
	}
	if (ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
		return node.type;
	}
	if (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isMethodSignature(node) ||
		ts.isMethodDeclaration(node)
	) {
		return node.type;
	}

	return undefined;
}

function formatWarningLocation(location: WarningLocation): string {
	return `${location.filePath}:${location.line}:${location.column}`;
}

function getWarningTypeText(type: ts.Type, context: ParserContext): string {
	return truncateWarningText(
		context.checker.typeToString(
			type,
			undefined,
			ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
		),
	);
}

function getWarningSourceText(node: ts.Node | undefined): string | undefined {
	const sourceText = getTypeTextFromNode(node);
	if (!sourceText) {
		return undefined;
	}

	return truncateWarningText(sourceText.replace(/\s+/g, ' ').trim());
}

function getTypeTextFromNode(node: ts.Node | undefined): string | undefined {
	return getTypeNodeFromNode(node)?.getText();
}

function truncateWarningText(text: string): string {
	const maxLength = 160;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}\u2026` : text;
}

function getSymbolDeclaration(symbol: ts.Symbol | undefined): ts.Declaration | undefined {
	return symbol?.declarations?.[0];
}

const typeFlagDisplayOrder: Array<[ts.TypeFlags, string]> = [
	[ts.TypeFlags.Any, 'Any'],
	[ts.TypeFlags.Unknown, 'Unknown'],
	[ts.TypeFlags.Undefined, 'Undefined'],
	[ts.TypeFlags.Null, 'Null'],
	[ts.TypeFlags.Void, 'Void'],
	[ts.TypeFlags.String, 'String'],
	[ts.TypeFlags.Number, 'Number'],
	[ts.TypeFlags.BigInt, 'BigInt'],
	[ts.TypeFlags.Boolean, 'Boolean'],
	[ts.TypeFlags.ESSymbol, 'ESSymbol'],
	[ts.TypeFlags.StringLiteral, 'StringLiteral'],
	[ts.TypeFlags.NumberLiteral, 'NumberLiteral'],
	[ts.TypeFlags.BigIntLiteral, 'BigIntLiteral'],
	[ts.TypeFlags.BooleanLiteral, 'BooleanLiteral'],
	[ts.TypeFlags.UniqueESSymbol, 'UniqueESSymbol'],
	[ts.TypeFlags.EnumLiteral, 'EnumLiteral'],
	[ts.TypeFlags.Enum, 'Enum'],
	[ts.TypeFlags.NonPrimitive, 'NonPrimitive'],
	[ts.TypeFlags.Never, 'Never'],
	[ts.TypeFlags.TypeParameter, 'TypeParameter'],
	[ts.TypeFlags.Object, 'Object'],
	[ts.TypeFlags.Index, 'Index'],
	[ts.TypeFlags.TemplateLiteral, 'TemplateLiteral'],
	[ts.TypeFlags.StringMapping, 'StringMapping'],
	[ts.TypeFlags.Substitution, 'Substitution'],
	[ts.TypeFlags.IndexedAccess, 'IndexedAccess'],
	[ts.TypeFlags.Conditional, 'Conditional'],
	[ts.TypeFlags.Union, 'Union'],
	[ts.TypeFlags.Intersection, 'Intersection'],
];

function getTypeFlagNames(flags: ts.TypeFlags): string[] {
	const names = typeFlagDisplayOrder
		.filter(([flag]) => (flags & flag) === flag)
		.map(([, name]) => name);

	if (names.length > 0) {
		return names;
	}

	return [ts.TypeFlags[flags] ?? String(flags)];
}
