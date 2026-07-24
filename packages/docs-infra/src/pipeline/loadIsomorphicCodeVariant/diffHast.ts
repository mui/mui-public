import { create, patch } from 'jsondiffpatch';
import type { Element, ElementContent, Nodes, Root } from 'hast';
import type { SourceComments, Transforms } from '../../CodeHighlighter/types';
import { findExpandingRanges } from './findExpandingRanges';
import { createEditableSourceProjection } from './createEditableSourceProjection';

/**
 * Async-friendly variant of {@link ParseSource}. The build-time diff path
 * may wrap the synchronous highlighter with enhancers that need to run
 * asynchronously, so `diffHast` accepts either return shape. `comments`
 * is the post-transform comment map (1-indexed by line in the transformed
 * source) when the transform repositions lines; wrappers that drive
 * enhancers should prefer it over the source's own comment map so the
 * enhanced frame structure aligns with the patched output.
 */
type AsyncParseSource = (
  source: string,
  fileName: string,
  language?: string,
  comments?: SourceComments,
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
 * Concatenate the plain text carried by a frame's `data.fallback` nodes
 * (`addLineGutters` stores a single text node; `restructureFrames` may store
 * several). Used to decide whether a transform actually rewrote a frame.
 */
function frameFallbackText(nodes: ElementContent[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.value;
    } else if (node.type === 'element') {
      out += frameFallbackText(node.children);
    }
  }
  return out;
}

/**
 * Align the transform tree's frames with the source tree's frames (by document
 * order) and reconcile their per-frame `data.fallback` so the diff records, per
 * frame, *whether the transform rewrote it* — without ever leaking fallback
 * text into the delta:
 *
 * - **Unchanged frame** (fallback text matches the source frame's): alias the
 *   source frame's fallback nodes onto the transform frame so the differ sees
 *   an identical value and emits no fallback op. The decoded tree's inherited
 *   fallback then survives the patch untouched.
 * - **Rewritten frame** (text differs, or no source counterpart): delete the
 *   transform frame's fallback. Because the source frame keeps its own, the
 *   differ emits a content-less *delete* (it runs with `omitRemovedValues`).
 *
 * That delete is the build-time record of "this frame changed": on decode the
 * applier removes the stale inherited fallback and regenerates it from the
 * frame's post-transform spans, while untouched frames keep their precomputed
 * fallback. Fallback text never enters the delta, so `patch` never applies
 * fallback array operations against a regenerated frame (which would crash).
 * Walks `root.children` only — never descends into a frame's lines.
 */
function reconcileFrameFallbacksForDiffInPlace(transformRoot: Nodes, sourceRoot: Nodes): void {
  if (transformRoot.type !== 'root' || sourceRoot.type !== 'root') {
    return;
  }
  // Pair each transform frame with the source frame at the *same document
  // position*. `differ` identifies frames by their array index (the
  // `objectHash` returns `idx:${index}` for them), so the LCS matcher aligns
  // transform child `i` with source child `i` — adding or removing a frame
  // shifts the tail on *both* sides identically. Reconciling by that same
  // index keeps this pass in lockstep with the diff: a transform frame is only
  // aliased to a source fallback the differ will actually compare it against,
  // so a frame the transform added (or that has no fallback-bearing source
  // counterpart at its position) falls through to the delete branch and
  // regenerates instead of inheriting an unrelated frame's fallback. A prior
  // implementation walked a separate counter over only the fallback-bearing
  // frames, which drifted out of alignment with the diff whenever a frame was
  // inserted/removed or a non-fallback frame sat between two fallback frames.
  const sourceChildren = (sourceRoot as Root).children;
  const transformChildren = (transformRoot as Root).children;
  for (let index = 0; index < transformChildren.length; index += 1) {
    const child = transformChildren[index];
    if (child.type !== 'element' || !child.data || child.data.fallback === undefined) {
      continue;
    }
    const sourceChild = sourceChildren[index];
    const sourceFallback = sourceChild?.type === 'element' ? sourceChild.data?.fallback : undefined;
    if (
      sourceFallback !== undefined &&
      frameFallbackText(sourceFallback) === frameFallbackText(child.data.fallback)
    ) {
      // Unchanged: alias the source nodes so the diff sees an identical
      // fallback (even if the node split differs) and emits nothing.
      child.data.fallback = sourceFallback;
    } else {
      // Rewritten (or no source counterpart): drop it so the diff emits a
      // content-less delete that the applier turns into a regeneration.
      delete child.data.fallback;
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
  // One empty `<span/>` child per collapsed line. Consumer CSS can
  // give each child `display: block` + `height: var(--line-height)` to
  // size the placeholder by intrinsic layout (no `attr()` or per-count
  // fallback rules required) and animate per-line height independently.
  // Both diff sides emit identical children, so jsondiffpatch still
  // matches the placeholders structurally and produces an empty sub-
  // delta for them.
  const children: Element[] = [];
  for (let i = 0; i < count; i += 1) {
    children.push({ type: 'element', tagName: 'span', properties: {}, children: [] });
  }
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: 'collapse', dataLines: count },
    children,
  };
}

