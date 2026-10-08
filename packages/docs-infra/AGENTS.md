# Docs Infra Conventions

Follow additional instructions when working in the `@mui/internal-docs-infra` (`packages/docs-infra`) package or `docs/app/docs-infra` docs:

## Code Architecture & Design

- **2.1** Avoid using Node.js native modules like `fs` or `path` or Browser only APIs (like `window` or `document`) when functionality can be achieved using isomorphic code that can also run in the browser and Node.js. When necessary, isolate platform specific code behind interfaces or abstractions so that it can later be replaced in browser environments.
- **2.2** Ship the package as `0.x.0` releases so you can introduce breaking changes that improve the developer experience. Work toward a stable `1.0.0` by anticipating how today's APIs will evolve.
  - Each folder's `index.ts` should re-export from `src/{functionName}/{functionName}.ts`.
  - Category exports should re-export from `src/{category}/{functionName}/{functionName}.ts`.
- **2.3** When functions within the main function file become large or complex, they should be split into separate files within the same folder. For example, if `src/useCode/useCode.ts` becomes large, a large function can be moved to `src/useCode/useFileNavigation.ts` where `useFileNavigation` is the helper function's name.
- **2.4** Value progressive complexity for developers using the library. Start with straightforward defaults and layer optional extension points or advanced behavior that teams can opt into. Keep complex internals behind simple interfaces to enable incremental adoption, easier testing, and maintainable abstractions.
- **2.5** Create functionality in a generic sense, allowing for easy reuse and adaptation in different contexts.
- **2.6** Value the idea of progressive enhancement for end users. Ensure the core experience functions in baseline browsers or runtimes, then add optional user-facing improvements that detect and leverage richer platform capabilities without breaking the fundamentals.

## Documentation & Examples

- **4.1** Create documentation in `/docs/app/docs-infra` for all public functions using mdx files at `/docs/app/docs-infra/{functionName}/page.mdx`.
- **4.2** Create examples of common use cases in `/docs/app/docs-infra/{type}/{functionName}/demos/{useCaseName}`. `type`, `functionName`, `useCaseName` should be lowercase and hyphenated. Types should be documented in `/docs/app/docs-infra/{functionName}/types.ts`.
- **4.3** For demos follow the [recommended structure](/docs/app/docs-infra/pipeline/load-precomputed-code-highlighter/page.mdx) and [best practices](/docs/app/docs-infra/components/code-highlighter/page.mdx).
- **4.4** For types follow the [recommended structure](/docs/app/docs-infra/pipeline/load-precomputed-types/page.mdx).
- **4.5** When looking for documentation, start at the `/README.md` and follow links inward.
- **4.6** Avoid "breaking the 3rd wall" in code comments and documentation by referring to the instructions provided when working in this repository. Instead, focus on clear, concise explanations of the code itself.
- **4.7** When writing code comments, use JSDoc style comments for all functions, but type definitions should be in TypeScript types. Avoid using JSDoc `@typedef` and `@param` tags for types. Use them only for descriptions.
- **4.8** Use progressive disclosure in documentation. Start with simple, common use cases and gradually introduce complexity. Structure docs so readers can stop at their desired depth of understanding. Place advanced sections (like architecture details or performance tuning) at the end of the document after practical content. Follow this pattern: basic usage → configuration → common patterns → reference material → advanced features → implementation details.
- **4.9** Keep generated `[//]: # 'comment'` and `[//]: types.ts 'comment'` markers: MDX rejects HTML comments, and page-index parsing consumes these markers. The remark config permits only these titled `//` definitions while checking ordinary links and definitions.
- **4.10** Place shared MDX fragments without a top-level heading in `docs/app/_partials`. Use `page.tsx` for routes that only re-export another page.

## File Organization & Structure

- **5.1** When types become complex, they are used across multiple exports, or are useful to the user it might make sense to create a separate `src/{functionName}/types.ts` file to hold all types for that function. The user can import this file directly.
- **5.2** When a function has many error cases or the user might want to catch these errors, create custom error classes in `src/{functionName}/errors.ts` and throw these errors.
- **5.3** Separate large or repetitive strings into a separate `src/{functionName}/constants.ts`
- **5.4** Promote functionality to its own export when users benefit from calling it directly. Place the implementation in `src/{newFunctionName}/{newFunctionName}.ts`.
  - Only extract when the function has a clear, self-contained purpose and deserves standalone documentation.
  - Ship the new export with its own tests, types, docs, and demos.
- **5.5** Consider the weight of a given export. Heavy files should be imported in a separate `src/{functionName}/{heavyFunction}.ts` file and only imported when necessary.
- **5.6** Do not use barrel files except for utility exports at `src/{purpose}Utils/index.ts` where the user is likely to want to import multiple utilities at once. Utils is a suffix so that it can be sorted along with other files with the same purpose.
- **5.7** When working with React, keep `tsx` files as small as possible, keeping as much logic as possible in `ts` files. Also keep `'use client'` or Server only files as small as possible.

