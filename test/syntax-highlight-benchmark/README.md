# Syntax highlighting benchmark

Compares syntax highlighting engines as candidates to replace [Starry Night](https://github.com/wooorm/starry-night) in `@mui/internal-docs-infra`.

```bash
pnpm release:build   # docs-infra is linked through its build output
pnpm -F ./test/syntax-highlight-benchmark benchmark
pnpm -F ./test/syntax-highlight-benchmark benchmark --engines starry-night,highlights --runs 3 --skip-bundles
pnpm -F ./test/syntax-highlight-benchmark benchmark:disagreements highlights css
pnpm -F ./test/syntax-highlight-benchmark benchmark:imports
```

`benchmark` writes `results/report.md`, `results/results.json` and `results/compare.html`, a side-by-side rendering of every sample with one shared palette. `benchmark:disagreements` lists the text runs where an engine's categories differ most from Starry Night's for one language.

## What it measures

Each engine is wrapped in an adapter (`src/engines/*`) that turns source into the HAST docs-infra consumes: one `<span class>` per token, plain text otherwise. All numbers include that conversion.

- **Warm highlighting**: median time per call after warm-up, for each sample in the corpus.
- **Cold start**: a fresh process imports the engine, loads every docs-infra language and highlights a 12-line snippet. It also records the peak RSS growth after highlighting the whole corpus.
- **Output size**: elements and serialized HTML across the corpus. Precomputed HAST is shipped to the page, so this is payload.
- **Token agreement**: per non-whitespace character, the intersection over union of the categories each engine assigns, against Starry Night. Only categories both taxonomies define the same way are compared (comment, string, keyword, number, tag, inserted, deleted). Low agreement points at a difference, not at which engine is right; check `compare.html`.
- **Browser payload**: a minified Vite build of the engine with its languages, gzip and brotli.

The corpus (`src/corpus.ts`) uses real files from this repository for the 11 languages docs-infra supports (`js`, `ts`, `tsx`, `json`, `md`, `mdx`, `html`, `css`, `sh`, `yaml`, `diff`), plus fixtures for languages the repository has no files for.

`docs-infra parseSource` is the production pipeline: Starry Night plus `extendSyntaxTokens` and line gutters. It shows how much of `parseSource` the engine itself accounts for.

## Results

Node 26.13.1 on an Apple M1, 16 GiB, median of 7 fresh processes per engine. Versions: `@wooorm/starry-night` 3.11.0, [`@pierre/highlights`](https://diffs.com/highlights) 0.5.1, `@lezer/highlight` 1.2.5 with the `@lezer/*` grammars and `@codemirror/legacy-modes` 6.5.5.

| metric                                   | starry-night |         highlights | CodeMirror (Lezer) |
| :--------------------------------------- | -----------: | -----------------: | -----------------: |
| warm, whole corpus (7,678 lines)         |       260 ms |   6.0 ms (**43×**) |       82 ms (3.2×) |
| warm, 12-line tsx snippet                |      0.36 ms | 0.012 ms (**29×**) |     0.11 ms (3.3×) |
| warm, 2,418-line ts file                 |       146 ms |   2.5 ms (**59×**) |       37 ms (4.0×) |
| cold: import + init + first highlight    |       394 ms |    15 ms (**26×**) |      101 ms (3.9×) |
| peak RSS growth                          |      376 MiB |             30 MiB |             52 MiB |
| browser payload, tsx only (gzip)         |      213 KiB |      184 KiB (all) |         **49 KiB** |
| browser payload, all 11 languages (gzip) |      320 KiB |            184 KiB |            161 KiB |
| elements across corpus                   |       21,529 |      32,833 (+52%) |      30,868 (+43%) |
| serialized HTML across corpus            |      830 KiB |   1,555 KiB (+87%) |   1,303 KiB (+57%) |

Starry Night's payload counts `onig.wasm` (473 KiB raw), which it fetches separately at runtime. `extendSyntaxTokens` and line gutters add 3–10% to Starry Night's time, so the engine dominates `parseSource`.

The machine had other load during the runs. Starry Night and highlights stayed within a few percent across processes. CodeMirror did not: its corpus total ranged from 56 to 134 ms between processes, and one sample took 8 ms in some processes and 16–22 ms in others. Treat its numbers as a 3–5× speed-up, not a precise figure.

### Highlighting quality

Token agreement with Starry Night, per language (see the table in `results/report.md`):

| language | highlights | CodeMirror |
| :------- | ---------: | ---------: |
| `ts`     |      99.7% |      99.2% |
| `json`   |       100% |       100% |
| `tsx`    |      86.6% |      87.1% |
| `html`   |      87.2% |      95.1% |
| `yaml`   |      94.7% |      35.4% |
| `diff`   |      94.9% |       100% |
| `css`    |      58.3% |      67.4% |
| `sh`     |      73.5% |      63.4% |
| `md`     |      69.8% |      63.5% |
| `mdx`    |      58.1% |      61.2% |
| `js`     |      22.9% |      28.4% |

Most of the gap is taxonomy, not errors. `compare.html` shows both engines are close to Starry Night, or better, on most samples:

- `js` is a Starry Night bug. Its `source.js` grammar never leaves a template literal whose `${…}` contains `?.` or `??`, so the rest of the file renders as a string. `` `${a?.b}` `` is enough to trigger it. `source.ts` and `source.tsx` handle it, but docs-infra maps `.js` files to `source.js`. Both alternatives highlight these files correctly.
- `tsx` tags: Starry Night colors component tags (`<Menu.Item>`) as constants and only lowercase tags as tags.
- `md`/`mdx`: Starry Night colors inline-code backticks and link brackets as strings.
- `css`: Starry Night colors attribute selectors as tags and units (`px`) as keywords. It also leaves newer properties such as `view-transition-name` unstyled.
- `yaml` with CodeMirror: `@lezer/yaml` tags unquoted scalars and numbers as plain content, so they render unstyled. That is a real visual difference, not a mapping gap.

## `@pierre/highlights`

The fastest option by an order of magnitude on every axis that measures time or memory. Highlights also tokenizes JSDoc tags, which Starry Night leaves inside the comment.

Highlights ships one 300 KiB Wasm module with all 152 languages, inlined as base64 in its JS, so it cannot be split per language. Even so, it is smaller than Starry Night with only the tsx grammar.

What adopting it would take:

- **Class names.** docs-infra is built on Starry Night's `pl-*` classes: `extendSyntaxTokens`, `enhanceCodeTypes`, `enhanceCodeInline`, `enhanceCodeEmphasis`, `hastDictionary`, `loadServerTypes` and the demo themes all key on them. Highlights exposes semantic token types (`keyword.import`, `tag.jsx`, `attribute.jsx`, `property.json_key`, `type.builtin`, …) through `codeToTokens` with a CSS-variable theme. These are richer than `pl-*`, so several `extendSyntaxTokens` heuristics would become direct mappings. The alternative is an adapter that maps token types to `pl-*` classes.
- **Token shape.** Highlights attaches whitespace to neighboring tokens (`"const "`) and merges adjacent tokens of one type (`"]}"`). It also emits a span for every punctuation and operator, which explains the larger HTML. An adapter that leaves punctuation unstyled and splits off whitespace would shrink the output. The `enhanceCode*` passes match on token text, so they would need the whitespace split off either way.
- **Simpler loading.** The API is synchronous once imported, and every language is in one module. The lazy grammar registration in `parseSource` (`grammarLoaders`, `registerGrammars`, the rebuild mutex) and `CodeProviderLazy`'s per-language chunks would no longer be needed.
- **Extensibility.** Lexers are hand-written WebAssembly Text, so docs-infra users could no longer bring a TextMate grammar for another language. In return, 152 languages are built in, against the 11 docs-infra wires up today.
- **Maturity.** The package is labeled beta. It was first published on 2026-09-09; 0.1.0 through 0.5.0 shipped between 2026-10-02 and 2026-11-09, and each minor can break the API.

## CodeMirror (Lezer)

`@lezer/highlight`'s `highlightCode` over the `@lezer/*` parsers, without `@codemirror/view` or an editor. The adapter (`src/engines/codemirrorLanguages.ts`) maps Lezer highlight tags to classes with `tagHighlighter`. The stock `classHighlighter` renders tag names as type names and has no class for function names or attributes, so docs-infra would need its own mapping too.

It is 3–5× faster than Starry Night and uses a seventh of the memory, but it is 9–15× slower than highlights. Its strength is payload: each language is its own package, so the per-language lazy loading docs-infra already does maps onto it. A tsx-only page needs 49 KiB gzip, a quarter of Starry Night's.

Coverage gaps for the 11 docs-infra languages:

- **No MDX grammar.** The adapter parses MDX as Markdown and hands HTML blocks to the TSX parser, so JSX elements highlight. `import`/`export` lines and `{expressions}` stay plain paragraph text.
- **No Lezer grammar for `sh` or `diff`.** Both come from `@codemirror/legacy-modes` through `StreamLanguage`, which needs `@codemirror/language` and with it `@codemirror/state` and `@codemirror/view`. That costs 77 KiB gzip: all 11 languages are 161 KiB, the 9 Lezer grammars alone 84 KiB. The legacy shell mode is also the weakest highlighter in the comparison: it leaves command names and `$(…)` substitutions unstyled and marks the shebang as meta.
- **Markdown fences** need a `codeParser` that maps the info string to a parser, which the adapter does for the 11 languages.

What adopting it would take: the same `pl-*` class migration as highlights, against Lezer's tag vocabulary (`tags.function(tags.variableName)`, `tags.tagName`, `tags.attributeName`, `tags.definition(…)`, …). Lezer's tokens are tight, so whitespace stays outside spans, and nested tags stack their classes, least specific first. Lezer grammars are written in its own grammar format, so as with highlights, docs-infra users could not reuse TextMate grammars.

## Token data and syntax trees

Both alternatives return token data, not just HTML. Only Lezer returns a syntax tree.

- **highlights** has no tree; its lexers classify tokens from nearby tokens and saved state. `codeToTokens` returns per-line `ThemedToken`s (`content`, UTF-16 `offset`, `color`, and `type`: 0 other, 1 comment, 2 string, 3 regex). With a CSS-variable theme, `color` is `var(--hls-<token-type>)`, which is how the adapter recovers the token type. `LiveTokenizer#getLineRecords` exposes the raw records directly: one `(tokenId << 24) | end` word per token, with `tokenId` indexing the exported `tokenNames`. Finding imports from tokens means writing a small parser over `keyword.import` and `string` runs.
- **Lezer** returns a concrete syntax tree with named nodes (`ImportDeclaration`, `ImportGroup`, `ExportDeclaration`, `DynamicImport`, `LineComment`, …) and offsets, and one tree serves both highlighting and analysis. It is not a Babel-style AST: there are no semantic fields, so values come from slicing the source at node offsets. Parsing is error-tolerant and supports incremental reparsing.

`benchmark:imports` (`src/imports.ts`, `src/lezerImports.ts`) extracts imports with a 140-line tree walk and compares the result with docs-infra's 1,940-line `parseImportsAndComments` on all 1,064 JS/TS files in docs-infra and its docs (3,720 specifiers):

| step                                 | total ms |
| :----------------------------------- | -------: |
| docs-infra `parseImportsAndComments` |       85 |
| Lezer parse + extract                |    1,489 |
| Lezer extract from an existing tree  |       37 |
| Lezer highlight from the same tree   |      134 |

They disagree on 70 specifiers, with names, aliases, type-only flags and positions identical everywhere else:

- 58 are docs-infra false positives: import statements inside template strings and comments, mostly in its own tests, but also in `CredentialsCode.tsx`, `ensureDemoPages.ts`, `enhanceChildren.ts` and `formatRaw.ts`. Lezer correctly ignores them.
- 12 are Lezer gaps: `@lezer/javascript` 1.5.6 does not parse `export type * from '…'` (TS 5.0) or inline `type` modifiers in export lists (`export { a, type B } from '…'`, TS 4.5). With several modifiers, error recovery loses the whole statement. These gaps affect highlighting too.

A Lezer parse costs 17× more than the targeted scanner, so replacing it only pays off when the tree is already built for highlighting. docs-infra rewrites imports and strips comments before it highlights, so sharing one tree would mean restructuring that pipeline or reparsing incrementally.
