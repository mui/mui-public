import ts from 'typescript';
import { TypeName, withTypeName, type AnyType } from '../../models';
import { type ScopedParserContext } from '../../parserContext';
import { declarationHasNodeModulesPathSegment } from '../sourceFileUtils';
import { deriveTypeParameterBindings, type TypeParameterBindings } from '../typeParameterBindings';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import {
	containsKeyofTypeOperator,
	containsKeyofTypeOperatorOrAlias,
	containsKeyofTypeNodeSubstitution,
	isBuiltInReadonlyUtilityDeclaration,
	isKeyofReferenceCompoundReplayableInSource,
	isRelativeImportedTypeReference,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';

interface AuthoredTypeAliasReference {
	declaration: ts.TypeAliasDeclaration;
	typeArgumentNodes?: readonly ts.TypeNode[];
	typeArguments?: readonly ts.Type[];
}

interface AuthoredKeyofReplayPlan {
	reference: AuthoredTypeAliasReference;
	bindings: TypeParameterBindings | undefined;
	typeName: TypeName | undefined;
	replayTypeNode: ts.TypeNode;
}

interface CheckerAliasReplayAnalysis {
	containsKeyof: boolean;
	replayable: boolean;
}

const activeAliasResolutions = new WeakMap<TypeResolutionSession, Set<ts.TypeAliasDeclaration>>();
const typeAliasSourceAnalysisCache = new WeakMap<
	ts.TypeAliasDeclaration,
	Map<boolean, TypeAliasSourceAnalysis>
>();

/** Checker-free facts about an alias declaration used during export normalization. */
export interface TypeAliasSourceAnalysis {
	/** Whether the alias chain contains authored `keyof` syntax. */
	containsKeyof: boolean;
	/** Whether the alias's outer/container shape can replay the `keyof` syntax. */
	replaysKeyof: boolean;
	/** Whether the alias chain references a relative project import. */
	referencesProjectImport: boolean;
}

/**
 * Replays an authored alias body when it contains `keyof`, including through
 * another alias. TypeScript often reduces the semantic type to an array, tuple,
 * union, or conditional branch before the normal shape resolver sees the
 * operator syntax.
 *
 * @param request - Semantic alias result plus any authored reference syntax.
 * @param session - Active session used to replay the alias body under generic substitutions.
 * @returns The replayed model, or `undefined` when the alias is not safely replayable.
 */
export function resolveAuthoredKeyofAlias(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const semanticDeclaration = request.type.aliasSymbol?.declarations?.find(
		ts.isTypeAliasDeclaration,
	);
	const authoredSourceFile =
		semanticDeclaration?.getSourceFile() ?? request.typeNode?.getSourceFile();
	if (
		authoredSourceFile &&
		!session.context.includeExternalTypes &&
		session.context.program.isSourceFileFromExternalLibrary(authoredSourceFile)
	) {
		return undefined;
	}
	const plan = getAuthoredKeyofReplayPlan(request, session);
	if (!plan) {
		return undefined;
	}
	if (
		isBuiltInReadonlyUtilityDeclaration(plan.reference.declaration) ||
		(!session.context.includeExternalTypes &&
			declarationHasNodeModulesPathSegment(plan.reference.declaration))
	) {
		// A local alias can semantically retain its own alias symbol while its
		// authored syntax points at another alias. Check the declaration selected by
		// the replay plan so external mapped bodies do not replace the invocation.
		// Built-in `Readonly<T>` stays transparent in both expansion modes because
		// its mapped body discards the original array or tuple element syntax.
		return undefined;
	}
	const { reference, bindings, typeName, replayTypeNode } = plan;

	let activeAliases = activeAliasResolutions.get(session);
	if (!activeAliases) {
		activeAliases = new Set();
		activeAliasResolutions.set(session, activeAliases);
	}
	if (activeAliases.has(reference.declaration)) {
		return undefined;
	}

	const resolveAliasBody = () => {
		activeAliases.add(reference.declaration);
		try {
			const resolvedType = session.context.runWithSourceNodeScope(reference.declaration.type, () =>
				session.resolveWithSyntax({
					...request,
					typeName,
					typeNode: replayTypeNode,
				}),
			);
			return resolvedType && typeName ? withTypeName(resolvedType, typeName) : resolvedType;
		} finally {
			activeAliases.delete(reference.declaration);
		}
	};

	return bindings
		? session.context.runWithTypeParameterSubstitutionScope(
				bindings.types,
				resolveAliasBody,
				bindings.typeNodes,
			)
		: resolveAliasBody();
}

function getAuthoredKeyofReplayPlan(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AuthoredKeyofReplayPlan | undefined {
	const { checker, includeExternalTypes } = session.context;
	const reference = getAuthoredAliasReference(request, checker);
	if (!reference) {
		return undefined;
	}

	// A replay plan is intentionally stricter than simply finding `keyof` in an
	// alias. The outer semantic result must be a shape the syntax resolvers can
	// reconstruct, and the alias body must either replay its own operator or
	// receive one through an authored generic argument.
	const bindings = getTypeAliasParameterSubstitutions(reference, session.context);
	const replaysAuthoredArgument = Boolean(
		bindings?.typeNodes &&
		containsKeyofTypeNodeSubstitution(
			reference.declaration.type,
			checker,
			bindings.typeNodes,
			includeExternalTypes,
		),
	);
	// A bound `T[K]` body may contain no operator itself while selecting a
	// property whose authored annotation does. Probe that source-aware path only
	// for indexed roots so ordinary generic aliases keep their semantic output.
	const replayBody = unwrapParenthesizedTypeNode(reference.declaration.type);
	const replaysBoundIndexedSource = Boolean(
		bindings?.typeNodes &&
		ts.isIndexedAccessTypeNode(replayBody) &&
		containsKeyofTypeOperatorOrAlias(
			replayBody,
			checker,
			new Set(),
			includeExternalTypes,
			bindings.typeNodes,
		),
	);
	const analysis = analyzeCheckerAliasReplay(reference.declaration, checker, includeExternalTypes);
	if (
		!replaysAuthoredArgument &&
		!replaysBoundIndexedSource &&
		(!analysis.containsKeyof || !analysis.replayable)
	) {
		return undefined;
	}
	if (!canCollapseAuthoredKeyofAlias(request.type, checker)) {
		return undefined;
	}

	return {
		reference,
		bindings,
		typeName: getOuterAliasTypeName(request, reference.declaration),
		replayTypeNode: substituteTypeParameterTypeNode(
			reference.declaration.type,
			checker,
			bindings?.typeNodes,
		),
	};
}

/**
 * Summarizes checker-free alias facts used while normalizing export descriptors.
 *
 * This source-only pass must not ask the checker for alias symbols: those
 * queries populate TypeScript's lazy caches and can change later observable
 * union/property ordering before descriptors are resolved in their legacy order.
 *
 * @param declaration - Root alias declaration to analyze.
 * @param includeExternalTypes - Whether the analysis may traverse external alias declarations.
 * @returns Cached source-only facts for the alias and selected external policy.
 */
export function analyzeTypeAliasSource(
	declaration: ts.TypeAliasDeclaration,
	includeExternalTypes = false,
): TypeAliasSourceAnalysis {
	let analyses = typeAliasSourceAnalysisCache.get(declaration);
	const cached = analyses?.get(includeExternalTypes);
	if (cached) {
		return cached;
	}

	const analysis = {
		containsKeyof: typeAliasContainsKeyofInSource(declaration, new Set(), includeExternalTypes),
		replaysKeyof: typeAliasReplaysKeyofInSource(declaration),
		referencesProjectImport: typeAliasReferencesProjectImportInSource(declaration),
	};
	if (!analyses) {
		analyses = new Map();
		typeAliasSourceAnalysisCache.set(declaration, analyses);
	}
	analyses.set(includeExternalTypes, analysis);
	return analysis;
}

/**
 * Checks a root alias chain using source declarations only. This deliberately
 * avoids checker symbol queries so export normalization cannot perturb
 * TypeScript's lazy type caches before ordered type resolution begins.
 */
function typeAliasContainsKeyofInSource(
	declaration: ts.TypeAliasDeclaration,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
	includeExternalTypes = false,
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);
	if (!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration)) {
		return false;
	}
	return typeNodeContainsKeyofInSource(declaration.type, seen, includeExternalTypes);
}

