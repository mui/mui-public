import ts from 'typescript';
import { getDocumentationFromSymbol } from '../documentationParser';
import { type ScopedParserContext } from '../../parserContext';
import { isNodeModulesDeclaration } from '../sourceFileUtils';
import {
	ObjectNode,
	TypeName,
	IndexSignatureNode,
	AnyType,
	IntrinsicNode,
	PropertyNode,
	UnionNode,
} from '../../models';
import { ParserError } from '../../ParserError';
import {
	type ResolveTypeInContext,
	type TypeResolutionRequest,
	type TypeResolutionSession,
} from '../typeResolutionTypes';
import { hasExactFlag } from '../typeResolutionUtils';
import {
	getMappedPropertyKeyType,
	getMappedTypeParameterSubstitutions,
	substituteTypeParameter,
} from './mappedTypeSubstitutions';
import {
	getPreservableKeyofTypeNode,
	getPropertyTypeNode,
	substituteTypeParameterTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Resolves object-like types, including mapped substitutions and index signatures.
 *
 * @param request - Semantic object candidate, public name, and optional authored generic syntax.
 * @param session - Active resolution session used for properties and index values.
 * @returns An expanded or shallow object model, otherwise `undefined` when another resolver owns it.
 */
export function resolveObjectLikeType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName } = request;
	const resolveObject = () => {
		const objectType = buildObjectNodeFromType(
			type,
			typeName,
			session.context,
			session.resolveWithContext,
		);
		if (objectType) {
			return objectType;
		}

		const { checker } = session.context;
		if (
			hasExactFlag(type, ts.TypeFlags.Object) ||
			(hasExactFlag(type, ts.TypeFlags.NonPrimitive) && checker.typeToString(type) === 'object')
		) {
			return new ObjectNode(typeName, [], undefined);
		}

		return undefined;
	};
	return resolveObject();
}

/**
 * Returns whether a plain object can skip the earlier array, tuple, callable,
 * and constructable resolver paths without changing which shape owns it.
 *
 * @param type - Semantic type to classify.
 * @param checker - Checker used for array and tuple recognition.
 * @returns Whether the type is an object with no more specific container/callable shape.
 */
export function canResolveObjectTypeShallowly(type: ts.Type, checker: ts.TypeChecker): boolean {
	return (
		isObjectType(type) &&
		!checker.isArrayType(type) &&
		!checker.isTupleType(type) &&
		type.getCallSignatures().length === 0 &&
		type.getConstructSignatures().length === 0
	);
}

/**
 * Builds a shallow named object while retaining observable index-signature output.
 *
 * @param request - Semantic object candidate and its required public name.
 * @param session - Active resolution session used for the index-signature value.
 * @returns A shallow object model when safe, otherwise `undefined`.
 */
export function resolveShallowObjectLikeType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): ObjectNode | undefined {
	const { type, typeName } = request;
	if (!typeName || !canResolveObjectTypeShallowly(type, session.context.checker)) {
		return undefined;
	}

	return new ObjectNode(
		typeName,
		[],
		undefined,
		buildIndexSignatureNode(type, session.context, session.resolveWithContext),
	);
}

/**
 * Builds the index signature of an object type if it has one. This only works
 * for actual object types; conditional and other non-object shapes are selected
 * by resolver adapters before this builder is called.
 */
function buildIndexSignatureNode(
	type: ts.Type,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
): IndexSignatureNode | undefined {
	// Only check index signatures on actual object types
	// Conditional types and other non-object types may report index signatures incorrectly
	if (!isObjectType(type)) {
		return undefined;
	}

	// The value type sits behind an (open-ended) property of this object, so it
	// resolves one property level deeper than the object itself.
	return context.runWithPropertyValueScope(() =>
		buildIndexSignatureNodeCore(type, context, resolveValueType),
	);
}

