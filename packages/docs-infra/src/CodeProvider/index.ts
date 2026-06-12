// Both providers ship from this single entry. They must NOT be split into
// separate package subpath exports: `CodeProviderLazy` and `CodeHighlighter`
// share the `CodeContext` ('use client') module, and Next.js/Turbopack
// instantiates a separate client reference (and thus a SECOND `CodeContext`)
// per package subpath — so a `./CodeProviderLazy` subpath would disconnect the
// provider from the demo's consumer and crash prerender with a missing
// `loadCodeFallback`. (Verified: a clean `next build` reproduced it.)
export * from './CodeProvider';
export * from './CodeProviderLazy';
