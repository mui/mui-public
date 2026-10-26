import ts from 'typescript';
import { type AnyType } from '../models';
import { type TypeName } from '../models/typeName';
import { type ScopedParserContext } from '../parserContext';

/**
 * Resolves a checker type using an explicitly supplied parser context.
 *
 * Resolver modules choose how a `ts.Type` enters the model and own pipeline
 * precedence, warning replay, session-aware recursion, and model construction
 * for their type class. Shared helpers stay small and serve substructures such
 * as signature type parameters rather than top-level type shapes.
 *
 * @param type - Semantic TypeScript type to convert.
 * @param typeNode - Optional authored syntax that can preserve source-level intent.
 * @param context - Active scoped parser context.
 * @returns The extracted model type.
 */
export type ResolveTypeInContext = (
	type: ts.Type,
	typeNode: ts.TypeNode | undefined,
	context: ScopedParserContext,
) => AnyType;

/** Warning captured while TypeScript type-name metadata is being resolved. */
export type NameResolutionWarning = Parameters<ScopedParserContext['onWarning']>[0];

/** Inputs supplied to each ordered type resolver. */
export interface TypeResolutionRequest {
	/** Semantic checker type being resolved. */
	type: ts.Type;
	/** Optional authored syntax associated with the semantic type. */
	typeNode: ts.TypeNode | undefined;
	/** Public type name derived before resolver dispatch. */
	typeName: TypeName | undefined;
	/** Symbol whose name `typeName` carries, when known. */
	typeNameSymbol?: ts.Symbol;
}

/**
 * Session contract shared by resolver modules. Keeping this as an interface
 * lets individual resolver groups recurse without importing the concrete
 * orchestration class, which avoids turning the split modules into a cycle.
 */
export interface TypeResolutionSession {
	/** Scoped context shared by the complete nested resolution chain. */
	readonly context: ScopedParserContext;
	/**
	 * Adapter for helpers that accept a context-aware resolver callback.
	 *
	 * @param type - Semantic TypeScript type to convert.
	 * @param typeNode - Optional authored syntax associated with the type.
	 * @param context - Scoped context requested by the helper.
	 * @returns The extracted model type.
	 */
	readonly resolveWithContext: ResolveTypeInContext;
	/**
	 * Resolves a semantic type through caching, cycle detection, and ordered dispatch.
	 *
	 * @param type - Semantic type to resolve.
	 * @param typeNode - Optional authored syntax associated with the type.
	 * @returns The extracted model type.
	 */
	resolve(type: ts.Type, typeNode: ts.TypeNode | undefined): AnyType;
	/**
	 * Re-dispatches an active type against recovered syntax without pushing a second cycle frame.
	 *
	 * @param request - Semantic type plus the recovered authored syntax.
	 * @returns The first model produced by the resolver registry, if any.
	 */
	resolveWithSyntax(request: TypeResolutionRequest): AnyType | undefined;
	/**
	 * Tries syntax-replay resolvers before entering the normal cached resolution path.
	 *
	 * @param request - Semantic and authored inputs for syntax-first replay.
	 * @returns The replayed model, or the normal semantic resolution as a fallback.
	 */
	resolveAuthoredSyntax(request: TypeResolutionRequest): AnyType;
	/**
	 * Checks whether a semantic type already has an active cycle frame.
	 *
	 * @param type - Checker type whose private identity should be inspected.
	 * @returns Whether that identity is present on the active type stack.
	 */
	isTypeActive(type: ts.Type): boolean;
	/**
	 * Runs a nested resolution inside a balanced cycle frame when the type has an identity.
	 *
	 * @param type - Checker type whose identity defines the frame.
	 * @param callback - Nested resolution work to execute.
	 * @returns The callback result.
	 */
	runWithTypeFrame<T>(type: ts.Type, callback: () => T): T;
}

/** One ordered strategy in the semantic type-resolution pipeline. */
export interface TypeResolver {
	/**
	 * Human-readable resolver identity. This is intentionally kept in the source
	 * so the pipeline can be debugged or profiled without guessing which branch
	 * handled a type.
	 */
	name: string;
	/**
	 * Most resolvers keep the TypeName computed before dispatching and should
	 * replay any warnings produced while deriving that name. A resolver can opt
	 * out when it intentionally discards the computed name, such as conditional
	 * and index-like fallbacks that resolve to a different underlying type.
	 */
	replayNameResolutionWarnings?: boolean;
	/** Resolver participates in authored syntax replay before semantic fallback. */
	replaysAuthoredSyntax?: boolean;
	/**
	 * Attempts to resolve the request's `ts.Type` into a model node. Returns
	 * `undefined` to decline, which lets the pipeline fall through to the next
	 * resolver; this is how precedence between overlapping TypeScript shapes works.
	 *
	 * @param request - Semantic type, optional syntax, and precomputed public name.
	 * @param session - Active resolution session used for nested types and scopes.
	 * @returns A model node when this strategy applies, otherwise `undefined`.
	 */
	resolve(request: TypeResolutionRequest, session: TypeResolutionSession): AnyType | undefined;
}
