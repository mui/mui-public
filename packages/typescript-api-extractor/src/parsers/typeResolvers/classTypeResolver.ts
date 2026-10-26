import ts from 'typescript';
import { type ScopedParserContext } from '../../parserContext';
import {
	ClassNode,
	ConstructSignature,
	ClassProperty,
	ClassMethod,
	Documentation,
	type AnyType,
} from '../../models';
import { getFullName } from '../common';
import { TypeName } from '../../models/typeName';
import { getDocumentationFromSymbol } from '../documentationParser';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';
import { parseCallSignature, parseParameter } from './signatureParser';
import {
	containsIndexedAccessUnionSource,
	getPreservableKeyofTypeNode,
	getPropertyTypeNode,
	substituteTypeParameterTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Resolves class constructor types and their instance/static API members.
 *
 * @param request - Semantic class candidate; authored syntax is handled by nested member parsers.
 * @param session - Active resolution session shared by constructors, methods, and properties.
 * @returns A class model for actual class declarations/expressions, otherwise `undefined`.
 */
export function resolveClassType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type } = request;
	if (type.getConstructSignatures().length < 1) {
		return undefined;
	}

	return buildClassNodeFromType(type, session.context, session.resolveWithContext);
}

/**
 * Builds a ClassNode after the resolver pipeline has selected a class-shaped
 * type. The active resolver callback is threaded through nested members so
 * return types, parameters, and properties stay inside the current resolution
 * session instead of re-entering through the public resolveType facade.
 *
 * @param type - The TypeScript type representing the class (static side / constructor)
 * @param context - Parser context with type checker and other utilities
 * @returns ClassNode if the type is a class, undefined otherwise
 */
function buildClassNodeFromType(
	type: ts.Type,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): ClassNode | undefined {
	const constructSignatures = type.getConstructSignatures();
	if (constructSignatures.length === 0) {
		return undefined;
	}

	const symbol = type.getSymbol();
	if (!symbol) {
		return undefined;
	}

	// Ensure this is actually a class, not just an interface/type with construct signatures
	// (e.g., `interface Constructable { new (): Foo }` should not be treated as a class)
	const isClass = symbol.flags & ts.SymbolFlags.Class;
	if (!isClass) {
		// Double-check via declarations - some class expressions may not have the Class flag
		const hasClassDeclaration = symbol.declarations?.some(
			(decl) => ts.isClassDeclaration(decl) || ts.isClassExpression(decl),
		);
		if (!hasClassDeclaration) {
			return undefined;
		}
	}

	const fqn = getFullName(type, undefined, context);
	const typeName = fqn?.name
		? new TypeName(fqn.name, fqn.namespaces, fqn.typeArguments)
		: undefined;

	// Parse construct signatures
	const parsedConstructSignatures = constructSignatures.map((sig) =>
		buildConstructSignature(sig, context, resolveTypeReference),
	);

	// Parse instance properties and methods
	const properties: ClassProperty[] = [];
	const methods: ClassMethod[] = [];

	// Get the instance type to extract instance members
	const instanceType = constructSignatures[0]?.getReturnType();
	if (instanceType) {
		extractMembers(instanceType, false, properties, methods, context, resolveTypeReference);
	}

	// Extract static members from the class constructor type itself
	// Static members are properties of the class object, not instances
	extractMembers(type, true, properties, methods, context, resolveTypeReference);

	// Extract type parameters from the class declaration
	let typeParameters: TypeName[] | undefined;
	const declaration = symbol.declarations?.[0];
	if (declaration && ts.isClassDeclaration(declaration) && declaration.typeParameters) {
		typeParameters = declaration.typeParameters.map(
			(tp) => new TypeName(tp.name.text, undefined, undefined),
		);
	}

	return new ClassNode(typeName, parsedConstructSignatures, properties, methods, typeParameters);
}

/**
 * Extracts properties and methods from a type and adds them to the provided arrays.
 * Used for both instance members and static members.
 */
