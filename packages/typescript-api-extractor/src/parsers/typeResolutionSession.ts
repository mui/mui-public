import ts from 'typescript';
import { IntrinsicNode, type AnyType } from '../models';
import { type ScopedParserContext } from '../parserContext';
import { getFullNameWithSymbol } from './common';
import { reportUnsupportedTypeFallback } from './typeResolutionDiagnostics';
import {
	type NameResolutionWarning,
	type ResolveTypeInContext,
	type TypeResolver,
	type TypeResolutionRequest,
	type TypeResolutionSession as TypeResolutionSessionContract,
} from './typeResolutionTypes';
import { typeResolvers } from './typeResolvers';
import { createShallowType, getTypeId, hasExactFlag } from './typeResolutionUtils';
import { resolveSubstitutionFallback } from './typeResolvers/specialTypeResolvers';
import {
	getAuthoredHeritageBindings,
	getAuthoredTypeReferenceBindings,
} from './authoredTypeReferenceBindings';

const unsupportedFallbackTypes = new WeakSet<ts.Type>();

/**
 * Concrete orchestration for one public resolve call. Resolver modules own
 * individual TypeScript shapes; this session owns the cross-cutting mechanics:
 * cache keys, recursion guards, substitution probes, and warning replay.
 */
export class TypeResolutionSession implements TypeResolutionSessionContract {
	/**
	 * Creates a resolution session around one scoped parser context.
	 *
	 * @param context - Context whose caches, scopes, and policy callbacks are shared by nested work.
	 */
	constructor(readonly context: ScopedParserContext) {}

	/**
	 * Adapter passed to lower-level parsers that still accept a resolver callback.
	 * Reuses this session for the same ParserContext so nested resolutions share
	 * the active cache, cycle stack, substitutions, and warning interception.
	 *
	 * @param type - Semantic type to resolve.
	 * @param typeNode - Optional authored syntax associated with the type.
	 * @param context - Context requested by the lower-level parser.
	 * @returns The extracted model type.
	 */
	readonly resolveWithContext: ResolveTypeInContext = (type, typeNode, context) => {
		if (context === this.context) {
			return this.resolve(type, typeNode);
		}

		return new TypeResolutionSession(context).resolve(type, typeNode);
	};

	/**
	 * Resolves a semantic type through the session's cache and resolver pipeline.
	 *
	 * @param type - Semantic checker type to resolve.
	 * @param typeNode - Optional authored syntax that can steer source-preserving resolvers.
	 * @returns The extracted model type.
	 */
	resolve(type: ts.Type, typeNode: ts.TypeNode | undefined): AnyType {
		const { resolvedTypeCache, typeStack, propertyDepth } = this.context;

		const typeId = getTypeId(type);

		// Build a cache key that incorporates the type identity and both depth
		// counters, because shouldResolveObject / shouldInclude are depth-sensitive:
		// the same type resolves to a different shape as an export's own type than
		// it does nested under someone's property.
		const cacheKey =
			typeId !== undefined ? `${typeId}@${typeStack.length}:${propertyDepth}` : undefined;

		if (
			cacheKey !== undefined &&
			this.isCacheable(type, typeNode, typeId!) &&
			resolvedTypeCache.has(cacheKey)
		) {
			return resolvedTypeCache.get(cacheKey)!;
		}

		const result = this.resolveUncached(type, typeNode);

		// Re-check cacheability after resolution: resolveUncached may have marked
		// this type as an unsupported fallback, which must not be memoized.
		if (cacheKey !== undefined && this.isCacheable(type, typeNode, typeId!)) {
			resolvedTypeCache.set(cacheKey, result);
		}

		return result;
	}

	/**
	 * Dispatches recovered syntax without entering the normal cache/cycle path again.
	 *
	 * @param request - Active semantic type paired with recovered authored syntax.
	 * @returns The first resolver result, if a resolver accepts the request.
	 */
	resolveWithSyntax(request: TypeResolutionRequest): AnyType | undefined {
		return this.dispatch(request)?.resolvedType;
	}