/** Checks whether an alias's emitted root/container shape can replay `keyof` syntax. */
function typeAliasReplaysKeyofInSource(
	declaration: ts.TypeAliasDeclaration,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): boolean {
	if (seen.has(declaration)) {
		return false;
	}
	seen.add(declaration);
	return typeNodeReplaysKeyofInSource(declaration.type, seen);
}

function typeNodeReplaysKeyofInSource(
	typeNode: ts.TypeNode,
	seen: Set<ts.TypeAliasDeclaration>,
): boolean {
	if (ts.isNamedTupleMember(typeNode)) {
		typeNode = typeNode.type;
	}
	while (ts.isOptionalTypeNode(typeNode) || ts.isRestTypeNode(typeNode)) {
		typeNode = typeNode.type;
	}
	typeNode = unwrapReadonlyContainerTypeNode(typeNode);
	if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.KeyOfKeyword) {
		return true;
	}
	if (ts.isArrayTypeNode(typeNode)) {
		return typeNodeReplaysKeyofInSource(typeNode.elementType, seen);
	}
	if (ts.isTupleTypeNode(typeNode)) {
		return typeNode.elements.some((element) => typeNodeReplaysKeyofInSource(element, seen));
	}
	if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
		return typeNode.types.some((member) => typeNodeReplaysKeyofInSource(member, seen));
	}
	if (ts.isConditionalTypeNode(typeNode)) {
		return (
			typeNodeReplaysKeyofInSource(typeNode.trueType, seen) ||
			typeNodeReplaysKeyofInSource(typeNode.falseType, seen)
		);
	}

	const referencedDeclaration = findLocalTypeAliasDeclaration(typeNode);
	return referencedDeclaration ? typeAliasReplaysKeyofInSource(referencedDeclaration, seen) : false;
}