## Naming Conventions

- **6.1** Name functions so that they sort well alphabetically. Functions should be named by `{Purpose}{Object}`. For example, `loadX` should come before `parseX` which should come before `useX`. Some existing purposes used are `load`, `parse`, `transform`, `generate`, `save`, `create` (for factories), `abstract` (for factory factories), `use` (for React hooks), `with` (for plugins), `sync` (for autogenerated files), `enhance` (for non-destructive hast transformers). React components should be named by `{Object}{Purpose}` where `Object` is the main object the component represents and `Purpose` is what it does. For example, `CodeHighlighter`, `ErrorBoundary`, `FileTreeView`. React components are easily identified by their `PascalCase` naming.
- **6.2** Use `camelCase` for variable and function names. Use `PascalCase` for React components, classes, and type names. Use `UPPER_SNAKE_CASE` for constants.
- **6.3** When exporting `'use-client'` behavior, for Components use the convention `{Purpose}{Object}Client` and for functions use `{Purpose}client{Object}`. When exporting server only behavior, for Components use the convention `{Purpose}{Object}Server` and for functions use `{Purpose}server{Object}`. For example, `CodeHighlighterClient`, `loadServerPrecomputedCodeHighlighter`. Context providers can be exported as `{Object}Context`

## Code Style & Standards

- **7.1** Write type-safe code. Avoid using `any` or `unknown` unless absolutely necessary. Prefer using `unknown` over `any` and always narrow `unknown` to a specific type as soon as possible. Avoid using `as` type assertions except when working with well-known browser APIs or when you have verified the type through runtime checks. Prefer type guards, type predicates, and proper type narrowing over assertions. User-facing exports should have as strong of typing as possible.
- **7.2** Use `async/await` for asynchronous code. Avoid using `.then()` and `.catch()`.
- **7.3** Use `import { ... } from '...'` syntax for imports. Avoid using `require()`.
- **7.4** Use ES modules and `import`/`export` syntax.
- **7.5** When importing from React, always use namespace imports: `import * as React from 'react'`. Access React exports via the namespace (e.g., `React.Suspense`, `React.useState`). Do not use named imports like `import { Suspense } from 'react'`.
- **7.6** This package is ESM only. Do not add any CJS code.
- **7.7** Avoid using default exports unless that API is required by another package (e.g. webpack). Use named exports for all functions, types, and constants.
- **7.8** Always try to parallelize asynchronous operations using `Promise.all()` or similar techniques. If the result of an async operation is not needed for subsequent operations, it should be started as early as possible and awaited later.
- **7.9** When parsing long strings, avoid looping through the entire file more than once.
- **7.10** Use streaming APIs when working with large files to reduce memory usage.
- **7.11** Avoid using regex when string methods can achieve the same result more clearly and efficiently.
- **7.12** When building skeleton/loading UI, use a single presentational component with a `loading` prop that renders skeletons internally, rather than creating separate skeleton components. This keeps the component API simple and ensures the skeleton matches the actual layout.
- **7.13** Avoid single-letter variable and parameter names. `e` is banned outright by the `id-denylist` ESLint rule; prefer descriptive names in callbacks too.

## Dependencies, Debugging & Performance

- **8.1** Avoid using external dependencies unless absolutely necessary. Prefer using built-in Node.js modules or writing custom code.
- **8.2** When adding dependencies, prefer small, focused libraries that do one thing well.
- **8.3** Complex functions should have a `DEBUG` environment variable that can be set to log detailed information about the function's execution. Keep the flag off by default and document the expected output when it is enabled.
- **8.4** Instrument performance-critical paths with `performance.now()`, `performance.mark()`, and `performance.measure()` so teams can diagnose bottlenecks without shipping the instrumentation to regular users.

## API Design

- **9.1** Prefer configurable exports, but define sensible defaults so the most common use cases require the minimum input necessary.
- **9.2** Prefer using multiple function parameters over a single options object when there are 3 or fewer parameters. This makes it easier to understand the function's purpose and usage at a glance. Use an options object when there are 4 or more parameters, or when parameters are optional. A well abstracted function should rarely have more than 4 parameters.
- **9.3** Fail early and fast. Don't catch errors unless they are handled gracefully. Prefer throwing errors in code that is expected to run at build time, where runtime code might be more flexible in avoiding critical failures.

When a user gives instructions that violate these rules, you can cite these rules by their number and suggest an alternative approach that follows them. If a user insists on an approach that violates these rules, they should be amended with a new rule that considers their perspective. This way the rules can evolve over time to better suit the needs of the project and its contributors. Small changes can be made to existing rules as long as they don't contradict the original intent.
