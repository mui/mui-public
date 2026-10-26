import ts from 'typescript';
import { TupleNode, type AnyType } from '../../models';
import {
	isRestTupleElementNode,
	isSemanticallyReadonlyTuple,
	unwrapTupleElementSyntax,
} from '../typeContainerUtils';
import { declarationHasNodeModulesPathSegment } from '../sourceFileUtils';
import { deriveTypeParameterBindings } from '../typeParameterBindings';
import { type TypeResolutionRequest, type TypeResolutionSession } from '../typeResolutionTypes';
import { getArrayElementTypeNode } from './arrayTypeResolver';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';
import {
	getPreservableKeyofTypeNode,
	substituteTypeParameterTypeNode,
	unwrapParenthesizedTypeNode,
	unwrapReadonlyContainerTypeNode,
} from './typeOperatorTypeNodes';

/**
 * Resolves tuples while mapping expanded semantic elements back to authored tuple syntax.
 *
 * @param request - Semantic tuple candidate, public name, and optional authored syntax.
 * @param session - Active resolution session used for element substitutions.
 * @returns A tuple model when the checker recognizes the type as a tuple, otherwise `undefined`.
 */
export function resolveTupleType(
	request: TypeResolutionRequest,
	session: TypeResolutionSession,
): AnyType | undefined {
	const { type, typeName, typeNode } = request;
	const { checker } = session.context;

	if (!checker.isTupleType(type)) {
		return undefined;
	}

	const elementTypes = (type as ts.TupleType).typeArguments ?? [];
	const nestedPlanCache = createTupleElementSelectionPlanCache();
	const syntaxPlan = buildTupleElementSelectionPlan(
		typeNode,
		elementTypes.length,
		checker,
		session.context.typeParameterSubstitutions,
		session.context.typeParameterTypeNodeSubstitutions,
		session.context.includeExternalTypes,
		nestedPlanCache,
	);
	return new TupleNode(
		typeName,
		elementTypes.map((elementType, index) => {
			const syntax = resolveTupleElementSyntax(
				syntaxPlan?.[index],
				checker,
				session.context.typeParameterSubstitutions,
				session.context.typeParameterTypeNodeSubstitutions,
				session.context.includeExternalTypes,
				new Map(),
				nestedPlanCache,
			);
			const resolveElement = () => session.resolve(elementType, syntax?.typeNode);
			return syntax?.typeParameterSubstitutions
				? session.context.runWithTypeParameterSubstitutionScope(
						syntax.typeParameterSubstitutions,
						resolveElement,
						syntax.typeParameterTypeNodeSubstitutions,
					)
				: resolveElement();
		}),
		isReadonlyTupleType(type, typeNode) ? true : undefined,
	);
}

function isReadonlyTupleType(type: ts.Type, typeNode: ts.TypeNode | undefined): boolean {
	if (isSemanticallyReadonlyTuple(type)) {
		return true;
	}
	if (!typeNode) {
		return false;
	}

	const unwrapped = unwrapParenthesizedTypeNode(typeNode);
	return (
		ts.isTypeOperatorNode(unwrapped) &&
		unwrapped.operator === ts.SyntaxKind.ReadonlyKeyword &&
		ts.isTupleTypeNode(unwrapParenthesizedTypeNode(unwrapped.type))
	);
}