function typeNodeContainsKeyofInSource(
	typeNode: ts.TypeNode,
	seen: Set<ts.TypeAliasDeclaration>,
	includeExternalTypes: boolean,
): boolean {
	if (containsKeyofTypeOperator(typeNode)) {
		return true;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(typeNode);
	if (ts.isArrayTypeNode(unwrapped)) {
		return typeNodeContainsKeyofInSource(unwrapped.elementType, seen, includeExternalTypes);
	}
	if (ts.isTupleTypeNode(unwrapped)) {
		return unwrapped.elements.some((element) =>
			typeNodeContainsKeyofInSource(element, seen, includeExternalTypes),
		);
	}
	if (ts.isUnionTypeNode(unwrapped) || ts.isIntersectionTypeNode(unwrapped)) {
		return unwrapped.types.some((member) =>
			typeNodeContainsKeyofInSource(member, seen, includeExternalTypes),
		);
	}

	const referencedDeclaration = findLocalTypeAliasDeclaration(unwrapped);
	return referencedDeclaration
		? typeAliasContainsKeyofInSource(referencedDeclaration, seen, includeExternalTypes)
		: false;
}

/** Identifies a source-only alias chain that needs checker-backed project-reference resolution. */
function typeAliasReferencesProjectImportInSource(
	declaration: ts.TypeAliasDeclaration,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): boolean {
	if (seen.has(declaration) || declarationHasNodeModulesPathSegment(declaration)) {
		return false;
	}
	seen.add(declaration);

	const typeNode = unwrapParenthesizedTypeNode(declaration.type);
	if (ts.isImportTypeNode(typeNode)) {
		return ts.isLiteralTypeNode(typeNode.argument) && ts.isStringLiteral(typeNode.argument.literal);
	}
	if (!ts.isTypeReferenceNode(typeNode)) {
		return false;
	}
	const localDeclaration = findLocalTypeAliasDeclaration(typeNode);
	return localDeclaration
		? typeAliasReferencesProjectImportInSource(localDeclaration, seen)
		: isProjectReferenceCandidateInSource(typeNode);
}

function isProjectReferenceCandidateInSource(typeNode: ts.TypeReferenceNode): boolean {
	if (isRelativeImportedTypeReference(typeNode)) {
		return true;
	}

	let rootName = typeNode.typeName;
	while (ts.isQualifiedName(rootName)) {
		rootName = rootName.left;
	}
	if (!ts.isIdentifier(rootName)) {
		return false;
	}

	return typeNode.getSourceFile().statements.some((statement) => {
		if (ts.isImportEqualsDeclaration(statement)) {
			return statement.name.text === rootName.text;
		}
		if (ts.isModuleDeclaration(statement)) {
			return ts.isIdentifier(statement.name) && statement.name.text === rootName.text;
		}
		if (!ts.isImportDeclaration(statement) || !statement.importClause) {
			return false;
		}

		const { importClause } = statement;
		if (importClause.name?.text === rootName.text) {
			return true;
		}
		const bindings = importClause.namedBindings;
		return bindings && ts.isNamespaceImport(bindings)
			? bindings.name.text === rootName.text
			: Boolean(
					bindings &&
					ts.isNamedImports(bindings) &&
					bindings.elements.some((element) => element.name.text === rootName.text),
				);
	});
}

function findLocalTypeAliasDeclaration(typeNode: ts.TypeNode): ts.TypeAliasDeclaration | undefined {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) {
		return undefined;
	}
	const referencedName = unwrapped.typeName.text;
	let current: ts.Node | undefined = unwrapped.parent;
	while (current) {
		const statements =
			ts.isSourceFile(current) || ts.isModuleBlock(current) || ts.isBlock(current)
				? current.statements
				: undefined;
		const declaration = statements?.find(
			(statement): statement is ts.TypeAliasDeclaration =>
				ts.isTypeAliasDeclaration(statement) && statement.name.text === referencedName,
		);
		if (declaration) {
			return declaration;
		}
		current = current.parent;
	}

	return undefined;
}

