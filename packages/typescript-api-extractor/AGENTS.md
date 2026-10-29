# Agent Notes

Read the docs under `docs/` before making parser or model changes:
`docs/api-reference.md` (public API), `docs/output-format.md` (output shape), and
`docs/architecture.md` (current architecture map). `README.md` links to all of
them. Do not duplicate that material here.

## Project Basics

- Source lives under `src/`; fixture-based integration inputs live under
  `test/fixtures/`. Fixtures are excluded from Prettier and ESLint, so keep
  them byte-for-byte as written.
- Treat `build/` as build output.

## Verification

Run the narrowest useful check while iterating, then broaden before finishing.
From the repository root:

- `pnpm test --run --project @mui/internal-typescript-api-extractor`
- `pnpm -F @mui/internal-typescript-api-extractor typescript` (also typechecks
  the fixture inputs)
- `pnpm eslint` and `pnpm prettier`

docs-infra consumes this package through its build output, so run
`pnpm -F @mui/internal-typescript-api-extractor build` before testing
docs-infra against a change here.

For parser behavior changes that intentionally alter fixture output, regenerate
expected JSON with:

```bash
UPDATE_OUTPUT=true pnpm test --run --project @mui/internal-typescript-api-extractor
```

Review generated fixture diffs carefully; they are part of the behavior contract.

## Documentation

Docs under `docs/` are part of the change, not a follow-up. Update them in the
same commit as the code they describe.

- `docs/api-reference.md` - the exported functions, `ParserOptions`, and the
  `ParserWarning` shapes. Update it whenever the public surface in
  `src/index.ts`, `src/parser.ts`, or `src/config.ts` changes.
- `docs/output-format.md` - the emitted model. Update it for new or renamed
  `TypeNode` kinds, new node fields, and changes to what a field carries.
- `docs/architecture.md` - the layer and module map. Update it when modules are
  added, moved, renamed, or given a different responsibility, and when resolver
  ordering constraints change.
- `docs/usage.md` - task-oriented examples. Update it when a change alters how
  callers drive the parser or adds an option worth demonstrating.
- `README.md` stays a landing page: features, installation, quick start, and
  links. Detail belongs in `docs/`.

## Architecture Guardrails

- Keep export parsing, export normalization, and post-export transforms as
  separate concerns.
- Resolver order in `src/parsers/typeResolvers/index.ts` is observable. Place
  narrow resolvers before broad fallbacks.
- Type resolvers should use the active resolver callback from
  `TypeResolutionSession` for nested resolution rather than importing
  `resolveType` directly.
- Use `ScopedParserContext` helpers for temporary symbol/source scopes and
  type-parameter substitutions.
- Keep parser policy out of model DTOs. Shared compound normalization belongs in
  `src/models/typeCanonicalizer.ts`; structural equivalence belongs in
  `src/models/typeEquivalence.ts`.
- Preserve recoverable warning behavior and source-location quality when touching
  fallback or diagnostic paths.

## Testing Guidance

- Add focused tests near the changed parser, resolver, or model behavior.
- Prefer fixture tests for user-visible extraction output changes.
- Include regression coverage for TypeScript edge cases, especially aliases,
  re-exports, mapped types, conditional/indexed access types, React components,
  and generic substitutions.
- Avoid unrelated refactors while changing resolver behavior; small ordering
  changes can have broad output effects.
