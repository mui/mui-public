# Syntax highlighting benchmark

Compares syntax highlighting engines as candidates to replace [Starry Night](https://github.com/wooorm/starry-night) in `@mui/internal-docs-infra`.

```bash
pnpm release:build   # docs-infra is linked through its build output
pnpm -F ./test/syntax-highlight-benchmark benchmark
pnpm -F ./test/syntax-highlight-benchmark benchmark --engines starry-night,highlights --cold-runs 3 --skip-bundles
pnpm -F ./test/syntax-highlight-benchmark benchmark:disagreements highlights css
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

## Results: `@pierre/highlights`

[`@pierre/highlights`](https://diffs.com/highlights) 0.5.1 against `@wooorm/starry-night` 3.11.0, Node 26.13.1 on an Apple M1, 16 GiB.

| metric                                   | starry-night |    highlights |       ratio |
| :--------------------------------------- | -----------: | ------------: | ----------: |
| warm, whole corpus (7,676 lines)         |       260 ms |        6.4 ms |  40× faster |
| warm, 12-line tsx snippet                |      0.36 ms |      0.014 ms |  25× faster |
| warm, 2,418-line ts file                 |       145 ms |        2.7 ms |  54× faster |
| cold: import + init + first highlight    |       393 ms |         15 ms |  26× faster |
| peak RSS growth                          |      376 MiB |        30 MiB | 12× smaller |
| browser payload, tsx only (gzip)         |      213 KiB | 184 KiB (all) | 14% smaller |
| browser payload, all 11 languages (gzip) |      320 KiB | 184 KiB (all) | 42% smaller |
| elements across corpus                   |       21,529 |        32,833 |    52% more |
| serialized HTML across corpus            |      830 KiB |     1,555 KiB |    87% more |

Speed-ups by language range from 10× (diff) to 69× (yaml). `extendSyntaxTokens` and line gutters add about 3% to Starry Night's time, so the engine dominates `parseSource`.

Starry Night's payload counts `onig.wasm` (473 KiB raw), which it fetches separately at runtime. Highlights ships one 300 KiB Wasm module with all 152 languages, inlined as base64 in its JS, so it cannot be split per language. It is still smaller than Starry Night with only the tsx grammar.

### Highlighting quality

Agreement with Starry Night is 99.7% for `ts`, 100% for `json`, 95% for `yaml` and `diff`, and 87% for `tsx` and `html`. The lower numbers are mostly taxonomy, not errors:

- `tsx` tags: Starry Night colors component tags (`<Menu.Item>`) as constants and only lowercase tags as tags.
- `md`/`mdx`: Starry Night colors inline-code backticks and link brackets as strings.
- `css`: Starry Night colors attribute selectors as tags and does not know newer properties such as `view-transition-name`.

`js` (23%) is a Starry Night bug. Its `source.js` grammar never leaves a template literal whose `${…}` contains `?.` or `??`, so the rest of the file renders as a string. `` `${a?.b}` `` is enough to trigger it. `source.ts` and `source.tsx` handle it, and docs-infra maps `.js` files to `source.js`. Highlights handles these files correctly and also tokenizes JSDoc tags.

### What adopting it would take

- **Class names.** docs-infra is built on Starry Night's `pl-*` classes: `extendSyntaxTokens`, `enhanceCodeTypes`, `enhanceCodeInline`, `enhanceCodeEmphasis`, `hastDictionary`, `loadServerTypes` and the demo themes all key on them. Highlights exposes semantic token types (`keyword.import`, `tag.jsx`, `attribute.jsx`, `property.json_key`, `type.builtin`, …) through `codeToTokens` with a CSS-variable theme. These are richer than `pl-*`, so several `extendSyntaxTokens` heuristics would become direct mappings. The alternative is an adapter that maps token types to `pl-*` classes.
- **Token shape.** Highlights folds whitespace into the next or previous token (`"const "`) and merges adjacent tokens of one type (`"]}"`). It also emits a span for every punctuation and operator. That explains the 87% larger HTML. An adapter that leaves punctuation unstyled and splits off whitespace would cut it down, and the `enhanceCode*` passes depend on token boundaries, so it is needed anyway.
- **Simpler loading.** The API is synchronous once imported, and every language is in one module. The lazy grammar registration in `parseSource` (`grammarLoaders`, `registerGrammars`, the rebuild mutex) and `CodeProviderLazy`'s per-language chunks would no longer be needed.
- **Extensibility.** Lexers are hand-written WebAssembly Text, so docs-infra users could no longer bring a TextMate grammar for another language. In return, 152 languages are built in, against the 11 docs-infra wires up today.
- **Maturity.** The package is labeled beta. It was first published on 2026-09-09; 0.1.0 through 0.5.0 shipped between 2026-10-02 and 2026-11-09, and each minor can break the API.
