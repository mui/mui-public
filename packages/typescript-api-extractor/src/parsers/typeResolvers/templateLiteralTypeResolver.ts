import ts from 'typescript';
import { TemplateLiteralNode, type AnyType } from '../../models';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { hasExactFlag } from '../typeResolutionUtils';

/**
 * Resolves template literal types such as `` `${number}px` ``, keeping their text and
 * resolving each placeholder like any other type.
 *
 * The checker has already normalized the type: finite placeholders such as
 * `` `${'a' | 'b'}-${number}` `` are distributed into a union of template literals,
 * and nested template literals are flattened, so only open-ended placeholders
 * (for example `string`, `number`, or a type parameter) reach this resolver.
 *
 * @param request - Semantic template literal candidate and its public name.
 * @param session - Active resolution session used for the placeholder types.
 * @returns A template literal model, or `undefined` for any other type.
 */
export function resolveTemplateLiteralType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (!hasExactFlag(type, ts.TypeFlags.TemplateLiteral)) {
		return undefined;
	}

	const { texts, types } = type as ts.TemplateLiteralType;
	return new TemplateLiteralNode(
		typeName,
		texts,
		types.map((placeholderType) => session.resolve(placeholderType, undefined)),
	);
}