function buildIndexSignatureNodeCore(
	type: ts.ObjectType,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
): IndexSignatureNode | undefined {
	const { checker } = context;

	const mappedNode =
		type.objectFlags & ts.ObjectFlags.Mapped
			? type.symbol?.declarations?.find(ts.isMappedTypeNode)
			: undefined;
	const mappedSubstitutions = mappedNode ? getMappedTypeParameterSubstitutions(type) : undefined;
	const stringIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.String);
	const numberIndexInfo = checker.getIndexInfoOfType(type, ts.IndexKind.Number);
	const mappedTemplateTypeNode = mappedNode?.type
		? getPreservableKeyofTypeNode(
				mappedNode.type,
				checker,
				context.typeParameterTypeNodeSubstitutions,
				context.includeExternalTypes,
			)
		: undefined;
	const mappedTemplateContainsKeyof = Boolean(mappedTemplateTypeNode);
	const mappedIndexSignature =
		mappedNode &&
		mappedSubstitutions &&
		(mappedTemplateContainsKeyof || (!stringIndexInfo && !numberIndexInfo))
			? buildMappedIndexSignatureNode(
					type,
					mappedNode,
					mappedSubstitutions,
					context,
					resolveValueType,
					mappedTemplateTypeNode,
				)
			: undefined;
	if (mappedIndexSignature) {
		return mappedIndexSignature;
	}

	// Helper to extract key parameter name from index signature declaration
	const getKeyName = (indexInfo: ts.IndexInfo): string | undefined => {
		const declaration = indexInfo.declaration;
		if (declaration && ts.isIndexSignatureDeclaration(declaration)) {
			// Index signature has parameters like [fileName: string]
			const keyParam = declaration.parameters[0];
			if (keyParam && ts.isParameter(keyParam)) {
				return keyParam.name.getText();
			}
		}
		return undefined;
	};

	// Try string index first
	if (stringIndexInfo) {
		return {
			keyName: getKeyName(stringIndexInfo),
			keyType: 'string',
			valueType: resolveValueType(
				stringIndexInfo.type,
				getIndexValueTypeNode(stringIndexInfo, context),
				context,
			),
		};
	}

	// Then try number index
	if (numberIndexInfo) {
		return {
			keyName: getKeyName(numberIndexInfo),
			keyType: 'number',
			valueType: resolveValueType(
				numberIndexInfo.type,
				getIndexValueTypeNode(numberIndexInfo, context),
				context,
			),
		};
	}

	return undefined;
}

function buildMappedIndexSignatureNode(
	type: ts.ObjectType,
	mappedNode: ts.MappedTypeNode,
	substitutions: Map<ts.Symbol, ts.Type>,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
	templateTypeNode: ts.TypeNode | undefined,
): IndexSignatureNode | undefined {
	const { checker } = context;
	// `as` clauses rename keys (e.g. `[K in keyof T as `prefix_${K}`]`); the resulting
	// key shape can't be represented as a plain index signature, so fall through.
	if (!mappedNode.type || mappedNode.nameType) {
		return undefined;
	}

	const constraintNode = mappedNode.typeParameter.constraint;
	const constraintNodeType = constraintNode
		? substituteTypeParameter(checker.getTypeAtLocation(constraintNode), substitutions)
		: undefined;
	const constraintType = constraintNodeType
		? (checker.getBaseConstraintOfType(constraintNodeType) ?? constraintNodeType)
		: undefined;
	let keyType: 'string' | 'number' | undefined;
	if (constraintType && constraintType.flags & ts.TypeFlags.String) {
		keyType = 'string';
	} else if (constraintType && constraintType.flags & ts.TypeFlags.Number) {
		keyType = 'number';
	}
	if (!keyType) {
		return undefined;
	}

	const indexInfo = checker.getIndexInfoOfType(
		type,
		keyType === 'string' ? ts.IndexKind.String : ts.IndexKind.Number,
	);
	const templateType = indexInfo?.type ?? checker.getTypeAtLocation(mappedNode.type);
	let valueType = resolveTemplateValueType(
		templateType,
		templateTypeNode,
		context,
		resolveValueType,
		substitutions,
	);
	const questionToken = mappedNode.questionToken;
	if (
		questionToken &&
		(questionToken.kind === ts.SyntaxKind.QuestionToken ||
			questionToken.kind === ts.SyntaxKind.PlusToken)
	) {
		valueType = new UnionNode(undefined, [valueType, new IntrinsicNode('undefined')]);
	}

	return {
		keyName: mappedNode.typeParameter.name.text,
		keyType,
		valueType,
	};
}