	/**
	 * Replays syntax-aware resolvers before falling back to semantic resolution.
	 *
	 * @param request - Semantic and authored inputs for the replay attempt.
	 * @returns The replayed model or the normal resolution fallback.
	 */
	resolveAuthoredSyntax(request: TypeResolutionRequest): AnyType {
		const { authoredSyntaxStack } = this.context;
		const { typeNode } = request;

		// Replayed syntax can select a source that is the node being replayed, as
		// in `interface Foo { a: Foo['a' | 'b'] }`. Cycle detection lives in the
		// semantic path, which a successful replay returns before reaching, so the
		// replay chain carries its own frame. Re-entry drops the node rather than
		// passing it on: every replaying resolver keys off authored syntax, so
		// keeping it would route straight back into the same cycle. The checker's
		// own expansion of the type stands in instead.
		if (typeNode && authoredSyntaxStack.includes(typeNode)) {
			return this.resolve(request.type, undefined);
		}

		if (typeNode) {
			authoredSyntaxStack.push(typeNode);
		}
		try {
			return (
				this.dispatch(request, (resolver) => resolver.replaysAuthoredSyntax === true)
					?.resolvedType ?? this.resolve(request.type, request.typeNode)
			);
		} finally {
			if (typeNode) {
				authoredSyntaxStack.pop();
			}
		}
	}

	/**
	 * Checks the active recursion stack for a checker type's private identity.
	 *
	 * @param type - Checker type to inspect.
	 * @returns Whether the type already has an active frame.
	 */
	isTypeActive(type: ts.Type): boolean {
		const typeId = getTypeId(type);
		return typeId !== undefined && this.context.typeStack.includes(typeId);
	}

	/**
	 * Executes nested resolution inside a balanced recursion frame.
	 *
	 * Types without an internal identity, and types already framed by their
	 * caller, execute directly so the session never pushes duplicate frames.
	 *
	 * @param type - Checker type that owns the frame.
	 * @param callback - Nested resolution work.
	 * @returns The callback result.
	 */
	runWithTypeFrame<T>(type: ts.Type, callback: () => T): T {
		const typeId = getTypeId(type);
		if (typeId === undefined || this.context.typeStack.includes(typeId)) {
			return callback();
		}

		this.context.typeStack.push(typeId);
		try {
			return callback();
		} finally {
			this.context.typeStack.pop();
		}
	}

	/**
	 * A single type id can resolve to different model nodes depending on context,
	 * so memoizing is only safe when none of those influences are in play: an
	 * associated typeNode can steer alias resolution, active type-parameter
	 * substitutions change member types, the unsupported fallback emits
	 * context-specific warnings, and a type currently on the recursion stack would
	 * cache a shallow placeholder instead of its full shape.
	 */
	private isCacheable(type: ts.Type, typeNode: ts.TypeNode | undefined, typeId: number): boolean {
		const { typeStack, typeParameterSubstitutions } = this.context;

		return (
			!typeNode &&
			!typeParameterSubstitutions?.size &&
			!unsupportedFallbackTypes.has(type) &&
			!typeStack.includes(typeId)
		);
	}

