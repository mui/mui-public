import { create, patch } from 'jsondiffpatch';
import type { Element, ElementContent, Nodes, Root } from 'hast';
import { type Transforms } from '../../CodeHighlighter/types';

/**
 * Async-friendly variant of {@link ParseSource}. The build-time diff path
 * may wrap the synchronous highlighter with enhancers that need to run
 * asynchronously, so `diffHast` accepts either return shape.
 */
type AsyncParseSource = (
  source: string,
  fileName: string,
  language?: string,
) => Nodes | Promise<Nodes>;

const differ = create({
  omitRemovedValues: true,
  cloneDiffValues: true,
  // Give jsondiffpatch a stable identity per array item so it can't match a
  // `<span class="line">` to a `<span class="collapse">` placeholder by
  // position. Without this, the LCS matcher happily aligns the source
  // wiped-line span at index N with the transform placeholder at index N
  // and emits a noisy in-place mutation (rewrite className, swap
  // `dataLn`→`dataLines`, wipe N children). With distinct hashes the
  // placeholder becomes a clean insert and the wiped line spans become
  // deletes.
  objectHash: (value: unknown, index?: number) => {
    if (value === null || typeof value !== 'object') {
      return `idx:${index}`;
    }
    const node = value as { type?: string; tagName?: string; properties?: Record<string, unknown> };
    if (node.type === 'element' && node.tagName === 'span') {
      const cls = node.properties?.className;
      const className = Array.isArray(cls) ? cls.join(' ') : cls;
      // Collapse placeholders get a unique identity so jsondiffpatch
      // can't morph a wiped line span into a placeholder in place.
      if (className === 'collapse') {
        return `collapse:${index}`;
      }
    }
    // Everything else (frames, lines, text) falls back to positional
    // identity — same as jsondiffpatch's default behavior — so we don't
    // accidentally force unrelated nodes apart.
    return `idx:${index}`;
  },
});

/**
 * `.line` element produced by addLineGutters. For non-empty lines the
 * `\n` lives as a sibling text node outside the span, so an empty source
 * line is either `<span.line></span>` (legacy) or `<span.line>\n</span>`
 * — the latter form holds its own `\n` inside so block-level styles give
 * the row a visible height without injecting invisible characters that
 * would end up in the clipboard.
 */
function isEmptyLine(line: Element): boolean {
  if (line.children.length === 0) {
    return true;
  }
  if (line.children.length === 1) {
    const only = line.children[0];
    return only.type === 'text' && (only.value === '\n' || only.value === '\u200B');
  }
  return false;
}

function isLineElement(node: ElementContent | undefined): node is Element {
  return (
    !!node &&
    node.type === 'element' &&
    node.tagName === 'span' &&
    node.properties != null &&
    node.properties.className === 'line'
  );
}

/**
 * Strip `dataLn` from `.line` elements directly under each frame. Walks
 * `root.children → frame.children` only — never descends into a line's
 * highlighted spans (which are the bulk of the tree).
 */
function stripLineNumbersInPlace(root: Nodes) {
  if (root.type !== 'root') {
    return;
  }
  const frames = (root as Root).children;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (frame.type !== 'element') {
      continue;
    }
    const lines = frame.children;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (
        line.type === 'element' &&
        line.properties != null &&
        line.properties.className === 'line' &&
        line.properties.dataLn !== undefined
      ) {
        delete line.properties.dataLn;
      }
    }
  }
}

/**
 * Reassign sequential 1-indexed `dataLn` values to every `.line` element
 * directly under each frame. Used to restore numbering on `parsedSource`
 * after the diff (addLineGutters always numbers 1..N in document order,
 * so re-deriving is correct).
 */
function renumberLinesInPlace(root: Nodes) {
  if (root.type !== 'root') {
    return;
  }
  let lineNumber = 0;
  const frames = (root as Root).children;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (frame.type !== 'element') {
      continue;
    }
    const children = frame.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (
        child.type === 'element' &&
        child.properties != null &&
        child.properties.className === 'line'
      ) {
        lineNumber += 1;
        child.properties.dataLn = lineNumber;
      }
    }
  }
  if (root.data && 'totalLines' in root.data) {
    (root.data as { totalLines: number }).totalLines = lineNumber;
  }
}

/**
 * One contiguous run of wiped lines inside a single frame, expressed in
 * positions of `frame.children`. The slice `[start, endExclusive)` covers
 * the wiped `.line` spans, their trailing `\n` text siblings, and any
 * absorbed originally-blank line. `count` is the number of source rows
 * the replacement placeholder should cover.
 */
interface WipedRun {
  start: number;
  endExclusive: number;
  count: number;
}

/**
 * Walk a frame's children and group consecutive wiped `.line` spans
 * (together with their trailing `\n` siblings, plus optionally one
 * trailing originally-blank line) into runs. `counter` is a shared
 * 1-indexed line number advanced for every `.line` element encountered
 * (addLineGutters numbers lines 1..N in document order across frames).
 */