function getIndexValueTypeNode(
	indexInfo: ts.IndexInfo,
	context: ScopedParserContext,
): ts.TypeNode | undefined {
	const declaration = indexInfo.declaration;
	return declaration && ts.isIndexSignatureDeclaration(declaration)
		? getPreservableKeyofTypeNode(
				declaration.type,
				context.checker,
				context.typeParameterTypeNodeSubstitutions,
				context.includeExternalTypes,
			)
		: undefined;
}

function isObjectType(type: ts.Type): type is ts.ObjectType {
	return Boolean(type.flags & ts.TypeFlags.Object);
}

/**
 * Resolve a mapped-type template with the instantiated mapped type's type-parameter
 * mapper, so wrapper aliases propagate their type arguments through nested values.
 */
function resolveTemplateValueType(
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ScopedParserContext,
	resolve: (
		type: ts.Type,
		typeNode: ts.TypeNode | undefined,
		context: ScopedParserContext,
	) => AnyType,
	substitutions: Map<ts.Symbol, ts.Type>,
	propertyKeyBinding?: MappedPropertyKeyBinding,
): AnyType {
	const typeParameterSubstitutions = new Map(context.typeParameterSubstitutions);
	for (const [symbol, substitution] of substitutions) {
		typeParameterSubstitutions.set(symbol, substitution);
	}
	const typeParameterTypeNodeSubstitutions = new Map(context.typeParameterTypeNodeSubstitutions);
	if (propertyKeyBinding) {
		typeParameterSubstitutions.set(propertyKeyBinding.symbol, propertyKeyBinding.type);
		if (propertyKeyBinding.typeNode) {
			typeParameterTypeNodeSubstitutions.set(
				propertyKeyBinding.symbol,
				propertyKeyBinding.typeNode,
			);
		}
	}

	return context.runWithTypeParameterSubstitutionScope(
		typeParameterSubstitutions,
		() => resolve(type, typeNode, context),
		typeParameterTypeNodeSubstitutions.size ? typeParameterTypeNodeSubstitutions : undefined,
	);
}

interface MappedPropertyKeyBinding {
	symbol: ts.Symbol;
	type: ts.Type;
	typeNode?: ts.LiteralTypeNode;
}

/**
 * Reconstructs the per-property binding of a mapped key. Remapped properties
 * use TypeScript's retained original `keyType`; ordinary generated properties
 * fall back to their emitted name. Only literal keys receive synthetic authored
 * nodes, so unsupported symbol metadata cannot manufacture misleading syntax.
 *
 * @param mappedNode - Authored mapped type that generated the property.
 * @param propertySymbol - Concrete generated property being resolved.
 * @param checker - Checker used to resolve the mapped parameter symbol and key type.
 * @returns The semantic key and optional authored literal, or `undefined` when unrecoverable.
 */
function getMappedPropertyKeyBinding(
	mappedNode: ts.MappedTypeNode,
	propertySymbol: ts.Symbol,
	checker: ts.TypeChecker,
): MappedPropertyKeyBinding | undefined {
	const symbol = checker.getSymbolAtLocation(mappedNode.typeParameter.name);
	const propertyName = propertySymbol.getName();
	const keyType = getMappedPropertyKeyType(propertySymbol);
	if (!symbol || (!keyType && propertyName.startsWith('__@'))) {
		return undefined;
	}
	const resolvedKeyType = keyType ?? checker.getStringLiteralType(propertyName);
	const keyTypeNode = resolvedKeyType.isStringLiteral()
		? ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(resolvedKeyType.value))
		: resolvedKeyType.isNumberLiteral()
			? ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(resolvedKeyType.value))
			: undefined;
	return {
		symbol,
		type: resolvedKeyType,
		...(keyTypeNode ? { typeNode: keyTypeNode } : {}),
	};
}

