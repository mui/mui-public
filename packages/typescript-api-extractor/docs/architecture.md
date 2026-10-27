# Architecture

The parser code is split into a few layers. Type-class modules live in the
resolver pipeline: each one chooses whether a TypeScript type shape applies and
constructs the corresponding output model node. Shared helpers exist only for
substructures that are reused across multiple type classes.

## Architecture Principles

- Keep normalization and construction as separate phases. Export parsing first
  creates `ExportDescriptor` records, then converts them into `ExportNode`
  models once export targeting, namespace metadata, and re-export metadata are
  stable.
- Keep type resolution as an ordered pipeline. Resolver order is observable for
  overlapping TypeScript shapes, so broad fallback resolvers should stay behind
  more specific resolvers.
- Keep parser context scoped. Parser code should use the internal
  `ScopedParserContext` scope helpers for symbol stacks, source-node stacks, and
  type-parameter substitutions instead of mutating ambient parser state directly.
  The public `ParserContext` stays the observable parser state and options shape.
- Keep model policy centralized. Type model classes are DTO-like and can render
  themselves, while compound normalization and structural equivalence live in
  dedicated model helpers.

## Entry Points

- `src/parsers/moduleParser.ts` and `src/parsers/exportParser.ts` walk source files
  and exported declarations. `parseModule` resolves the descriptors of every
  export and records their public names by target symbol before it resolves any
  type, so `TypeName.exportedAs` can be filled wherever a type is named.
- `src/parsers/exportDescriptors.ts` normalizes export symbols into
  `ExportDescriptor` records before any output model nodes are built. It owns
  export-specifier targeting, namespace merging, re-export metadata, export type
  acquisition, declaration spaces and type-only reach, and recoverable export
  warnings.
- `src/parsers/declarationSpaces.ts` computes the declaration spaces an export
  occupies from every symbol along its alias chain.
- `src/parsers/exportValuePaths.ts` classifies each export of a module or
  namespace as value, type-only, or hidden by walking its alias and star-export
  paths for type-only sites.
- `src/parsers/exportTransforms.ts` applies post-export transforms after generic
  export nodes are built. Today it runs the React component transform from
  `componentParser.ts`.
- `src/parsers/componentParser.ts` contains React component-specific extraction
  and should remain a transform policy rather than a generic export parser. It
  recognizes both a single function type and a union of them, so a polymorphic
  component whose arms differ per prop form still reports one merged prop list.
  Type parameters are kept only when every signature declares the same ones.
  Return types are matched by name rather than by resolved node kind, so
  `includeExternalTypes` changes how much detail the output carries without
  changing what counts as a component.
- `src/parsers/typeResolver.ts` is the public type-resolution facade used by the
  rest of the parser. It should stay small; the resolver implementation lives in
  the session and resolver modules.
- `src/parserContextFactory.ts` constructs the scoped parser context shared by
  production entry points and focused parser tests, including balanced
  diagnostic and substitution scopes.

## Type Resolution

- `src/parsers/typeResolutionSession.ts` owns cross-cutting resolution mechanics:
  caching, recursion guards, type-parameter substitutions, warning replay, and
  the active resolver callback used by nested type-class handlers and helpers.
- `src/parsers/typeResolutionTypes.ts` defines the contracts shared by the
  resolver pipeline. Resolvers receive a `TypeResolutionRequest` and a
  `TypeResolutionSession`.
- `ScopedParserContext` (in `src/parserContext.ts`) exposes scoped parser-context
  helpers for diagnostic symbol scopes, diagnostic source-node scopes, and
  temporary type-parameter substitutions. Parser code should use these helpers
  instead of manually pushing and popping diagnostic stacks or swapping
  substitution maps. The public `ParserContext` (exported from `src/parser.ts`)
  stays focused on observable parser state and options.
- `src/parsers/typeResolutionDiagnostics.ts` centralizes recoverable fallback
  warnings, including source-location selection and TypeScript flag formatting.
- `src/parsers/typeResolutionUtils.ts` isolates TypeScript internal API access,
  such as private type IDs and shallow cycle placeholders.
- `src/parsers/authoredTypeReferenceBindings.ts` derives shared authored and
  semantic generic bindings across references and interface/class heritage so
  member, signature, and container resolution use the same specialization.
- `src/parsers/typeParameterBindings.ts` pairs semantic arguments and authored
  argument nodes with every checker symbol that can represent a generic
  parameter during nested resolution.
- `src/parsers/typeContainerUtils.ts` centralizes compiler-backed array and tuple
  identity, readonly-state, and tuple-element syntax helpers shared by container
  resolvers.
