import ts from 'typescript';
import { LiteralNode, type AnyType } from '../../models';
import { getDocumentationFromSymbol } from '../documentationParser';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { includesCompositeFlag } from '../typeResolutionUtils';

// Literal handling keeps literal value extraction and literal
// documentation lookup together, since both depend on TypeScript's literal
// symbol metadata.

export function resolveLiteralType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!includesCompositeFlag(type, ts.TypeFlags.Literal)) {
		return undefined;
	}

	const { checker } = session.context;

	if (type.isLiteral()) {
		return new LiteralNode(
			type.isStringLiteral() ? `"${type.value}"` : type.value,
			typeName,
			getDocumentationFromSymbol(type.symbol, checker),
		);
	}

	return new LiteralNode(checker.typeToString(type));
}
