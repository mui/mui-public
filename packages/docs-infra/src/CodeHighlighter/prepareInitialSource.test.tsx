/**
 * Producer→client round-trip for residual fallbacks. `prepareInitialSource`
 * compresses the fallbacks the loading UI won't render into a single DEFLATE
 * blob (kept compressed for the wire) and strips them off `codeForClient`. The
 * client must decompress that blob with the RENDERED subset's text (its
 * dictionary) and scatter the fallbacks back onto the code, so every variant
 * carries its own dictionary so each compressed variant can be decoded from the
 * `hastCompressed` source via `code.fallback`, not the active-only hoist. These
 * tests pin the round-trip end to end with a real compressed source, since the
 * failure mode is a decode-time "invalid distance" only a matching dictionary avoids.
 */
import { describe, it, expect, vi } from 'vitest';
import type * as React from 'react';
import type { Element as HastElement } from 'hast';
import { buildRootFallback, buildCriticalFallback, fallbackToText } from './fallbackFormat';
import type { FallbackElement, FallbackNode } from './fallbackFormat';
import { getInitialVisibleFrames } from '../pipeline/parseSource/frameVisibility';
import {
  decompressResidualFallbacks,
  residualDictionaryText,
  scatterResidualFallbacks,
} from './fallbackCompression';
import type { Code, HastRoot, VariantCode } from './types';
import { compressHast } from '../pipeline/hastUtils';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import * as decodeHastSourceModule from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { createEnhanceCodeEmphasis } from '../pipeline/enhanceCodeEmphasis';
import { prepareInitialSource } from './prepareInitialSource';

function framedRoot(
  lineText: string,
  counts: { totalLines: number; focusedLines: number; collapsible?: boolean } = {
    totalLines: 1,
    focusedLines: 1,
    collapsible: false,
  },
): HastRoot {
  return {
    type: 'root',
    data: counts,
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame' },
        data: { fallback: [{ type: 'text', value: lineText }] } as HastElement['data'],
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: lineText }],
          },
        ],
      },
    ],
  };
}

/**
 * Build a `{ hastCompressed }` source the way the loader does: derive the root
 * fallback, strip the per-frame `data.fallback`, and compress with the fallback
 * text as the DEFLATE dictionary. Decoding REQUIRES the matching fallback — a
 * missing/mismatched one throws "invalid distance". Made long enough that the
 * residual blob clears `FALLBACK_COMPRESSION_MIN_BYTES` (so the bug's wire-code
 * path is exercised, not the small-residual inline path).
 */
function buildCompressedVariant(
  seed: string,
  counts?: { totalLines: number; focusedLines: number; collapsible?: boolean },
): {
  source: { hastCompressed: string };
  fallback: FallbackNode[];
  fallbackCritical: { [frameIndex: number]: FallbackNode };
} {
  const root = framedRoot(`const ${seed} = "${'x'.repeat(200)}";`, counts);
  const fallback = buildRootFallback(root);
  // The sparse highlighted-visible companion the loader bakes alongside `fallback`.
  const fallbackCritical = buildCriticalFallback(root, getInitialVisibleFrames(root, false));
  const stripped = JSON.parse(JSON.stringify(root)) as HastRoot;
  delete (stripped.children[0] as HastElement).data!.fallback;
  return {
    // Fresh object per call so the decode WeakMap never bridges cases.
    source: { hastCompressed: compressHast(JSON.stringify(stripped), fallbackToText(fallback)) },
    fallback,
    fallbackCritical,
  };
}

function ContentLoading(): null {
  return null;
}
function Content(): null {
  return null;
}

/** The variant's `fallback` if it resolved to an object, else `undefined`. */
function fallbackOf(code: Code, variant: string): FallbackNode[] | undefined {
  const entry = code[variant];
  return entry && typeof entry === 'object' ? (entry as VariantCode).fallback : undefined;
}