/**
 * For each frame, find wiped-line runs and splice them in place with a
 * single `<span class="collapse" data-lines={count}>` placeholder
 * (carrying `count` empty `<span/>` children, one per collapsed line).
 * Run on *both* the source and transform trees before diffing — the
 * placeholders line up structurally, so jsondiffpatch matches them and
 * the resulting delta cleanly represents the collapse without us
 * having to surgically rewrite array-position keys after the fact.
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

/**
 * Diffs each transformed variant against `parsedSource` and returns
 * a `Transforms` map where every entry carries a `delta`.
 *
 * NOTE: `parsedSource` is temporarily mutated for the duration of this
 * call — `dataLn` properties are stripped from line spans before diffing
 * (so the always-sequential gutter numbering doesn't leak into the
 * delta) and restored in `finally`. Callers must not read from the tree
 * concurrently, and must not invoke `diffHast` against the same
 * `parsedSource` in parallel. Today's only caller (`loadSingleFile`)
 * runs sequentially per variant, so the constraint is satisfied; if
 * that ever changes, clone the source array once up front instead.
 */
export async function diffHast(
  source: string,
  parsedSource: Nodes,
  filename: string,
  transforms: Transforms,
  parseSource: AsyncParseSource,
  sourceComments?: SourceComments,
): Promise<Transforms> {
  const originalLines = source.split('\n');

  // Strip `dataLn` from `parsedSource` so the diff doesn't encode the
  // always-sequential numbering. Restored in `finally`.
  stripLineNumbersInPlace(parsedSource);

  // `parsedSource` keeps its per-frame `data.fallback`: each transform's tree
  // is reconciled against it (see `reconcileFrameFallbacksForDiffInPlace`) so
  // the delta encodes a content-less fallback delete only for the frames that
  // transform rewrote. The source fallback never enters the delta and stays on
  // the tree for `buildRootFallback`.

  try {
    const transformed = await Promise.all(
      Object.entries(transforms).map(async ([key, transform]) => {
        // Rename-only entries (no delta on the input manifest) have no
        // source-level change to diff — pass them through untouched so
        // the downstream embed step still preserves the rename in the
        // variant-level manifest.
        if (!transform.delta) {
          return {
            [key]: { ...transform },
          };
        }

        const patched = patch(originalLines.slice(), transform.delta);
        if (!Array.isArray(patched)) {
          throw new Error(`Patch for ${key} did not return an array`);
        }

        const patchedLines = patched as string[];
        const transformedSource = patchedLines.join('\n');
        const parsedTransform = await parseSource(
          transformedSource,
          transform.fileName || filename,
          undefined,
          transform.comments,
        );
        const sourceProjection =
          parsedTransform.type === 'root'
            ? createEditableSourceProjection(
                transformedSource,
                parsedTransform,
                transform.comments ?? sourceComments,
              )
            : undefined;

        // Wiped lines = 1-indexed *source* lines the transform blanked
        // out in place. We can't trust positional alignment across the
        // two arrays whenever the transform inserts or deletes lines —
        // the shifted indices would make every unchanged line past the
        // insertion look like a wipe of whatever non-blank source line
        // happens to share its slot.
        //
        // The `@expanding*` markers tell us exactly which patched-side
        // lines are transformer-inserts. By stepping through source and
        // patched in lockstep and *skipping* the marked patched
        // positions, the remaining patched positions line up 1:1 with
        // the source. Any patched line at that aligned position which
        // is blank while the matching source line is non-blank is a
        // genuine wipe. Source lines past the end of the realigned
        // patched stream are treated as deletes (not wipes) — wipes
        // mean "blanked in place", which requires a partner slot in
        // the patched output.
        const collapsedPatchedLines = new Set<number>();
        for (const [startLine, endLine] of findExpandingRanges(transform.comments)) {
          for (let line = startLine; line <= endLine; line += 1) {
            collapsedPatchedLines.add(line);
          }
        }

        const wiped = new Set<number>();
        let sourceIdx = 0;
        for (let patchedIdx = 0; patchedIdx < patchedLines.length; patchedIdx += 1) {
          // Patched-side line numbers are 1-indexed.
          if (collapsedPatchedLines.has(patchedIdx + 1)) {
            continue;
          }
          if (sourceIdx >= originalLines.length) {
            break;
          }
          if (patchedLines[patchedIdx] === '' && originalLines[sourceIdx] !== '') {
            wiped.add(sourceIdx + 1);
          }
          sourceIdx += 1;
        }

        stripLineNumbersInPlace(parsedTransform);

        // Reconcile the transform tree's per-frame `data.fallback` against the
        // source tree so the delta carries a content-less delete only for the
        // frames this transform rewrote (and nothing for the rest). The
        // applier regenerates the deleted ones from their post-transform spans.
        reconcileFrameFallbacksForDiffInPlace(parsedTransform, parsedSource);

        // Collapse wiped-line runs in the transform tree into a single
        // `<span class="collapse" data-lines={count}>` placeholder per
        // run (with one empty `<span/>` child per collapsed line) before
        // diffing. The source tree is left intact (it's shared
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
            ...(sourceProjection && { sourceProjection }),
          },
        };
      }),
    );

    return Object.assign({}, ...transformed);
  } finally {
    renumberLinesInPlace(parsedSource);
  }
}