/**
 * Builds an ObjectNode for a type that the resolver pipeline is treating as an
 * object-like shape. Member value types use the active resolver callback so
 * nested properties remain in the same resolution session.
 */
function buildObjectNodeFromType(
	type: ts.Type,
	typeName: TypeName | undefined,
	context: ScopedParserContext,
	resolveValueType: ResolveTypeInContext,
): ObjectNode | undefined {
	const { shouldInclude, shouldResolveObject, typeStack, includeExternalTypes, propertyDepth } =
		context;
	const mappedNode =
		isObjectType(type) && type.objectFlags & ts.ObjectFlags.Mapped
			? type.symbol?.declarations?.find(ts.isMappedTypeNode)
			: undefined;
	const mappedSubstitutions = mappedNode ? getMappedTypeParameterSubstitutions(type) : undefined;

	const properties = type
		.getProperties()
		.filter((property) => includeExternalTypes || !isPropertyExternal(property));

	// Check for index signature even if there are no properties.
	const indexSignature = buildIndexSignatureNode(type, context, resolveValueType);

	// Return an object node if there's either properties or an index signature
	if (properties.length || indexSignature) {
		if (
			shouldResolveObject({
				name: typeName?.name ?? '',
				propertyCount: properties.length,
				depth: typeStack.length,
				propertyDepth,
			})
		) {
			let filteredProperties: ts.Symbol[];
			if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) {
				filteredProperties = properties.filter((property) =>
					shouldInclude({ name: property.getName(), depth: typeStack.length + 1 }),
				);
			} else {
				filteredProperties = properties.filter((property) => {
					// Skip ECMAScript private identifiers (#field)
					if (property.getName().startsWith('#')) {
						return false;
					}

					const declaration =
						property.valueDeclaration ??
						(property.declarations?.[0] as
							| ts.PropertySignature
							| ts.MethodSignature
							| ts.PropertyAssignment
							| ts.PropertyDeclaration
							| ts.ParameterDeclaration
							| ts.GetAccessorDeclaration
							| ts.SetAccessorDeclaration
							| ts.ShorthandPropertyAssignment
							| undefined);

					if (!declaration) {
						return false;
					}

					// Skip private/protected class members
					if (ts.canHaveModifiers(declaration)) {
						const modifiers = ts.getModifiers(declaration);
						if (
							modifiers?.some(
								(m) =>
									m.kind === ts.SyntaxKind.PrivateKeyword ||
									m.kind === ts.SyntaxKind.ProtectedKeyword ||
									m.kind === ts.SyntaxKind.StaticKeyword,
							)
						) {
							return false;
						}
					}

					return (
						(ts.isPropertySignature(declaration) ||
							ts.isMethodSignature(declaration) ||
							ts.isPropertyAssignment(declaration) ||
							ts.isPropertyDeclaration(declaration) ||
							ts.isShorthandPropertyAssignment(declaration) ||
							ts.isParameter(declaration) ||
							ts.isGetAccessorDeclaration(declaration) ||
							ts.isSetAccessorDeclaration(declaration)) &&
						shouldInclude({ name: property.getName(), depth: typeStack.length + 1 })
					);
				});
			}

			if (filteredProperties.length > 0 || indexSignature) {
				return new ObjectNode(
					typeName,
					filteredProperties.map((property) => {
						const declaration = property.valueDeclaration ?? property.declarations?.[0];
						// MethodSignature uses checker.getTypeOfSymbol fallback in the property builder.
						const propertySignature =
							declaration && ts.isPropertySignature(declaration) ? declaration : undefined;
						const propertyTypeNode = getPropertyTypeNode(property, context.checker);
						return buildPropertyNodeFromSymbol(
							property,
							propertySignature,
							context,
							resolveValueType,
							mappedNode,
							mappedSubstitutions,
							propertyTypeNode,
						);
					}),
					undefined,
					indexSignature,
				);
			}
		}

		return new ObjectNode(typeName, [], undefined, indexSignature);
	}
}

function isPropertyExternal(property: ts.Symbol): boolean {
	return property.declarations?.every(isNodeModulesDeclaration) ?? false;
}

