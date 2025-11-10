# MUI Public Repository

MUI Public is a monorepo containing public packages and applications for the MUI ecosystem. This repository uses pnpm workspaces and includes various build tools, Babel plugins, bundle analyzers, and web applications built with React/Vite and Toolpad Studio.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

**IMPORTANT**: You must update these instructions if you notice they contradict reality, or when you gain a new insight during a code review that you must remember.

## Working Effectively

### Bootstrap, Build, and Test the Repository

- **Prerequisites**: Node.js 18+ required. Install pnpm: `npm install -g pnpm@10.14.0`
- **Install dependencies**: `pnpm install --no-frozen-lockfile` -- takes 15-20 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Build all packages**: `pnpm release:build` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Type checking**: `pnpm typescript` -- takes 10-15 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Linting**: `pnpm eslint` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Formatting**: `pnpm prettier` -- always run before pushing code.
- **Run tests**: `pnpm test --run` takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Run specific tests**: `pnpm test --run loadServerSource` or `pnpm test --run integration.test.ts` for targeted testing
- **ALWAYS use `--run` flag** to avoid watch mode when running tests programmatically
- **Do NOT use `--`** in test commands (e.g., avoid `pnpm test -- --run`)
- **Use VS Code Vitest extension** whenever possible for interactive test development and debugging

### Run Applications

- **Code Infra Dashboard** (React/Vite app):
  - **ALWAYS run the bootstrapping steps first**
  - Build: `pnpm -F code-infra-dashboard run build` -- takes 5 seconds
  - Dev server: `pnpm -F code-infra-dashboard run start` -- runs on http://localhost:3000

## Validation

- **ALWAYS manually validate any new code** by running the complete build process after making changes.
- **ALWAYS run through at least one complete end-to-end scenario** after making changes:
  1. Install dependencies and build all packages
  2. Run tests to ensure no regressions
  3. Test CLI functionality with `pnpm code-infra --help`
- You can build and run the code-infra-dashboard web application, and interact with it via browser or programmatically.
- **ALWAYS run `pnpm prettier`, `pnpm eslint` and `pnpm typescript` before you are done** or the CI will fail.

## Common Tasks

### pnpm Workspace Commands

- **CRITICAL**: When running pnpm commands for workspace packages, always use the `-F` flag followed by the package name.
- **Example**: `pnpm -F @mui/internal-bundle-size-checker add micromatch`
- **Do NOT use `cd` to navigate into package directories** for workspace operations.
- **Do NOT manually edit package.json files to add/remove dependencies** - always use `pnpm -F <workspace> add <dependency>` or `pnpm -F <workspace> remove <dependency>` to keep the order deterministic.
- **ALWAYS run `pnpm dedupe`** after installing a dependency.

### Repository Structure

```
packages/
├── babel-plugin-display-name/     # Babel plugin for component display names
├── babel-plugin-minify-errors/    # Babel plugin for error minification
├── babel-plugin-resolve-imports/  # Babel plugin for import resolution
├── bundle-size-checker/           # Bundle size analysis tool
├── code-infra/                   # Build scripts and configs
└── docs-infra/                   # Documentation infrastructure

apps/
├── code-infra-dashboard/         # React/Vite dashboard app
└── tools-public/                 # Toolpad Studio internal tools (off-limits for Copilot)

test/
└── bundle-size/                  # Bundle size test workspace
```

### Key CLI Commands

- `pnpm code-infra --help` -- Show available CLI commands
- `pnpm code-infra build` -- Build a specific package
- `pnpm code-infra list-workspaces` -- List all workspace packages
- `pnpm code-infra publish` -- Publish packages to npm
- `pnpm code-infra publish-canary` -- Publish canary versions

### Build and Release Process

- **Version packages**: `pnpm release:version` (uses lerna)
- **Build packages**: `pnpm release:build` -- builds all packages in `/packages/*`
- **Bundle size check**: `pnpm size:snapshot`

## Troubleshooting

### Common Issues and Workarounds