function collectWipedRunsInFrame(
  frame: Element,
  wiped: Set<number>,
  counter: { value: number },
): WipedRun[] {
  const runs: WipedRun[] = [];
  const children = frame.children;
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (!isLineElement(child)) {
      i += 1;
      continue;
    }
    counter.value += 1;
    if (!wiped.has(counter.value)) {
      i += 1;
      continue;
    }
    const runStart = i;
    let count = 1;
    i += 1;
    // Consume the trailing `\n` text sibling of this wiped line.
    if (i < children.length) {
      const sibling = children[i];
      if (sibling.type === 'text' && sibling.value === '\n') {
        i += 1;
      }
    }
    while (i < children.length) {
      const peek = children[i];
      if (!isLineElement(peek)) {
        break;
      }
      counter.value += 1;
      if (wiped.has(counter.value)) {
        count += 1;
        i += 1;
        if (i < children.length) {
          const sibling = children[i];
          if (sibling.type === 'text' && sibling.value === '\n') {
            i += 1;
          }
        }
        continue;
      }
      // Absorb one trailing originally-blank line into the collapsed
      // region so the boundary doesn't leave a stray blank row, plus its
      // own trailing `\n` sibling.
      if (isEmptyLine(peek)) {
        count += 1;
        i += 1;
        if (i < children.length) {
          const sibling = children[i];
          if (sibling.type === 'text' && sibling.value === '\n') {
            i += 1;
          }
        }
      } else {
        // Survivor: un-advance the line counter so the outer loop
        // re-processes this child.
        counter.value -= 1;
      }
      break;
    }
    runs.push({ start: runStart, endExclusive: i, count });
  }
  return runs;
}

function makePlaceholder(count: number): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: 'collapse', dataLines: count },
    children: [],
  };
}

/**
 * For each frame, find wiped-line runs and splice them in place with a
 * single `<span class="collapse" data-lines={count}></span>` placeholder.
 * Run on
 * *both* the source and transform trees before diffing — the placeholders
 * line up structurally, so jsondiffpatch matches them and the resulting
 * delta cleanly represents the collapse without us having to surgically
 * rewrite array-position keys after the fact.
 *
 * The source tree's wiped runs are the originals being replaced; the
 * transform tree's wiped runs are now-empty `.line` spans (the transform
 * blanked their content). Both runs span the same 1-indexed line numbers,
 * but at *different* `frame.children` positions because the empty-line
 * encoding may differ between source and transform (e.g. the transform
 * may emit `<span.line>\n</span>` with no sibling `\n`).
 */
function compactCollapseInTreeInPlace(tree: Nodes, wiped: Set<number>): void {
  if (tree.type !== 'root') {
    return;
  }
  const counter = { value: 0 };
  const frames = (tree as Root).children;
  let lastFrame: Element | undefined;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (frame.type !== 'element') {
      continue;
    }
    lastFrame = frame;
    const runs = collectWipedRunsInFrame(frame, wiped, counter);
    if (runs.length === 0) {
      continue;
    }
    // Splice from the end so earlier indices stay valid.
    for (let r = runs.length - 1; r >= 0; r -= 1) {
      const run = runs[r];
      frame.children.splice(run.start, run.endExclusive - run.start, makePlaceholder(run.count));
    }
  }
  // Trailing wiped lines that the transform parser elided: when the
  // transformed source ends with `\n` (because the blanked line carried no
  // content), `addLineGutters` doesn't emit a `.line` span for that final
  // blank row, so the counter walk above never reaches them. Append a
  // single placeholder to the last frame covering all such trailing rows
  // so the diff still produces a collapsed-lines span at the end.
  let trailingCount = 0;
  for (const lineNumber of wiped) {
    if (lineNumber > counter.value) {
      trailingCount += 1;
    }
  }
  if (trailingCount > 0 && lastFrame) {
    lastFrame.children.push(makePlaceholder(trailingCount));
  }
}

export async function diffHast(
  source: string,
  parsedSource: Nodes,
  filename: string,
  transforms: Transforms,
  parseSource: AsyncParseSource,
): Promise<Record<string, any>> {
  const originalLines = source.split('\n');

  // Strip `dataLn` from `parsedSource` so the diff doesn't encode the
  // always-sequential numbering. Restored in `finally`.
  stripLineNumbersInPlace(parsedSource);

  try {
    const transformed = await Promise.all(
      Object.entries(transforms).map(async ([key, transform]) => {
        const patched = patch(originalLines.slice(), transform.delta);
        if (!Array.isArray(patched)) {
          throw new Error(`Patch for ${key} did not return an array`);
        }

        const patchedLines = patched as string[];
        const transformedSource = patchedLines.join('\n');
        const parsedTransform = await parseSource(
          transformedSource,
          transform.fileName || filename,
        );

        // Wiped lines = 1-indexed source lines the transform blanked out.
        const wiped = new Set<number>();
        const limit = Math.min(originalLines.length, patchedLines.length);
        for (let i = 0; i < limit; i += 1) {
          if (patchedLines[i] === '' && originalLines[i] !== '') {
            wiped.add(i + 1);
          }
        }

        stripLineNumbersInPlace(parsedTransform);

        // Collapse wiped-line runs in the transform tree into a single
        // `<span class="collapse" data-lines={count}></span>` placeholder per run
        // before diffing. The source tree is left intact (it's shared
        // across transforms), so jsondiffpatch sees the now-empty source
        // lines being replaced by the placeholder — a clean, minimal
        // delta with no spurious LCS matches between unrelated lines.
        if (wiped.size > 0) {
          compactCollapseInTreeInPlace(parsedTransform, wiped);
        }

        // Diff 1:1. The caller is responsible for ensuring `parseSource`
        // produces a frame structure aligned with `parsedSource` (e.g.
        // by wrapping it to apply the same source enhancers); without
        // that, the diff balloons at the frame level.
        const delta = differ.diff(parsedSource, parsedTransform);

        return {
          [key]: {
            ...transform,
            delta,
          },
        };
      }),
    );

    return Object.assign({}, ...transformed);
  } finally {
    renumberLinesInPlace(parsedSource);
  }
}