	private resolveUncached(type: ts.Type, typeNode: ts.TypeNode | undefined): AnyType {
		const { context } = this;
		const { checker } = context;

		const typeId = getTypeId(type);

		// Only structural types participate in cycle detection. Intrinsics reuse the
		// same checker identity freely and cannot recurse through nested members, so
		// framing them would produce false shallow placeholders.
		const isIntrinsicType =
			(type.flags &
				(ts.TypeFlags.Any |
					ts.TypeFlags.Unknown |
					ts.TypeFlags.String |
					ts.TypeFlags.Number |
					ts.TypeFlags.Literal |
					ts.TypeFlags.Boolean |
					ts.TypeFlags.ESSymbol |
					ts.TypeFlags.UniqueESSymbol |
					ts.TypeFlags.Never |
					ts.TypeFlags.Undefined |
					ts.TypeFlags.Null |
					ts.TypeFlags.Void |
					ts.TypeFlags.BigInt)) !==
			0;

		// Detect the cycle before pushing. A repeated structural identity resolves to
		// a shallow node that keeps its public name but omits recursive members.
		const shouldDetectCycles = !isIntrinsicType && typeId !== undefined;
		const isAlreadyOnStack = shouldDetectCycles && this.isTypeActive(type);

		// Enter the type frame BEFORE calling getFullName to catch cycles that occur
		// when getFullName resolves generic type arguments that may reference back to this type.
		const resolveInFrame = () => {
			let fullName: ReturnType<typeof getFullNameWithSymbol>;

			// SubstitutionTypes are checker-internal placeholders created while TypeScript
			// evaluates conditional/infer/mapped types. They represent "baseType, but
			// under this constraint" rather than a syntax form we can emit directly.
			// Try this before getFullName(), which may resolve type arguments and emit
			// warnings that would be misleading if the substitution fallback succeeds.
			if (!isAlreadyOnStack && hasExactFlag(type, ts.TypeFlags.Substitution)) {
				const substitutionFallback = resolveSubstitutionFallback(type, this);
				if (substitutionFallback) {
					return substitutionFallback;
				}
			}

			const nameResolutionWarnings: NameResolutionWarning[] = [];
			if (hasExactFlag(type, ts.TypeFlags.Conditional)) {
				const onWarning = context.onWarning;
				context.onWarning = (warning) => {
					nameResolutionWarnings.push(warning);
				};
				try {
					fullName = getFullNameWithSymbol(type, typeNode, context);
				} finally {
					context.onWarning = onWarning;
				}
			} else {
				fullName = getFullNameWithSymbol(type, typeNode, context);
			}
			const typeName = fullName?.typeName;

			const replayNameResolutionWarnings = () => {
				for (const warning of nameResolutionWarnings) {
					context.onWarning(warning);
				}
				nameResolutionWarnings.length = 0;
			};

			// Conditional type name resolution may emit warnings for type arguments.
			// Replay them only on return paths that keep the computed typeName.
			const withNameResolutionWarnings = <T extends AnyType>(resolvedType: T): T => {
				replayNameResolutionWarnings();
				return resolvedType;
			};

			// If this type was already on the stack, return a shallow version with type info but no properties.
			if (isAlreadyOnStack) {
				return withNameResolutionWarnings(createShallowType(type, typeName, checker));
			}

			const request: TypeResolutionRequest = {
				type,
				typeNode,
				typeName,
				typeNameSymbol: fullName?.symbol,
			};
			const resolution = this.dispatch(request);
			if (resolution) {
				return resolution.resolver.replayNameResolutionWarnings === false
					? resolution.resolvedType
					: withNameResolutionWarnings(resolution.resolvedType);
			}

			unsupportedFallbackTypes.add(type);
			for (const warning of nameResolutionWarnings) {
				context.onWarning(warning);
			}
			reportUnsupportedTypeFallback(type, typeNode, context);

			return new IntrinsicNode('any', typeName);
		};

		return shouldDetectCycles && !isAlreadyOnStack
			? this.runWithTypeFrame(type, resolveInFrame)
			: resolveInFrame();
	}

	private dispatch(
		request: TypeResolutionRequest,
		shouldAttempt: (resolver: TypeResolver) => boolean = () => true,
	): { resolver: TypeResolver; resolvedType: AnyType } | undefined {
		const dispatchResolvers = () => {
			for (const resolver of typeResolvers) {
				if (!shouldAttempt(resolver)) {
					continue;
				}

				const resolvedType = resolver.resolve(request, this);
				if (resolvedType) {
					return { resolver, resolvedType };
				}
			}

			return undefined;
		};
		const { typeParameterSubstitutions, typeParameterTypeNodeSubstitutions } = this.context;
		const baseBindings =
			typeParameterSubstitutions?.size || typeParameterTypeNodeSubstitutions?.size
				? {
						// Binding derivation copies its base maps before extending them, so
						// dispatch can reuse the active scope without cloning it for every
						// nested property or signature that needs no new binding.
						types: typeParameterSubstitutions ?? new Map<ts.Symbol, ts.Type>(),
						typeNodes: typeParameterTypeNodeSubstitutions,
					}
				: undefined;
		const referenceBindings = getAuthoredTypeReferenceBindings(
			request.typeNode,
			this.context.checker,
			this.context.includeExternalTypes,
			baseBindings,
		);
		// The reference walker already follows heritage from its terminal declaration.
		// Checker-declaration lookup is only needed when dispatch has no authored root
		// reference, as with directly exported interfaces and classes.
		const bindings =
			referenceBindings ??
			getAuthoredHeritageBindings(
				request.type,
				this.context.checker,
				this.context.includeExternalTypes,
				baseBindings,
			);
		// Generic aliases can replace their own parameter symbols with different
		// symbols declared by a terminal interface, class, or callable. Scope the
		// complete resolver dispatch once so every shape and its nested members see
		// the same authored argument instead of re-deriving bindings independently.
		return bindings
			? this.context.runWithTypeParameterSubstitutionScope(
					bindings.types,
					dispatchResolvers,
					bindings.typeNodes,
				)
			: dispatchResolvers();
	}
}