function buildPropertyNodeFromSymbol(
	propertySymbol: ts.Symbol,
	propertySignature: ts.PropertySignature | undefined,
	context: ScopedParserContext,
	resolvePropertyType: ResolveTypeInContext,
	mappedNode?: ts.MappedTypeNode,
	mappedSubstitutions?: Map<ts.Symbol, ts.Type>,
	authoredPropertyTypeNode?: ts.TypeNode,
): PropertyNode {
	const { checker } = context;

	return context.runWithSymbolScope(`property: ${propertySymbol.name}`, () => {
		try {
			let type: ts.Type;
			const sourceNode =
				authoredPropertyTypeNode ?? propertySignature ?? propertySymbol.declarations?.[0];

			return context.runWithSourceNodeScope(sourceNode, () => {
				if (propertySignature) {
					if (propertySignature.type) {
						type = checker.getTypeOfSymbolAtLocation(propertySymbol, propertySignature.type);
					} else {
						type = checker.getAnyType();
					}
				} else {
					type = checker.getTypeOfSymbol(propertySymbol);
				}

				const mappedTemplateTypeNode = mappedNode?.type;
				// Instantiated mapped properties may point back to the source object's
				// declaration (`T[K]`) rather than the mapped value template. When that
				// template carries `keyof`, it must own syntax replay for the generated value.
				const preservableMappedTemplateTypeNode = getPreservableKeyofTypeNode(
					mappedTemplateTypeNode,
					checker,
					context.typeParameterTypeNodeSubstitutions,
					context.includeExternalTypes,
				);
				const candidatePropertyTypeNode =
					preservableMappedTemplateTypeNode ?? authoredPropertyTypeNode ?? mappedTemplateTypeNode;
				const resolvedPropertyTypeNode =
					!isTypeParameterLike(type) && candidatePropertyTypeNode
						? substituteTypeParameterTypeNode(
								candidatePropertyTypeNode,
								checker,
								context.typeParameterTypeNodeSubstitutions,
							)
						: undefined;
				// A property's value type sits one property level below the object
				// being described, which is what `shouldResolveObject` reads to tell
				// the requested shape from the nested details of that shape.
				const parsedType = context.runWithPropertyValueScope(() =>
					mappedNode && mappedTemplateTypeNode && mappedSubstitutions
						? resolveTemplateValueType(
								type,
								resolvedPropertyTypeNode,
								context,
								resolvePropertyType,
								mappedSubstitutions,
								getMappedPropertyKeyBinding(mappedNode, propertySymbol, checker),
							)
						: resolvePropertyType(type, resolvedPropertyTypeNode, context),
				);

				// Typechecker only gives the type "any" if it's present in a union.
				// This means the type of `a` in `{ a?: any }` isn't `any | undefined`.
				// So instead we check for the question mark to detect optional types.
				const isOptional =
					(type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) && propertySignature
						? Boolean(propertySignature.questionToken)
						: Boolean(propertySymbol.flags & ts.SymbolFlags.Optional);

				return new PropertyNode(
					propertySymbol.getName(),
					parsedType,
					getDocumentationFromSymbol(propertySymbol, checker),
					isOptional,
				);
			});
		} catch (error) {
			if (!(error instanceof ParserError)) {
				throw new ParserError(error, context.parsedSymbolStack);
			}

			throw error;
		}
	});
}

function isTypeParameterLike(type: ts.Type): boolean {
	// Check if the type is a type parameter.
	return (
		(type.flags & ts.TypeFlags.TypeParameter) !== 0 ||
		((type.flags & ts.TypeFlags.Union) !== 0 && isOptionalTypeParameter(type as ts.UnionType))
	);
}

function isOptionalTypeParameter(type: ts.UnionType): boolean {
	// Check if the type is defined as `foo?: T`, where T is a type parameter.
	return (
		type.types.length === 2 &&
		type.types.some((t) => t.flags & ts.TypeFlags.Undefined) &&
		type.types.some(
			(t) => 'objectFlags' in t && ((t.objectFlags as number) & ts.ObjectFlags.Instantiated) !== 0,
		)
	);
}