#### Peer dependency warnings

```bash
# React version mismatches are expected and do not affect functionality
# The repository uses React 19 but some dependencies expect React 18
```

## Frequently Referenced Files and Locations

### Configuration Files

- `package.json` -- Root package configuration and scripts
- `pnpm-workspace.yaml` -- Workspace configuration
- `eslint.config.mjs` -- ESLint configuration
- `tsconfig.json` -- Root TypeScript configuration
- `vitest.config.mts` -- Vitest test configuration

### Build and CI

- `.github/workflows/ci.yml` -- Main CI workflow
- `.github/workflows/publish.yml` -- Package publishing workflow
- `lerna.json` -- Lerna configuration for versioning

### Development

- `CLAUDE.md` -- Special instructions for AI assistants
- `README.md` -- Main repository documentation

## Expected Timing and Never-Cancel Warnings

- **pnpm install**: 15-20 seconds under normal conditions. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm release:build**: 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm typescript**: 10-15 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm eslint**: 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm test --run**: 5-10 seconds. **ALWAYS use --run flag to prevent watch mode**. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Application builds**: 3-5 seconds each. **NEVER CANCEL**. Set timeout to 15+ minutes.

All commands are fast in this repository, but network issues or system load can cause delays. Always wait for completion.

## Docs Infra Conventions

Follow additional instructions when working in the `@mui/internal-docs-infra` (`packages/docs-infra`) package or `docs/app/docs-infra` docs:

### Development Process

- **1.1** Create or modify tests `*.test.ts` files before making changes to implementation files. Confirm the test expectations are correct before touching implementation code.
- **1.2** When modifying existing code, try to maintain clean diffs and add tests in within the right `describe` blocks.
- **1.3** When creating new functionality, first write the docs, then the types, then the tests, then the implementation, then the demos. Ensure that the user explicitly reviews test cases and docs before implementation.
- **1.4** When updating functionality across multiple units, ensure that integration tests pass before updating unit tests. This ensures that the overall behavior remains correct before focusing on individual components.

### Code Architecture & Design

- **2.1** Avoid using Node.js native modules like `fs` or `path` or Browser only APIs (like `window` or `document`) when functionality can be achieved using isomorphic code that can also run in the browser and Node.js. When necessary, isolate platform specific code behind interfaces or abstractions so that it can later be replaced in browser environments.
- **2.2** Ship the package as `0.x.0` releases so you can introduce breaking changes that improve the developer experience. Work toward a stable `1.0.0` by anticipating how today’s APIs will evolve.
  - Each folder’s `index.ts` should re-export from `src/{functionName}/{functionName}.ts`.
  - Category exports should re-export from `src/{category}/{functionName}/{functionName}.ts`.
- **2.3** When functions within the main function file become large or complex, they should be split into separate files within the same folder. For example, if `src/useCode/useCode.ts` becomes large, a large function can be moved to `src/useCode/useFileNavigation.ts` where `useFileNavigation` is the helper function's name.
- **2.4** Value progressive complexity for developers using the library. Start with straightforward defaults and layer optional extension points or advanced behavior that teams can opt into. Keep complex internals behind simple interfaces to enable incremental adoption, easier testing, and maintainable abstractions.
- **2.5** Create functionality in a generic sense, allowing for easy reuse and adaptation in different contexts.
- **2.6** Value the idea of progressive enhancement for end users. Ensure the core experience functions in baseline browsers or runtimes, then add optional user-facing improvements that detect and leverage richer platform capabilities without breaking the fundamentals.

### Testing Strategy