function extractMembers(
	type: ts.Type,
	isStatic: boolean,
	properties: ClassProperty[],
	methods: ClassMethod[],
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): void {
	const { checker } = context;

	const members = checker.getPropertiesOfType(type);

	for (const member of members) {
		// Skip private and internal members (JSDoc tags)
		const memberDoc = getDocumentationFromSymbol(member, checker);
		if (
			memberDoc?.visibility === 'private' ||
			memberDoc?.visibility === 'internal' ||
			memberDoc?.tags?.some((tag) => tag.name === 'ignore')
		) {
			continue;
		}

		// Skip members starting with underscore (private by convention)
		// or ECMAScript private names (e.g., #secret, #method)
		if (member.name.startsWith('_') || member.name.startsWith('#')) {
			continue;
		}

		// Skip built-in properties that appear on class constructors (for static members)
		// These are inherited from Function and shouldn't be documented as class members
		if (isStatic && ['prototype', 'length', 'name', 'arguments', 'caller'].includes(member.name)) {
			continue;
		}

		const memberDeclaration = member.valueDeclaration ?? member.declarations?.[0];
		if (!memberDeclaration) {
			continue;
		}

		// Skip TypeScript private/protected members
		if (ts.canHaveModifiers(memberDeclaration)) {
			const modifiers = ts.getModifiers(memberDeclaration);
			if (
				modifiers?.some(
					(m: ts.Modifier) =>
						m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
				)
			) {
				continue;
			}
		}

		const memberType = checker.getTypeOfSymbolAtLocation(member, memberDeclaration);

		// Check if it's a method - must be declared as a method, not just have call signatures
		// (function-typed properties like `foo: () => void` should remain as properties)
		const isMethodDeclaration =
			ts.isMethodDeclaration(memberDeclaration) || ts.isMethodSignature(memberDeclaration);

		const tsCallSignatures = memberType.getCallSignatures();
		if (isMethodDeclaration && tsCallSignatures.length > 0) {
			// Method signatures share the same parameter/default/return parsing as
			// free functions, keeping class APIs aligned with callable exports.
			const signatures = tsCallSignatures.map((sig) =>
				parseCallSignature(sig, context, resolveTypeReference),
			);

			methods.push(new ClassMethod(member.name, signatures, memberDoc, isStatic));
		} else {
			// It's a property
			const propertyTypeNode = getPropertyTypeNode(member, checker);
			const substitutedPropertyTypeNode = propertyTypeNode
				? substituteTypeParameterTypeNode(
						propertyTypeNode,
						checker,
						context.typeParameterTypeNodeSubstitutions,
					)
				: undefined;
			const resolutionTypeNode =
				getPreservableKeyofTypeNode(
					substitutedPropertyTypeNode,
					checker,
					context.typeParameterTypeNodeSubstitutions,
					context.includeExternalTypes,
				) ??
				(containsIndexedAccessUnionSource(substitutedPropertyTypeNode)
					? substitutedPropertyTypeNode
					: undefined);
			const resolvedType = context.runWithSourceNodeScope(propertyTypeNode, () =>
				resolveTypeReference(memberType, resolutionTypeNode, context),
			);
			const isOptional = (member.flags & ts.SymbolFlags.Optional) !== 0;

			// Check readonly in multiple ways:
			// 1. PropertyDeclaration with readonly modifier
			// 2. ParameterDeclaration with readonly modifier (constructor parameter property)
			// 3. Getter-only accessor (has getter but no setter)
			let isReadonly = false;
			if (
				memberDeclaration &&
				ts.isPropertyDeclaration(memberDeclaration) &&
				memberDeclaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
			) {
				isReadonly = true;
			} else if (
				memberDeclaration &&
				ts.isParameter(memberDeclaration) &&
				memberDeclaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
			) {
				// Constructor parameter property with readonly
				isReadonly = true;
			} else if (memberDeclaration && ts.isGetAccessorDeclaration(memberDeclaration)) {
				// Check if there's a corresponding setter
				const hasSetter = member.declarations?.some((d) => ts.isSetAccessorDeclaration(d));
				if (!hasSetter) {
					isReadonly = true;
				}
			}

			properties.push(
				new ClassProperty(member.name, resolvedType, memberDoc, isOptional, isReadonly, isStatic),
			);
		}
	}
}

function buildConstructSignature(
	signature: ts.Signature,
	context: ScopedParserContext,
	resolveTypeReference: ResolveTypeInContext,
): ConstructSignature {
	const { checker } = context;

	const parameters = signature.parameters.map((paramSymbol) =>
		parseParameter(paramSymbol, context, resolveTypeReference),
	);

	// Get documentation from the constructor declaration if available
	const declaration = signature.getDeclaration();
	let documentation: Documentation | undefined;
	if (declaration && 'symbol' in declaration) {
		const symbol = declaration.symbol as ts.Symbol | undefined;
		if (symbol) {
			documentation = getDocumentationFromSymbol(symbol, checker);
		}
	}

	return new ConstructSignature(parameters, documentation);
}
