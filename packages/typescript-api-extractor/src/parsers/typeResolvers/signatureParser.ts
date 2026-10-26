import ts from 'typescript';
import { type ScopedParserContext } from '../../parserContext';
import { CallSignature, Parameter, type AnyType } from '../../models';
import { ParserError } from '../../ParserError';
import { getParameterDocumentationFromSymbol } from '../documentationParser';
import { type ResolveTypeInContext } from '../typeResolutionTypes';
import { buildSignatureTypeParameterNodes } from './signatureTypeParameterNodes';
import {
	containsIndexedAccessUnionSource,
	getPreservableKeyofTypeNode,
	substituteTypeParameterTypeNode,
} from './typeOperatorTypeNodes';

// Function-like signature parsing lives here so free functions, constructors,
// and class methods do not drift on parameter docs, defaults, or return types.

/**
 * Parses a TypeScript call signature into the API model. Handles function
 * declarations like `fn(value: string): number` and class methods like
 * `instance.update(value = 1): void`.
 *
 * @param signature - Checker signature to convert.
 * @param context - Active scoped parser context.
 * @param resolveTypeReference - Session-aware resolver used for nested parameter and return types.
 * @returns The extracted call-signature model.
 */
export function parseCallSignature(
	signature: ts.Signature,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): CallSignature {
	return new CallSignature(
		signature.parameters.map((parameterSymbol) =>
			parseParameter(parameterSymbol, context, resolveTypeReference),
		),
		parseReturnType(signature, context, resolveTypeReference),
		buildSignatureTypeParameterNodes(signature, context, resolveTypeReference),
	);
}

/**
 * Parses a signature parameter and its local metadata. Handles examples like
 * `value?: string`, `options = { dense: true }`, and JSDoc `@param` comments
 * attached to either function parameters or class method parameters.
 *
 * @param parameterSymbol - Checker symbol for the signature parameter.
 * @param context - Active scoped parser context.
 * @param resolveTypeReference - Session-aware resolver used for the parameter type.
 * @returns The extracted parameter model, including docs and default value.
 */
export function parseParameter(
	parameterSymbol: ts.Symbol,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): Parameter {
	const { checker } = context;

	return context.runWithSymbolScope(`parameter: ${parameterSymbol.name}`, () => {
		try {
			const parameterDeclaration = getParameterDeclaration(parameterSymbol);
			const parameterTypeNode = parameterDeclaration?.type
				? substituteTypeParameterTypeNode(
						parameterDeclaration.type,
						checker,
						context.typeParameterTypeNodeSubstitutions,
					)
				: undefined;
			const parameterSourceNode =
				parameterTypeNode ?? parameterDeclaration ?? parameterSymbol.valueDeclaration;
			const typeLocation =
				parameterSymbol.valueDeclaration ?? parameterSymbol.declarations?.[0] ?? context.sourceFile;

			return context.runWithSourceNodeScope(parameterSourceNode, () => {
				const parameterType = resolveTypeReference(
					checker.getTypeOfSymbolAtLocation(parameterSymbol, typeLocation),
					parameterTypeNode,
					context,
				);
				const documentation = getParameterDocumentationFromSymbol(parameterSymbol, checker);
				const initializer = parameterDeclaration?.initializer;

				return new Parameter(
					parameterType,
					parameterSymbol.getName(),
					documentation,
					parameterDeclaration?.questionToken !== undefined || initializer !== undefined,
					parseParameterDefaultValue(initializer, checker),
				);
			});
		} catch (error) {
			// Parameter resolution is frequently nested several levels below the
			// exported symbol; wrapping unknown errors keeps that symbol stack in
			// the final diagnostic instead of losing the call-site breadcrumb trail.
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}

/**
 * Parses a signature return type. Handles examples like `(): Promise<Result>`
 * while always using the explicit return annotation as diagnostic source
 * context. An annotation that contains or references preservable `keyof`
 * syntax also steers type resolution so the authored operator is not lost.
 *
 * @param signature - Checker signature whose return type should be resolved.
 * @param context - Active scoped parser context.
 * @param resolveTypeReference - Session-aware resolver used for the return type.
 * @returns The extracted return-type model.
 */
export function parseReturnType(
	signature: ts.Signature,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): AnyType {
	const authoredReturnTypeNode = getReturnTypeNode(signature);
	const returnTypeNode = authoredReturnTypeNode
		? substituteTypeParameterTypeNode(
				authoredReturnTypeNode,
				context.checker,
				context.typeParameterTypeNodeSubstitutions,
			)
		: undefined;
	const resolutionTypeNode =
		getPreservableKeyofTypeNode(
			returnTypeNode,
			context.checker,
			context.typeParameterTypeNodeSubstitutions,
			context.includeExternalTypes,
		) ?? (containsIndexedAccessUnionSource(returnTypeNode) ? returnTypeNode : undefined);

	return context.runWithSourceNodeScope(returnTypeNode, () =>
		resolveTypeReference(signature.getReturnType(), resolutionTypeNode, context),
	);
}

function getReturnTypeNode(signature: ts.Signature): ts.TypeNode | undefined {
	const declaration = signature.getDeclaration();
	return declaration && 'type' in declaration ? declaration.type : undefined;
}

function getParameterDeclaration(parameterSymbol: ts.Symbol): ts.ParameterDeclaration | undefined {
	const declaration = parameterSymbol.valueDeclaration ?? parameterSymbol.declarations?.[0];
	return declaration && ts.isParameter(declaration) ? declaration : undefined;
}

function parseParameterDefaultValue(
	initializer: ts.Expression | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	if (!initializer) {
		return undefined;
	}

	const initializerType = checker.getTypeAtLocation(initializer);
	if (initializerType.flags & ts.TypeFlags.Literal) {
		if (initializerType.isStringLiteral()) {
			return `"${initializerType.value}"`;
		}

		if (initializerType.isLiteral()) {
			return initializerType.value.toString();
		}
	}

	// Literal defaults are normalized above. For object, array, identifier, and
	// call-expression defaults, preserve the authored initializer text so every
	// signature owner exposes the same non-literal default information.
	return initializer.getText();
}