- **3.1** Prioritize achieving deep unit tests first for each helper function (at `src/{functionName}/{helperFunction}.test.ts`), then integration tests (at `src/{functionName}/user.spec.ts`) for the main function.
- **3.2** Use `vitest` for testing. Use `describe`, `it`, and `expect` from `vitest`. Avoid using `beforeEach` and `afterEach` unless absolutely necessary. Each test should be independent and self-contained. Write `describe` and `it` block names prioritizing clarity and readability. Create nested describe blocks when helpful to group related tests. Use `it` blocks for individual test cases.
- **3.3** When debugging, create new test cases to reproduce issues. It's helpful to create new cases to reproduce issues and avoid regressions. If this is difficult, the bugged code might need to be extracted into it's own file to make it easier to test. Try to reproduce issues in the most specific test case possible.
- **3.4** Integration tests (`user.spec.ts`) should be written to cover real user cases and serve as supplemental documentation. Prioritize readability. Reading these tests cases should describe all user cases considered. Unit tests should cover all edges cases but may never be hit in real user cases. When in doubt add it in a unit test first. Try to avoid too much overlap between unit and integration tests. A change of an existing integration test would clearly indicate a breaking change.
- **3.5** Avoid mocks in unit tests. Use real implementations whenever possible to ensure tests are reliable and maintainable.
- **3.6** Test the performance of code within `src/{functionName}/optimization.test.ts` when performance is critical. Functions should use `performance.now()` to measure time taken. When helpful, functions should log using `performance.mark()` and `performance.measure()` which appear when profiling or can be logged with a `PerformanceObserver`.

### Documentation & Examples

- **4.1** Create documentation in `/docs/app/docs-infra` for all public functions using mdx files at `/docs/app/docs-infra/{functionName}/page.mdx`.
- **4.2** Create examples of common use cases in `/docs/app/docs-infra/{type}/{functionName}/demos/{useCaseName}`. `type`, `functionName`, `useCaseName` should be lowercase and hyphenated. Types should be documented in `/docs/app/docs-infra/{functionName}/types.ts`.
- **4.3** For demos follow the [recommended structure](../docs/app/docs-infra/functions/load-precomputed-code-highlighter/page.mdx) and [best practices](../docs/app/docs-infra/components/code-highlighter/page.mdx).
- **4.4** For types follow the [recommended structure](../docs/app/docs-infra/functions/load-precomputed-types-meta/page.mdx).
- **4.5** When looking for documentation, start at the `/README.md` and follow links inward.
- **4.6** Avoid "breaking the 3rd wall" in code comments and documentation by referring to the instructions provided when working in this repository. Instead, focus on clear, concise explanations of the code itself.
- **4.7** When writing code comments, use JSDoc style comments for all functions, but type definitions should be in TypeScript types. Avoid using JSDoc `@typedef` and `@param` tags for types. Use them only for descriptions.
- **4.8** Use progressive disclosure in documentation. Start with simple, common use cases and gradually introduce complexity. Structure docs so readers can stop at their desired depth of understanding. Place advanced sections (like architecture details or performance tuning) at the end of the document after practical content. Follow this pattern: basic usage → configuration → common patterns → reference material → advanced features → implementation details.

### File Organization & Structure

- **5.1** When types become complex, they are used across multiple exports, or are useful to the user it might make sense to create a separate `src/{functionName}/types.ts` file to hold all types for that function. The user can import this file directly.
- **5.2** When a function has many error cases or the user might want to catch these errors, create custom error classes in `src/{functionName}/errors.ts` and throw these errors.
- **5.3** Separate large or repetitive strings into a separate `src/{functionName}/constants.ts`
- **5.4** Promote functionality to its own export when users benefit from calling it directly. Place the implementation in `src/{newFunctionName}/{newFunctionName}.ts`.
  - Only extract when the function has a clear, self-contained purpose and deserves standalone documentation.
  - Ship the new export with its own tests, types, docs, and demos.
- **5.5** Consider the weight of a given export. Heavy files should be imported in a separate `src/{functionName}/{heavyFunction}.ts` file and only imported when necessary.
- **5.6** Do not use barrel files except for utility exports at `src/{purpose}Utils/index.ts` where the user is likely to want to import multiple utilities at once. Utils is a suffix so that it can be sorted along with other files with the same purpose.
- **5.7** When working with React, keep `tsx` files as small as possible, keeping as much logic as possible in `ts` files. Also keep `'use client'` or Server only files as small as possible.