function canCollapseAuthoredKeyofAlias(type: ts.Type, checker: ts.TypeChecker): boolean {
	return (
		checker.isArrayType(type) ||
		checker.isTupleType(type) ||
		Boolean(type.flags & ts.TypeFlags.Object) ||
		type.isUnion() ||
		type.isIntersection() ||
		(type.flags &
			(ts.TypeFlags.Any |
				ts.TypeFlags.Unknown |
				ts.TypeFlags.Conditional |
				ts.TypeFlags.Index |
				ts.TypeFlags.IndexedAccess |
				ts.TypeFlags.TemplateLiteral |
				ts.TypeFlags.Literal |
				ts.TypeFlags.String |
				ts.TypeFlags.Number |
				ts.TypeFlags.ESSymbol |
				ts.TypeFlags.UniqueESSymbol |
				ts.TypeFlags.Never |
				ts.TypeFlags.Undefined)) !==
			0
	);
}

function analyzeCheckerAliasReplay(
	declaration: ts.TypeAliasDeclaration,
	checker: ts.TypeChecker,
	includeExternalTypes = false,
	seen: Set<ts.TypeAliasDeclaration> = new Set(),
): CheckerAliasReplayAnalysis {
	// Unlike the export-normalization analysis, this phase may consult checker
	// symbols because ordered type resolution has already begun. It determines
	// whether the alias's outer syntax is transparent enough for a replayed
	// operator to reach the matching container resolver.
	if (
		seen.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return { containsKeyof: false, replayable: false };
	}
	seen.add(declaration);
	const replaysConcreteArgument = concreteAliasReplaysKeyofObjectArgument(
		declaration,
		checker,
		includeExternalTypes,
	);
	const typeNode = unwrapReadonlyContainerTypeNode(declaration.type);
	const replaysCompoundReferenceArgument = isKeyofReferenceCompoundReplayableInSource(typeNode);
	const containsKeyof =
		replaysConcreteArgument ||
		replaysCompoundReferenceArgument ||
		containsKeyofTypeOperatorOrAlias(declaration.type, checker, new Set(), includeExternalTypes);
	if (
		replaysConcreteArgument ||
		replaysCompoundReferenceArgument ||
		(containsKeyofTypeOperator(declaration.type) && containsKeyof)
	) {
		return { containsKeyof, replayable: true };
	}

	const referencedDeclaration = getReferencedTypeAliasDeclaration(typeNode, checker);
	if (referencedDeclaration) {
		if (!includeExternalTypes && declarationHasNodeModulesPathSegment(referencedDeclaration)) {
			return { containsKeyof, replayable: false };
		}
		const referencedAnalysis = analyzeCheckerAliasReplay(
			referencedDeclaration,
			checker,
			includeExternalTypes,
			seen,
		);
		return {
			containsKeyof: containsKeyof || referencedAnalysis.containsKeyof,
			replayable: referencedAnalysis.replayable,
		};
	}

	const replayable =
		ts.isTypeOperatorNode(typeNode) ||
		ts.isArrayTypeNode(typeNode) ||
		ts.isTupleTypeNode(typeNode) ||
		ts.isUnionTypeNode(typeNode) ||
		ts.isIntersectionTypeNode(typeNode) ||
		ts.isConditionalTypeNode(typeNode) ||
		ts.isIndexedAccessTypeNode(typeNode);
	return { containsKeyof, replayable };
}

