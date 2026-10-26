import ts, { FunctionDeclaration } from 'typescript';
import { type ScopedParserContext } from '../../parserContext';
import { FunctionNode, type AnyType } from '../../models';
import { TypeName } from '../../models/typeName';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';
import { parseCallSignature } from './signatureParser';

// Callable type handling lives in one resolver module. The
// exported resolver selects call-signature types, while signatureParser owns
// shared parameter, default, documentation, and return-type details.

export function resolveCallableType(
	{ type, typeName }: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	if (type.getCallSignatures().length < 1) {
		return undefined;
	}

	return buildFunctionNodeFromType(type, typeName, session.context, session.resolveWithContext);
}

/**
 * Builds a FunctionNode after a resolver has selected a callable type. Nested
 * parameter and return types are resolved through the active session callback
 * so function construction does not restart resolution through the public API.
 */
function buildFunctionNodeFromType(
	type: ts.Type,
	typeName: TypeName | undefined,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): FunctionNode | undefined {
	const parsedCallSignatures = type
		.getCallSignatures()
		.map((signature) => parseCallSignature(signature, context, resolveTypeReference));

	if (parsedCallSignatures.length === 0) {
		return;
	}

	const symbol = type.aliasSymbol ?? type.getSymbol();

	// Functions with `export default` are named "default" in the type checker.
	// Keep the session-computed TypeName for every other callable so aliases
	// recovered from authored type nodes retain their namespace and type args.
	if (typeName?.name === 'default') {
		typeName = new TypeName(
			(symbol?.valueDeclaration as FunctionDeclaration | undefined)?.name?.getText() ?? 'default',
			typeName.namespaces,
			typeName.typeArguments,
		);
	}

	return new FunctionNode(typeName, parsedCallSignatures);
}