describe('prepareInitialSource residual round-trip', () => {
  it('keeps residual fallbacks compressed off the code, and the client decompresses them back so a non-rendered variant decodes', () => {
    const first = buildCompressedVariant('first');
    const second = buildCompressedVariant('second');
    const code = {
      First: { fileName: 'a.tsx', source: first.source, fallback: first.fallback },
      Second: { fileName: 'a.tsx', source: second.source, fallback: second.fallback },
    } as unknown as Code;

    const { codeForClient, residualFallbacks } = prepareInitialSource({
      code,
      initialVariant: 'First',
      initialFilename: 'a.tsx',
      initialSource: first.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    // Compression is kept: nothing inline on the wire code — the rendered (First)
    // fallback hoists to the loading UI, the non-rendered (Second) rides the blob.
    expect(residualFallbacks).toBeDefined();
    expect(fallbackOf(codeForClient, 'First')).toBeUndefined();
    expect(fallbackOf(codeForClient, 'Second')).toBeUndefined();

    // Client: the rendered variant's fallback arrives via the hoist; decompress
    // the blob with that dictionary and scatter the fallbacks back onto the code.
    const hoisted = { First: { 'a.tsx': first.fallback } };
    const residualMap = decompressResidualFallbacks(
      residualFallbacks!,
      residualDictionaryText(hoisted),
    );
    const resolved = scatterResidualFallbacks(codeForClient, residualMap);

    // The non-rendered variant now carries its dictionary on the code.
    expect(fallbackOf(resolved, 'Second')).toBeDefined();

    // The target source decodes through its restored dictionary instead of
    // throwing "invalid distance".
    expect(() => decodeHastSource(second.source, fallbackOf(resolved, 'Second'))).not.toThrow();
  });

  it('hoists every variant fallback off the code with fallbackUsesAllVariants', () => {
    const first = buildCompressedVariant('first');
    const second = buildCompressedVariant('second');
    const code = {
      First: { fileName: 'a.tsx', source: first.source, fallback: first.fallback },
      Second: { fileName: 'a.tsx', source: second.source, fallback: second.fallback },
    } as unknown as Code;

    const { codeForClient } = prepareInitialSource({
      code,
      initialVariant: 'First',
      initialFilename: 'a.tsx',
      initialSource: first.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      fallbackUsesAllVariants: true,
    });

    // Every variant is rendered by the loading UI, so all fallbacks hoist off the code.
    expect(fallbackOf(codeForClient, 'First')).toBeUndefined();
    expect(fallbackOf(codeForClient, 'Second')).toBeUndefined();
  });

  it('under fallbackUsesAllVariants every variant decodes once the hoist is scattered onto the code', () => {
    const first = buildCompressedVariant('first');
    const second = buildCompressedVariant('second');
    const code = {
      First: { fileName: 'a.tsx', source: first.source, fallback: first.fallback },
      Second: { fileName: 'a.tsx', source: second.source, fallback: second.fallback },
    } as unknown as Code;

    const { codeForClient } = prepareInitialSource({
      code,
      initialVariant: 'First',
      initialFilename: 'a.tsx',
      initialSource: first.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      fallbackUsesAllVariants: true,
    });

    // With every variant hoisted there is no residual blob; the dictionaries live
    // only in the hoist, so the client scatters THAT onto the code.
    const hoisted = {
      First: { 'a.tsx': first.fallback },
      Second: { 'a.tsx': second.fallback },
    };
    const resolved = scatterResidualFallbacks(codeForClient, hoisted);

    expect(fallbackOf(resolved, 'First')).toBeDefined();
    expect(fallbackOf(resolved, 'Second')).toBeDefined();
    // Both variants decode via their on-code dictionaries.
    expect(() => decodeHastSource(first.source, fallbackOf(resolved, 'First'))).not.toThrow();
    expect(() => decodeHastSource(second.source, fallbackOf(resolved, 'Second'))).not.toThrow();
  });

  it('skips residual compression on the client (compressResidual: false) and keeps fallbacks inline', () => {
    // A client render (e.g. an all-client Pages-Router app) has no wire to shrink, so
    // it must NOT compress the residual only for `CodeHighlighterClient` to decompress
    // it back. With `compressResidual: false` there is no residual blob, and EVERY
    // variant keeps its fallback inline on the code (contrast the compressed case above,
    // where the rendered/non-rendered fallbacks are stripped off `codeForClient`).
    const first = buildCompressedVariant('first');
    const second = buildCompressedVariant('second');
    const code = {
      First: { fileName: 'a.tsx', source: first.source, fallback: first.fallback },
      Second: { fileName: 'a.tsx', source: second.source, fallback: second.fallback },
    } as unknown as Code;

    const { codeForClient, residualFallbacks } = prepareInitialSource({
      code,
      initialVariant: 'First',
      initialFilename: 'a.tsx',
      initialSource: first.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      compressResidual: false,
    });

    expect(residualFallbacks).toBeUndefined();
    // The rendered variant (First) is hoisted to the loading UI either way; the
    // non-rendered variant (Second) keeps its fallback INLINE on the code rather than
    // being stripped into a compressed residual blob — so nothing decompresses.
    expect(fallbackOf(codeForClient, 'First')).toBeUndefined();
    expect(fallbackOf(codeForClient, 'Second')).toBeDefined();
  });
});

describe('prepareInitialSource line counts', () => {
  it('reads STORED variant line counts instead of decompressing the source', () => {
    // The loader now hoists the window counts off `root.data` onto the variant
    // (see `loadSingleFile`). With those present, `prepareInitialSource` reads them
    // directly to window the loading fallback — it must NOT decompress the
    // `hastCompressed` source just to recover `totalLines`/`focusedLines`/`collapsible`,
    // which would put a decode on the first (hydration) render.
    const first = buildCompressedVariant('first', { totalLines: 5, focusedLines: 5 });
    const code = {
      First: {
        fileName: 'a.tsx',
        source: first.source,
        fallback: first.fallback,
        // The hoisted counts the loader ships on the variant.
        totalLines: 5,
        focusedLines: 5,
        collapsible: false,
      },
    } as unknown as Code;

    const decodeSpy = vi.spyOn(decodeHastSourceModule, 'decodeHastSource');
    prepareInitialSource({
      code,
      initialVariant: 'First',
      initialFilename: 'a.tsx',
      initialSource: first.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    expect(decodeSpy).not.toHaveBeenCalled();
    decodeSpy.mockRestore();
  });

  it('falls back to decoding the source when the variant has NO stored counts (legacy)', () => {
    // A variant produced before the hoist (or a hand-built one) carries no top-level
    // counts, so the windowing path must still recover them by decoding root.data.
    const first = buildCompressedVariant('first', { totalLines: 5, focusedLines: 5 });
    const code = {
      First: { fileName: 'a.tsx', source: first.source, fallback: first.fallback },
    } as unknown as Code;

    const decodeSpy = vi.spyOn(decodeHastSourceModule, 'decodeHastSource');
    prepareInitialSource({
      code,
      initialVariant: 'First',
      initialFilename: 'a.tsx',
      initialSource: first.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    expect(decodeSpy).toHaveBeenCalled();
    decodeSpy.mockRestore();
  });
});

/**
 * The loading fallback paints the compact `source`, which has dropped `root.data`
 * (where the line counts live), so `prepareInitialSource` threads them onto the
 * `ContentLoading` props instead — read here off the returned element. The
 * `ContentLoading` mirrors them as `data-total-lines` / `data-focused-lines` so the
 * loading `<code>` matches the hydrated `<Pre>` (and the collapse-to-empty CSS,
 * which keys on `data-focused-lines='0'`, applies before highlighting swaps in).
 */
describe('prepareInitialSource loading line counts', () => {
  type LoadingProps = {
    source?: FallbackNode[];
    totalLines?: number;
    focusedLines?: number;
    collapsible?: boolean;
    fallbackCollapsed?: boolean;
  };
  const loadingPropsOf = (fallback: React.ReactNode): LoadingProps =>
    (fallback as React.ReactElement<LoadingProps>).props;

  it("threads the displayed file's totalLines/focusedLines onto the ContentLoading", () => {
    const variant = buildCompressedVariant('main', {
      totalLines: 40,
      focusedLines: 12,
      collapsible: true,
    });
    const code = {
      Default: { fileName: 'a.tsx', source: variant.source, fallback: variant.fallback },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: variant.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 40,
      focusedLines: 12,
      collapsible: true,
    });
  });

  it('reports focusedLines: 0 for a collapse-to-nothing file (oversizedFocus: hide)', () => {
    // The enhancer records `focusedLines === 0` for an oversized window it hides; the
    // loading `<code>` must report 0 too so its collapse-to-empty CSS matches `<Pre>`.
    const variant = buildCompressedVariant('hidden', {
      totalLines: 40,
      focusedLines: 0,
      collapsible: true,
    });
    const code = {
      Default: { fileName: 'a.tsx', source: variant.source, fallback: variant.fallback },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: variant.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 40,
      focusedLines: 0,
      collapsible: true,
    });
  });

  it('forces focusedLines: 0 under render-time collapseToEmpty even when the file fills its window', () => {
    // `collapseToEmpty` empties the painted window regardless of the precomputed count,
    // mirroring `<Pre>`'s `collapseToEmpty ? 0 : rawFocusedLines`.
    const variant = buildCompressedVariant('full', {
      totalLines: 40,
      focusedLines: 40,
      collapsible: false,
    });
    const code = {
      Default: { fileName: 'a.tsx', source: variant.source, fallback: variant.fallback },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: variant.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      collapseToEmpty: true,
    });

    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 40,
      focusedLines: 0,
      collapsible: true,
    });
  });

  it('windows an inline string source via sourceEnhancers so the loading <code> is collapsible (not N/N)', () => {
    // An inline string source (no precompute) otherwise wraps the whole file in one
    // un-windowed focus frame → focusedLines === totalLines → not collapsible → the
    // full file flashes. Running the configured enhancer here windows it to the
    // focus window, matching the live render.
    const source = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join(
      '\n',
    );
    const code = { Default: { fileName: 'a.tsx', source } } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      sourceEnhancers: [createEnhanceCodeEmphasis({ focusFramesMaxSize: 12 })],
    });

    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 30,
      focusedLines: 12,
      collapsible: true,
    });
  });

  it('carries the windowed counts onto codeForClient so the content base render stays collapsible', () => {
    // Regression: the windowed counts a deferred inline-string source produces were
    // threaded to the ContentLoading but NOT onto `codeForClient`. So the content
    // component's base render (before `hast` decodes) read the raw, non-collapsible
    // string count and `data-collapsible` flashed off (present→absent→present). The
    // counts must ride the wire code too.
    const source = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join(
      '\n',
    );
    const code = { Default: { fileName: 'a.tsx', source } } as unknown as Code;

    const { codeForClient } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      sourceEnhancers: [createEnhanceCodeEmphasis({ focusFramesMaxSize: 12 })],
    });

    expect(codeForClient.Default as VariantCode).toMatchObject({
      totalLines: 30,
      focusedLines: 12,
      collapsible: true,
    });
  });

  it('uses the same comment line indexing as the highlighted render when windowing inline fallback frames', () => {
    const source = `import * as React from 'react';

interface Item {
  id: string;
  label: string;
  email: string;
}

interface ItemListProps {
  items: Item[];
  onSelect: (item: Item) => void;
}

export function ItemList({ items, onSelect }: ItemListProps) {
  const [query, setQuery] = React.useState<string>('');

  const filtered = items.filter((item: Item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <ul>
      {filtered.map((item: Item) => (
        <li key={item.id} onClick={() => onSelect(item)}>
          {item.label}
        </li>
      ))}
    </ul>
  );
}`;
    const code = {
      Default: {
        fileName: 'ItemList.tsx',
        source,
        comments: {
          // Loader-stored `variant.comments` are 1-indexed (see `mergeComments`), the
          // same convention the highlighted render reads. `@focus-start` on line 14 is
          // `export function ItemList`; `prepareInitialSource` must not re-shift them.
          14: ['@focus-start'],
          31: ['@focus-end'],
        },
      },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'ItemList.tsx',
      initialSource: source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      sourceEnhancers: [createEnhanceCodeEmphasis({ paddingFrameMaxSize: 3 })],
    });

    const sourceFallback = loadingPropsOf(fallback).source as FallbackElement[];
    expect(sourceFallback[0][sourceFallback[0].length - 1]).toBe(
      "import * as React from 'react';\n\n" +
        'interface Item {\n' +
        '  id: string;\n' +
        '  label: string;\n' +
        '  email: string;\n' +
        '}\n\n' +
        'interface ItemListProps {\n' +
        '  items: Item[];\n' +
        '  onSelect: (item: Item) => void;\n' +
        '}\n\n',
    );
    expect(sourceFallback[1][sourceFallback[1].length - 1]).toMatch(/^export function ItemList/);
  });

  it('leaves an inline string source as one frame (focusedLines === totalLines) when no enhancers are configured', () => {
    const source = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join(
      '\n',
    );
    const code = { Default: { fileName: 'a.tsx', source } } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    // No enhancers → no windowing → the string path's single focus frame, counted
    // off the raw string (focusedLines === totalLines, so not collapsible).
    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 30,
      focusedLines: 30,
      collapsible: false,
    });
  });

  it('threads loader-surfaced line counts for a URL-deferred string source', () => {
    // The URL-deferred path keeps `source` a string and frames the fallback in-loader,
    // surfacing the window counts as top-level `totalLines`/`focusedLines` on the
    // variant. Here there are no render-time enhancers, so `prepareInitialSource` reads
    // those loader counts (12/40) instead of counting the raw string (40/40).
    const code = {
      Default: {
        fileName: 'a.tsx',
        source: 'const x = 1;',
        fallback: [['span', 'frame', { dataFrameType: 'focus' }, 'const x = 1;']],
        totalLines: 40,
        focusedLines: 12,
        collapsible: true,
      },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: 'const x = 1;',
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 40,
      focusedLines: 12,
      collapsible: true,
    });
  });

  it('does not infer collapsible from loader-surfaced line counts', () => {
    const code = {
      Default: {
        fileName: 'a.tsx',
        source: 'const x = 1;',
        fallback: [['span', 'frame', { dataFrameType: 'focus' }, 'const x = 1;']],
        totalLines: 40,
        focusedLines: 12,
        collapsible: false,
      },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: 'const x = 1;',
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
    });

    expect(loadingPropsOf(fallback)).toMatchObject({
      totalLines: 40,
      focusedLines: 12,
      collapsible: false,
    });
  });

  it('honors contentProps initialExpanded when deciding whether to collapse the loading fallback', () => {
    const variant = buildCompressedVariant('expanded', {
      totalLines: 40,
      focusedLines: 12,
      collapsible: true,
    });
    const code = {
      Default: { fileName: 'a.tsx', source: variant.source, fallback: variant.fallback },
    } as unknown as Code;

    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Default',
      initialFilename: 'a.tsx',
      initialSource: variant.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      fallbackCollapsed: true,
      contentProps: { initialExpanded: true },
    });

    expect(loadingPropsOf(fallback).fallbackCollapsed).toBeUndefined();
  });
});