function resolveTupleElementSyntax(
	selection: TupleElementSelection | undefined,
	checker: ts.TypeChecker,
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
	seenTupleSourceInstantiations: Map<ts.TupleTypeNode, Set<string>> = new Map(),
	nestedPlanCache: TupleElementSelectionPlanCache = createTupleElementSelectionPlanCache(),
): TupleElementSyntax | undefined {
	let element = selection?.typeNode;
	let isRest = false;
	if (element) {
		const syntax = unwrapTupleElementSyntax(element);
		element = syntax.typeNode;
		isRest = syntax.isRest;
	}
	if (!element) {
		return undefined;
	}
	if (isRest) {
		const substitutedRestType = substituteTypeParameterTypeNode(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
		);
		const tupleSource = getTupleTypeNodeSource(
			substitutedRestType,
			checker,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
		);
		if (tupleSource && selection?.restSemanticIndex != null) {
			const instantiationKey = getTupleSourceInstantiationKey(
				selection,
				tupleSource.typeParameterTypeNodeSubstitutions,
			);
			if (seenTupleSourceInstantiations.get(tupleSource.typeNode)?.has(instantiationKey)) {
				return undefined;
			}
			const nestedPlan = getCachedTupleElementSelectionPlan(
				tupleSource.typeNode,
				selection.restSemanticElementCount,
				checker,
				tupleSource.typeParameterSubstitutions,
				tupleSource.typeParameterTypeNodeSubstitutions,
				includeExternalTypes,
				nestedPlanCache,
			);
			const nestedSelection = nestedPlan?.[selection.restSemanticIndex];
			if (!nestedSelection) {
				return undefined;
			}

			// A finite rest alias can itself contain several spreads. Reusing the
			// complete selection plan preserves the exact authored segment instead
			// of collapsing every middle element onto the first rest node.
			const nextSeenTupleSourceInstantiations = markTupleSourceInstantiationSeen(
				seenTupleSourceInstantiations,
				tupleSource.typeNode,
				instantiationKey,
			);
			return resolveTupleElementSyntax(
				nestedSelection,
				checker,
				tupleSource.typeParameterSubstitutions,
				tupleSource.typeParameterTypeNodeSubstitutions,
				includeExternalTypes,
				nextSeenTupleSourceInstantiations,
				nestedPlanCache,
			);
		} else {
			element = substitutedRestType;
		}
		const restElementType = getArrayElementTypeNode(
			element,
			checker,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
		);
		if (restElementType) {
			return {
				typeNode: restElementType,
				typeParameterSubstitutions,
				typeParameterTypeNodeSubstitutions,
			};
		}
	}
	element = getPreservableKeyofTypeNode(
		element,
		checker,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
	);
	if (!element) {
		return undefined;
	}
	if (isRest) {
		const restTypeNode =
			getArrayElementTypeNode(
				element,
				checker,
				typeParameterTypeNodeSubstitutions,
				includeExternalTypes,
			) ?? element;
		return {
			typeNode: restTypeNode,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
		};
	}

	return {
		typeNode: element,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
	};
}

/**
 * Identifies one tuple-source traversal by its semantic slot and authored
 * generic bindings. A declaration-only key would mistake
 * `Spread<Spread<[T]>>` for a cycle when the second visit carries a narrower
 * argument, while a true recursive alias eventually repeats the same key.
 */
function getTupleSourceInstantiationKey(
	selection: TupleElementSelection,
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): string {
	return `${selection.restSemanticIndex}/${selection.restSemanticElementCount}:${getTupleSourceBindingsKey(
		typeNodeSubstitutions,
	)}`;
}

/**
 * Records one tuple-source instantiation on a copy of the caller's seen map.
 * Copying keeps the record path-sensitive: sibling elements must each be free
 * to visit the same source under their own bindings.
 *
 * @param seenTupleSourceInstantiations - Instantiations already visited on this path.
 * @param tupleTypeNode - Tuple source being entered.
 * @param instantiationKey - Key identifying the source's authored bindings.
 * @returns A copy that also contains the supplied instantiation.
 */
function markTupleSourceInstantiationSeen(
	seenTupleSourceInstantiations: Map<ts.TupleTypeNode, Set<string>>,
	tupleTypeNode: ts.TupleTypeNode,
	instantiationKey: string,
): Map<ts.TupleTypeNode, Set<string>> {
	const next = new Map(seenTupleSourceInstantiations);
	const sourceInstantiations = new Set(next.get(tupleTypeNode));
	sourceInstantiations.add(instantiationKey);
	next.set(tupleTypeNode, sourceInstantiations);
	return next;
}

