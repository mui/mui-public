# MUI Public Repository

MUI Public is a monorepo containing public packages and applications for the MUI ecosystem. This repository uses pnpm workspaces and includes various build tools, Babel plugins, bundle analyzers, and web applications built with React/Vite.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

**IMPORTANT**: You must update these instructions if you notice they contradict reality, or when you gain a new insight during a code review that you must remember.

## Pull Requests

- **ALWAYS create pull requests as drafts** using `gh pr create --draft`.

## Working Effectively

### Bootstrap, Build, and Test the Repository

- **Prerequisites**: Node.js 22.23.2+ required. Install pnpm: `npm install -g pnpm@12.3.4`
- **Install dependencies**: `pnpm install --no-frozen-lockfile` -- takes 15-20 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Build all packages**: `pnpm release:build` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Type checking**: `pnpm typescript` -- takes 10-15 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Linting**: `pnpm eslint` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Formatting**: `pnpm prettier` -- always run before pushing code.
- **Run tests**: `pnpm test --run` takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Run specific tests**: `pnpm test --run loadServerCodeSource` or `pnpm test --run integration.test.ts` for targeted testing
- **Run browser tests**: `pnpm test:browser --run` -- requires podman or docker. Starts a containerized Playwright server and runs browser tests against it.
- **Run browser tests in CI**: In a `mcr.microsoft.com/playwright` container image, run `pnpm test:browser:unconfined` directly — no container engine needed. Only use in a CI environment.
- **ALWAYS use `--run` flag** to avoid watch mode when running tests programmatically
- **Do NOT use `--`** in test commands (e.g., avoid `pnpm test -- --run`)
- **Use VS Code Vitest extension** whenever possible for interactive test development and debugging

### Run Applications

- **Code Infra Dashboard** (React/Vite app):
  - **ALWAYS run the bootstrapping steps first**
  - Build: `pnpm -F code-infra-dashboard run build` -- takes 5 seconds
  - Dev server: `pnpm -F code-infra-dashboard run start` -- runs on http://localhost:3000
  - Production URL: `https://frontend-public.mui.com`
  - PR preview URLs follow the pattern: `https://code-infra-dashboard-pr-{number}.onrender.com`

## Validation

- **ALWAYS manually validate any new code** by running the complete build process after making changes.
- **ALWAYS run through at least one complete end-to-end scenario** after making changes:
  1. Install dependencies and build all packages
  2. Run tests to ensure no regressions
  3. Test CLI functionality with `pnpm code-infra --help`
- You can build and run the code-infra-dashboard web application, and interact with it via browser or programmatically.
- **ALWAYS run `pnpm prettier`, `pnpm eslint` and `pnpm typescript` before you are done** or the CI will fail.
- **Run `pnpm release:build` before `pnpm docs:validate`**: it regenerates `types.md` from the built package, so a stale build hides drift that CI (which builds first) catches.

## Testing

- `remark-typography` preserves phrasing context across inline elements. Rendered Markdown expectations may contain non-breaking spaces (U+00A0) even when the source Markdown uses ordinary spaces; keep assertions exact.

Applies to the whole repository.

- **Avoid mocks. This is about _what_ you fake, not which tool you fake it with.** Dependency
  injection is still a mock: adding a `deps` parameter, or a hand-rolled interface that only tests
  supply, does not satisfy this rule — it is worse, because it puts a test-only seam in production
  code.
- **Never fake internals.** A seam that exists only for tests couples them to the current shape of
  the code and has to be rewritten on every refactor.
- **Fake only genuine externals** (network, database, clock), and only when there is no way to
  avoid it. Prefer extracting the logic into a pure function that takes data and needs no fake at
  all. Replacing a module that is itself the boundary to an external — the module whose whole job
  is to construct the API client or open the database connection — counts as faking that external,
  not an internal, provided what you substitute is still the real thing underneath.
- **A change to a faked library's TypeScript API must break typechecking.** Keep the real client in
  the test's path and substitute at its own boundary: construct a real `Octokit` with
  `request: { fetch }` serving canned HTTP responses, or implement a connection against the driver's
  own exported signature. Hand-writing a narrow interface, or casting a partial object with
  `as any`, silently drifts from upstream and is not acceptable.
- **Prove the test can fail.** A test that passes when you break the code it covers is not covering
  it. When a fake stands in for something, check that deleting the logic under test actually turns
  the suite red.
- **Test through the public API.** Cover a module through what it exports, and check the shape of
  that API rather than how it is built. Do not export a function only so a test can call it, and do
  not unit-test a helper the exported entry points already exercise — reach its edge cases through
  those entry points instead. A genuinely generic utility — string manipulation, HTTP, paths,
  formatting — is a module of its own: extract it, and test it through its own API.

## Common Tasks

### pnpm Workspace Commands

- **CRITICAL**: When running pnpm commands for workspace packages, always use the `-F` flag followed by the package name.
- **Example**: `pnpm -F @mui/internal-bundle-size-checker add micromatch`
- Private packages without a `name` field in `package.json` must be filtered by their relative path (e.g., `pnpm -F ./test/performance add <dependency>`).
- **Do NOT use `cd` to navigate into package directories** for workspace operations.
- **Do NOT manually edit package.json files to add/remove dependencies** - always use `pnpm -F <workspace> add <dependency>` or `pnpm -F <workspace> remove <dependency>` to keep the order deterministic.
- **ALWAYS run `pnpm dedupe`** after installing a dependency.

### Build and Release Process

- **Version packages**: All the package versions are auto-managed by canary publishing.
- **Build packages**: `pnpm release:build` -- builds all packages in `/packages/*`
- **Bundle size check**: `pnpm size:snapshot`

### GitHub Actions

- **Pin every action to a full-length commit SHA** and annotate it with the exact release tag it resolves to, e.g. `uses: actions/stale@1e223db275d687790206a7acac4d1a11bd6fe629 # v10.4.0`.
- **Use the full version in the comment**, never a major-only alias like `# v1` or `# v10`. Renovate reads that comment as the current version and keeps its precision, so a truncated tag downgrades every future bump to an opaque digest update with no changelog to review.
- **Never use a branch name in the comment** (e.g. `# master`) for a third-party action. The only exception is this repo's own `mui/mui-public/.github/actions/*` composite actions, which have no release tags to point at.

## Troubleshooting

### Common Issues and Workarounds

#### Peer dependency warnings

```bash
# React version mismatches are expected and do not affect functionality
# The repository uses React 19 but some dependencies expect React 18
```

## Docs Infra Conventions

When working in the `@mui/internal-docs-infra` (`packages/docs-infra`) package or `docs/app/docs-infra` docs, follow the conventions in [packages/docs-infra/AGENTS.md](packages/docs-infra/AGENTS.md).