describe('prepareInitialSource highlightAfter: init', () => {
  const sourceOf = (fallback: React.ReactNode): FallbackNode[] | undefined =>
    (fallback as React.ReactElement<{ source?: FallbackNode[] }>).props.source;

  function prepared(highlightAfter?: 'init') {
    const variant = buildCompressedVariant('init');
    const code = {
      Main: {
        fileName: 'a.tsx',
        source: variant.source,
        fallback: variant.fallback,
        // The loader bakes the highlighted-visible companion; `prepareInitialSource`
        // promotes it into the loading fallback for `init` (no decode).
        fallbackCritical: variant.fallbackCritical,
      },
    } as unknown as Code;
    const { fallback } = prepareInitialSource({
      code,
      initialVariant: 'Main',
      initialFilename: 'a.tsx',
      initialSource: variant.source,
      ContentLoading,
      Content,
      slug: 'slug',
      name: 'name',
      highlightAfter,
    });
    return { source: sourceOf(fallback), dictionary: fallbackToText(variant.fallback) };
  }

  it('ships a plain loading fallback by default (highlight deferred)', () => {
    // The visible frame is flattened to plain text — no highlighted line spans.
    expect(JSON.stringify(prepared(undefined).source)).not.toContain('dataLn');
  });

  it('ships a highlighted-visible fallback for init, with the dictionary intact', () => {
    const { source, dictionary } = prepared('init');
    // The visible frame keeps its highlighted `.line` spans (carrying `dataLn`).
    expect(JSON.stringify(source)).toContain('dataLn');
    // The extracted text is unchanged, so the compressed source still decodes
    // against it (a mismatch would throw "invalid distance" on the client).
    expect(fallbackToText(source!)).toBe(dictionary);
  });
});