### Naming Conventions

- **6.1** Name functions so that they sort well alphabetically. Functions should be named by `{Purpose}{Object}`. For example, `loadX` should come before `parseX` which should come before `useX`. Some existing purposes used are `load`, `parse`, `transform`, `generate`, `save`, `create` (for factories), `abstract` (for factory factories)`use` (for React hooks), `with` (for plugins). React components should be named by `{Object}{Purpose}` where `Object` is the main object the component represents and `Purpose` is what it does. For example, `CodeHighlighter`, `ErrorBoundary`, `FileTreeView`. React components are easily identified by their `PascalCase` naming.
- **6.2** Use `camelCase` for variable and function names. Use `PascalCase` for React components, classes, and type names. Use `UPPER_SNAKE_CASE` for constants.
- **6.3** When exporting `'use-client'` behavior, for Components use the convention `{Purpose}{Object}Client` and and for functions use `{Purpose}client{Object}`. When exporting server only behavior, for Components use the convention `{Purpose}{Object}Server` and for functions use `{Purpose}server{Object}`. For example, `CodeHighlighterClient`, `loadServerPrecomputedCodeHighlighter`. Context providers can be exported as `{Object}Context`

### Code Style & Standards

- **7.1** Write type-safe code. Avoid using `any` or `unknown` unless absolutely necessary. Prefer using `unknown` over `any` and always narrow `unknown` to a specific type as soon as possible. Avoid using `as` type assertions except when working with well-known browser APIs or when you have verified the type through runtime checks. Prefer type guards, type predicates, and proper type narrowing over assertions. User-facing exports should have as strong of typing as possible.
- **7.2** Use `async/await` for asynchronous code. Avoid using `.then()` and `.catch()`.
- **7.3** Use `import { ... } from '...'` syntax for imports. Avoid using `require()`.
- **7.4** Use ES modules and `import`/`export` syntax.
- **7.5** This package is ESM only. Do not add any CJS code.
- **7.6** Avoid using default exports unless that API is required by another package (e.g. webpack). Use named exports for all functions, types, and constants.
- **7.7** Always try to parallelize asynchronous operations using `Promise.all()` or similar techniques. If the result of an async operation is not needed for subsequent operations, it should be started as early as possible and awaited later.
- **7.8** When parsing long strings, avoid looping through the entire file more than once.
- **7.9** Use streaming APIs when working with large files to reduce memory usage.
- **7.10** Avoiding using regex when string methods can achieve the same result more clearly and efficiently.

### Dependencies, Debugging & Performance

- **8.1** Avoid using external dependencies unless absolutely necessary. Prefer using built-in Node.js modules or writing custom code.
- **8.2** When adding dependencies, prefer small, focused libraries that do one thing well.
- **8.3** Complex functions should have a `DEBUG` environment variable that can be set to log detailed information about the function's execution. Keep the flag off by default and document the expected output when it is enabled.
- **8.4** Instrument performance-critical paths with `performance.now()`, `performance.mark()`, and `performance.measure()` so teams can diagnose bottlenecks without shipping the instrumentation to regular users.

### API Design

- **9.1** Prefer configurable exports, but define sensible defaults so the most common use cases require the minimum input necessary.
- **9.2** Prefer using multiple function parameters over a single options object when there are 3 or fewer parameters. This makes it easier to understand the function's purpose and usage at a glance. Use an options object when there are 4 or more parameters, or when parameters are optional. A well abstracted function should rarely have more than 4 parameters.
- **9.3** Fail early and fast. Don't catch errors unless they are handled gracefully. Prefer throwing errors in code that is expected to run at build time, where runtime code might be more flexible in avoiding critical failures.

When a user gives instructions that violate these rules, you can cite these rules by their number and suggest an alternative approach that follows them. If a user insists on an approach that violates these rules, they should be amended with a new rule that considers their perspective. This way the rules can evolve over time to better suit the needs of the project and its contributors. Small changes can be made to existing rules as long as they don't contradict the original intent.