- `src/parsers/sourceFileUtils.ts` owns the deliberately distinct broad and
  path-segment-based `node_modules` policies used by semantic and authored-syntax
  traversal.

## Type-Class Resolvers

All resolver pipeline modules live in `src/parsers/typeResolvers/`.

- `index.ts` is the ordered resolver registry. Resolver order is meaningful:
  syntax-first operators and specific shapes should appear before semantic
  fallbacks that would discard authored syntax.
- `authoredTypeAlias.ts` replays alias bodies whose supported syntax contains
  `keyof`, carries generic substitutions across local and relative-import alias
  chains, and preserves source-only preflight checks where export normalization
  must not perturb TypeScript's lazy caches.
- `referencedTypeAlias.ts` centralizes how ordinary references and `import()`
  type references name a type: the authored entity name, import-alias
  following, and the type-alias and interface lookups used by naming, container,
  and operator helpers.
- `arrayTypeResolver.ts` handles arrays and element-type recursion.
- `classTypeResolver.ts` handles class detection, constructor model assembly,
  constructor documentation, class members, static members, and class type
  parameters.
- `enumTypeResolver.ts` handles enum-like flags and enum symbol/member
  extraction.
- `functionTypeResolver.ts` handles callable type selection and function model
  assembly.
- `intrinsicTypeResolver.ts` handles all primitive/intrinsic flags such as
  `string`, `number`, `boolean`, `void`, `any`, `unknown`, `null`, and `never`.
- `intersectionTypeResolver.ts` handles intersection members and any merged
  callable/object shape TypeScript exposes for the intersection.
- `literalTypeResolver.ts` handles string/number/bigint/boolean literal nodes.
- `templateLiteralTypeResolver.ts` handles template literal types, keeping their
  literal text and resolving each placeholder. It runs before the object
  resolver, which would otherwise expand a template literal into the members of
  its apparent `String` type.
- `objectTypeResolver.ts` handles object-like types, object properties, index
  signatures, mapped-type index signatures, and object-keyword fallback.
- `tupleTypeResolver.ts` handles tuple element resolution and tuple arity.
- `typeOperatorTypeResolver.ts` preserves authored `keyof` syntax, resolves its
  operand and semantic result separately, and records whether that result is
  exact, a base constraint, or a fallback.
- `typeOperatorTypeNodes.ts` contains the shared syntax helpers used to find and
  propagate authored `keyof` nodes through parenthesized and nested type syntax.
- `unionTypeResolver.ts` owns union-specific behavior, including preserving
  authored union member order and overlapping type-operator members from
  `TypeNode`s.
- `specialTypeResolvers.ts` handles TypeScript-internal or context-sensitive
  shapes such as type parameters, conditional types, indexed access types, and
  substitution fallbacks.
- `externalTypeResolver.ts` contains the external-type policy used when
  `includeExternalTypes` is disabled, and records whether each external type is
  declared in TypeScript's default library or in an npm package.
- `signatureTypeParameterNodes.ts` is a shared helper for signature type
  parameter metadata used by class and function resolvers.
- `signatureParser.ts` owns shared function-like signature parsing: call
  signatures, parameters, parameter docs/defaults, and return types used by
  callable exports, constructors, and class methods.

A resolver should answer, "Does this `ts.Type` shape apply, and if so, which
model node should represent it?" It should keep pipeline concerns such as
ordering, fallback choice, and session recursion explicit. If it needs nested
type resolution, it should use the active resolver callback from the current
`TypeResolutionSession` instead of importing `resolveType` directly.

## Model Construction

- Classes in `src/models/types/` are model DTOs with rendering helpers such as
  `toString()`. They should not own parser policy. Compound constructors are the
  only exception: they delegate member normalization to `typeCanonicalizer` so
  all callers get the same union/intersection behavior from normal
  construction.
- `src/models/typeCanonicalizer.ts` owns compound member normalization such as
  flattening nested compounds, simplifying boolean literal unions, removing
  redundant `never`, keeping nullish members at the end, and deduplicating
  members. It exports the singleton `typeCanonicalizer`; the implementation
  class is internal so callers use one shared normalization policy.
- `src/models/typeEquivalence.ts` owns structural equivalence checks used by
  canonicalization, including the intentional rule that unaliased `any` can act
  as a wildcard when choosing between duplicate generated signatures, and the
  source key that keeps equally named external types from different
  declarations apart. It exports
  the singleton `typeEquivalenceChecker`; the implementation class is internal.

## Shared Parser Helpers

- `common.ts` contains TypeScript name and type-argument helpers shared across
  parser layers.
- `documentationParser.ts` converts TypeScript documentation, JSDoc metadata, and
  parameter documentation into model documentation nodes.