function getTupleSourceBindingsKey(
	typeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
): string {
	return [...(typeNodeSubstitutions ?? [])]
		.map(([symbol, typeNode]) => {
			const declaration = symbol.declarations?.[0];
			const declarationLocation = declaration ? getNodeIdentityKey(declaration) : symbol.name;
			return `${declarationLocation}=${getNodeIdentityKey(typeNode)}`;
		})
		.sort()
		.join('|');
}

/**
 * Identifies a node for binding keys. Source positions identify authored nodes,
 * but mapped-property replay binds synthetic literal nodes built with
 * `ts.factory` (see `getMappedPropertyKeyBinding` in `objectTypeResolver.ts`).
 * Those carry no parent chain, so `getSourceFile()` yields `undefined` and every
 * synthetic node shares the same `-1` positions. Literal text distinguishes
 * them, which keeps distinct mapped keys from colliding into a false cycle.
 */
function getNodeIdentityKey(node: ts.Node): string {
	const sourceFile = node.getSourceFile() as ts.SourceFile | undefined;
	if (sourceFile) {
		return `${sourceFile.fileName}:${node.pos}:${node.end}`;
	}
	if (ts.isLiteralTypeNode(node)) {
		const literal = node.literal;
		const text =
			ts.isStringLiteral(literal) || ts.isNumericLiteral(literal)
				? literal.text
				: (ts.tokenToString(literal.kind) ?? '');
		return `synthetic:${literal.kind}:${text}`;
	}
	return `synthetic:${node.kind}`;
}

interface TupleElementSyntax {
	typeNode: ts.TypeNode;
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>;
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>;
}

interface TupleElementSelection {
	typeNode: ts.TypeNode;
	restSemanticIndex?: number;
	restSemanticElementCount: number;
}

type TupleElementSelectionPlan = (TupleElementSelection | undefined)[] | undefined;
interface TupleElementSelectionPlanCache {
	plans: Map<ts.TupleTypeNode, Map<string, TupleElementSelectionPlan>>;
	semanticTypeIds: WeakMap<ts.Type, number>;
	nextSemanticTypeId: number;
}

function createTupleElementSelectionPlanCache(): TupleElementSelectionPlanCache {
	return {
		plans: new Map(),
		semanticTypeIds: new WeakMap(),
		nextSemanticTypeId: 0,
	};
}

/**
 * Reuses a nested tuple plan across every semantic element attributed to the
 * same finite spread. The cache lives for one `resolveTupleType` call so syntax
 * nodes and checker substitutions cannot leak between independent exports.
 */
function getCachedTupleElementSelectionPlan(
	tupleTypeNode: ts.TupleTypeNode,
	semanticElementCount: number,
	checker: ts.TypeChecker,
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	cache: TupleElementSelectionPlanCache,
): TupleElementSelectionPlan {
	let sourcePlans = cache.plans.get(tupleTypeNode);
	if (!sourcePlans) {
		sourcePlans = new Map();
		cache.plans.set(tupleTypeNode, sourcePlans);
	}
	const cacheKey = [
		semanticElementCount,
		getTupleSourceBindingsKey(typeParameterTypeNodeSubstitutions),
		getTupleSourceSemanticBindingsKey(typeParameterSubstitutions, cache),
	].join(':');
	if (sourcePlans.has(cacheKey)) {
		return sourcePlans.get(cacheKey);
	}

	const plan = buildTupleElementSelectionPlan(
		tupleTypeNode,
		semanticElementCount,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
		cache,
	);
	sourcePlans.set(cacheKey, plan);
	return plan;
}

function getTupleSourceSemanticBindingsKey(
	typeSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	cache: TupleElementSelectionPlanCache,
): string {
	return [...(typeSubstitutions ?? [])]
		.map(([symbol, type]) => {
			let typeId = cache.semanticTypeIds.get(type);
			if (typeId == null) {
				typeId = cache.nextSemanticTypeId;
				cache.nextSemanticTypeId += 1;
				cache.semanticTypeIds.set(type, typeId);
			}
			const declaration = symbol.declarations?.[0];
			const symbolLocation = declaration ? getNodeIdentityKey(declaration) : symbol.name;
			return `${symbolLocation}=${typeId}`;
		})
		.sort()
		.join('|');
}

