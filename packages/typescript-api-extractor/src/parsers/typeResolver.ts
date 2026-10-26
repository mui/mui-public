import ts from 'typescript';
import { type AnyType } from '../models';
import { type ScopedParserContext } from '../parserContext';
import { TypeResolutionSession } from './typeResolutionSession';

/**
 * Public facade for type resolution. The implementation is intentionally kept
 * in TypeResolutionSession and resolver modules so this entry point remains the
 * stable API used by the rest of the parser.
 *
 * @param type TypeScript type to resolve.
 * @param typeNode TypeScript TypeNode associated with the type, if available. It can be used to preserve the authored type name.
 * @param context Parser context containing TypeScript checker and other utilities.
 */
export function resolveType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ScopedParserContext,
): AnyType {
	return new TypeResolutionSession(context).resolve(type, typeNode);
}