function concreteAliasReplaysKeyofObjectArgument(
	declaration: ts.TypeAliasDeclaration,
	checker: ts.TypeChecker,
	includeExternalTypes: boolean,
): boolean {
	if (declaration.typeParameters?.length) {
		return false;
	}
	const reference = unwrapParenthesizedTypeNode(declaration.type);
	if (!ts.isTypeReferenceNode(reference) || !reference.typeArguments?.length) {
		return false;
	}
	const target = getGenericObjectDeclaration(reference, checker);
	if (!target || (!includeExternalTypes && declarationHasNodeModulesPathSegment(target))) {
		return false;
	}

	const substitutions = new Map<ts.Symbol, ts.TypeNode>();
	for (let index = 0; index < (target.typeParameters?.length ?? 0); index += 1) {
		const parameter = target.typeParameters![index]!;
		const argument = reference.typeArguments[index] ?? parameter.default;
		if (
			!argument ||
			!containsKeyofTypeOperatorOrAlias(argument, checker, new Set(), includeExternalTypes)
		) {
			continue;
		}
		for (const symbol of [
			checker.getTypeAtLocation(parameter).symbol,
			checker.getSymbolAtLocation(parameter.name),
		]) {
			if (symbol) {
				substitutions.set(symbol, argument);
			}
		}
	}

	const targetNode = ts.isTypeAliasDeclaration(target) ? target.type : target;
	return (
		substitutions.size > 0 &&
		containsKeyofTypeNodeSubstitution(targetNode, checker, substitutions, includeExternalTypes)
	);
}

function getGenericObjectDeclaration(
	typeNode: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | ts.InterfaceDeclaration | undefined {
	const symbol = checker.getSymbolAtLocation(typeNode.typeName);
	const targetSymbol =
		symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return targetSymbol?.declarations?.find(
		(declaration): declaration is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
			(ts.isTypeAliasDeclaration(declaration) &&
				ts.isTypeLiteralNode(unwrapParenthesizedTypeNode(declaration.type))) ||
			ts.isInterfaceDeclaration(declaration),
	);
}

/** Returns the alias named by authored reference syntax, following import aliases. */
function getTypeAliasReferenceFromTypeNode(
	typeNode: ts.TypeNode | undefined,
	checker: ts.TypeChecker,
): AuthoredTypeAliasReference | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	const typeArgumentNodes =
		ts.isTypeReferenceNode(unwrapped) || ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	return declaration ? { declaration, typeArgumentNodes } : undefined;
}

/** Returns TypeScript's retained alias identity when no authored reference is available. */
function getSemanticTypeAliasReference(type: ts.Type): AuthoredTypeAliasReference | undefined {
	const declaration = type.aliasSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
	return declaration ? { declaration, typeArguments: type.aliasTypeArguments } : undefined;
}

/**
 * Builds the active generic bindings for an authored alias. Missing arguments
 * use declaration defaults in order, so a later default such as `U = T` sees
 * the concrete binding already selected for `T`.
 */
function getTypeAliasParameterSubstitutions(
	reference: AuthoredTypeAliasReference,
	context: ScopedParserContext,
): TypeParameterBindings | undefined {
	return deriveTypeParameterBindings({
		checker: context.checker,
		declarations: reference.declaration.typeParameters,
		semanticArguments: reference.typeArguments,
		authoredArguments: reference.typeArgumentNodes,
		baseTypes: context.typeParameterSubstitutions,
		baseTypeNodes: context.typeParameterTypeNodeSubstitutions,
		useDeclarationDefaults: true,
		substituteArgumentTypes: true,
		bodyForFreshSymbols: reference.declaration.type,
	});
}

function getAuthoredAliasReference(
	{ type, typeNode }: TypeResolutionRequest,
	checker: ts.TypeChecker,
): AuthoredTypeAliasReference | undefined {
	const authoredReference = getTypeAliasReferenceFromTypeNode(typeNode, checker);
	if (authoredReference) {
		return authoredReference;
	}

	// A concrete body node must be resolved as written. Falling back to the
	// semantic alias here would re-enter the alias while replaying its own body.
	return typeNode ? undefined : getSemanticTypeAliasReference(type);
}

function getOuterAliasTypeName(
	{ type, typeName }: TypeResolutionRequest,
	referencedDeclaration: ts.TypeAliasDeclaration,
): TypeName | undefined {
	const semanticDeclaration = type.aliasSymbol?.declarations?.find(ts.isTypeAliasDeclaration);
	if (!type.aliasSymbol || !semanticDeclaration || semanticDeclaration === referencedDeclaration) {
		return typeName;
	}

	const typeArgumentCount = semanticDeclaration.typeParameters?.length ?? 0;
	return new TypeName(
		type.aliasSymbol.name,
		typeName?.namespaces,
		typeArgumentCount > 0 ? typeName?.typeArguments?.slice(0, typeArgumentCount) : undefined,
	);
}