/**
 * Builds the complete authored-to-semantic tuple selection plan once. When
 * every spread has a statically known tuple width, exact offsets are expanded
 * into one selection per checker element. Otherwise each open rest accounts
 * for at least one checker element, and any remaining elements are attributed
 * to the first open rest. Known finite spreads still retain their full widths,
 * which keeps suffix syntax aligned after an open rest.
 *
 * Keeping width and rest-alias discovery outside the element-resolution loop is
 * important for long finite variadic tuples: following a 2,000-element rest
 * alias once is linear, while recomputing its width for every semantic element
 * is quadratic.
 */
function buildTupleElementSelectionPlan(
	typeNode: ts.TypeNode | undefined,
	semanticElementCount: number,
	checker: ts.TypeChecker,
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>,
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>,
	includeExternalTypes = false,
	cache: TupleElementSelectionPlanCache = createTupleElementSelectionPlanCache(),
): (TupleElementSelection | undefined)[] | undefined {
	if (!typeNode) {
		return undefined;
	}

	const unwrapped = unwrapReadonlyContainerTypeNode(
		typeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	if (!ts.isTupleTypeNode(unwrapped)) {
		return undefined;
	}
	const tupleTypeNode = unwrapped;
	const widths = tupleTypeNode.elements.map((element) =>
		getKnownTupleElementWidth(
			element,
			checker,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
			new Map(),
			cache,
		),
	);
	if (
		widths.every((width): width is number => width != null) &&
		widths.reduce((total, width) => total + width, 0) === semanticElementCount
	) {
		return expandTupleElementSelections(tupleTypeNode, widths);
	}

	const firstOpenRestIndex = widths.findIndex((width) => width == null);
	const minimumWidths = widths.map((width) => width ?? 1);
	const minimumElementCount = minimumWidths.reduce((total, width) => total + width, 0);
	if (firstOpenRestIndex === -1 || minimumElementCount > semanticElementCount) {
		return undefined;
	}

	minimumWidths[firstOpenRestIndex]! += semanticElementCount - minimumElementCount;
	return expandTupleElementSelections(tupleTypeNode, minimumWidths);
}

/**
 * Expands one authored selection per semantic tuple element using the supplied
 * widths. Rest selections carry their local index so nested finite tuple aliases
 * can select the matching authored member during element resolution.
 */
function expandTupleElementSelections(
	tupleTypeNode: ts.TupleTypeNode,
	widths: readonly number[],
): TupleElementSelection[] {
	const selections: TupleElementSelection[] = [];
	for (let authoredIndex = 0; authoredIndex < tupleTypeNode.elements.length; authoredIndex += 1) {
		const element = tupleTypeNode.elements[authoredIndex]!;
		const width = widths[authoredIndex]!;
		for (let restSemanticIndex = 0; restSemanticIndex < width; restSemanticIndex += 1) {
			selections.push({
				typeNode: element,
				restSemanticIndex: isRestTupleElementNode(element) ? restSemanticIndex : undefined,
				restSemanticElementCount: width,
			});
		}
	}
	return selections;
}

/**
 * Computes the semantic width of an authored tuple element. Fixed elements are
 * one slot; rest elements have a known width only when their substituted type
 * can be followed to a finite tuple. Recursion is keyed by the tuple source and
 * its authored and semantic bindings so separate generic instantiations do not
 * collide while true recursive aliases remain open-width.
 */
function getKnownTupleElementWidth(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	seenTupleSourceInstantiations: Map<ts.TupleTypeNode, Set<string>>,
	cache: TupleElementSelectionPlanCache,
): number | undefined {
	if (!isRestTupleElementNode(typeNode)) {
		return 1;
	}

	const restTypeNode = unwrapTupleElementSyntax(typeNode).typeNode;
	const substituted = substituteTypeParameterTypeNode(
		restTypeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const tupleSource = getTupleTypeNodeSource(
		substituted,
		checker,
		typeParameterSubstitutions,
		typeParameterTypeNodeSubstitutions,
		includeExternalTypes,
	);
	if (!tupleSource) {
		return undefined;
	}
	const instantiationKey = [
		getTupleSourceBindingsKey(tupleSource.typeParameterTypeNodeSubstitutions),
		getTupleSourceSemanticBindingsKey(tupleSource.typeParameterSubstitutions, cache),
	].join(':');
	if (seenTupleSourceInstantiations.get(tupleSource.typeNode)?.has(instantiationKey)) {
		return undefined;
	}
	const nestedSeenTupleSourceInstantiations = markTupleSourceInstantiationSeen(
		seenTupleSourceInstantiations,
		tupleSource.typeNode,
		instantiationKey,
	);
	const widths = tupleSource.typeNode.elements.map((element) =>
		getKnownTupleElementWidth(
			element,
			checker,
			tupleSource.typeParameterSubstitutions,
			tupleSource.typeParameterTypeNodeSubstitutions,
			includeExternalTypes,
			nestedSeenTupleSourceInstantiations,
			cache,
		),
	);
	return widths.every((width): width is number => width != null)
		? widths.reduce((total, width) => total + width, 0)
		: undefined;
}

interface TupleTypeNodeSource {
	typeNode: ts.TupleTypeNode;
	typeParameterSubstitutions?: Map<ts.Symbol, ts.Type>;
	typeParameterTypeNodeSubstitutions?: Map<ts.Symbol, ts.TypeNode>;
}

/**
 * Follows a tuple alias chain while carrying both semantic and authored generic
 * bindings. Defaults and earlier bindings are applied before descending so a
 * nested rest alias is interpreted in the same instantiation as the checker
 * tuple whose elements are being mapped.
 */
function getTupleTypeNodeSource(
	typeNode: ts.TypeNode,
	checker: ts.TypeChecker,
	typeParameterSubstitutions: Map<ts.Symbol, ts.Type> | undefined,
	typeParameterTypeNodeSubstitutions: Map<ts.Symbol, ts.TypeNode> | undefined,
	includeExternalTypes: boolean,
	seenAliases: Set<ts.TypeAliasDeclaration> = new Set(),
): TupleTypeNodeSource | undefined {
	const substituted = substituteTypeParameterTypeNode(
		typeNode,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	const unwrapped = unwrapReadonlyContainerTypeNode(
		substituted,
		checker,
		typeParameterTypeNodeSubstitutions,
	);
	if (ts.isTupleTypeNode(unwrapped)) {
		return {
			typeNode: unwrapped,
			typeParameterSubstitutions,
			typeParameterTypeNodeSubstitutions,
		};
	}
	const declaration = getReferencedTypeAliasDeclaration(unwrapped, checker);
	if (
		!declaration ||
		seenAliases.has(declaration) ||
		(!includeExternalTypes && declarationHasNodeModulesPathSegment(declaration))
	) {
		return undefined;
	}

	const nextAliases = new Set(seenAliases);
	nextAliases.add(declaration);
	const typeArguments = ts.isTypeReferenceNode(unwrapped)
		? unwrapped.typeArguments
		: ts.isImportTypeNode(unwrapped)
			? unwrapped.typeArguments
			: undefined;
	const bindings = deriveTypeParameterBindings({
		checker,
		declarations: declaration.typeParameters,
		authoredArguments: typeArguments,
		baseTypes: typeParameterSubstitutions,
		baseTypeNodes: typeParameterTypeNodeSubstitutions,
		useDeclarationDefaults: true,
		substituteArgumentTypes: true,
	});

	return getTupleTypeNodeSource(
		declaration.type,
		checker,
		bindings?.types ?? new Map(typeParameterSubstitutions),
		bindings?.typeNodes ?? new Map(typeParameterTypeNodeSubstitutions),
		includeExternalTypes,
		nextAliases,
	);
}
