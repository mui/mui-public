import { create, patch } from 'jsondiffpatch';
import type { Element, ElementContent, Nodes, Root } from 'hast';
import { type ParseSource, type Transforms } from '../../CodeHighlighter/types';

const differ = create({ omitRemovedValues: true, cloneDiffValues: true });

/**
 * Append the text content of `node` (and its descendants) onto `out`. Used
 * to rebuild a frame's `dataAsString` while we walk the frame's children
 * for collapsing — avoids a second pass over the same tree.
 */
function appendTextContent(node: ElementContent, out: { value: string }) {
  if (node.type === 'text') {
    out.value += node.value;
    return;
  }
  if (node.type === 'element') {
    for (let i = 0; i < node.children.length; i += 1) {
      appendTextContent(node.children[i], out);
    }
  }
}

/**
 * In a single walk over each frame's children:
 *
 *  1. Replace consecutive `.line` elements that the transform wiped to an
 *     empty string with one `<span data-collapsed-lines="N">` placeholder.
 *     Empty lines carry their `\n` inside the span (see addLineGutters), so
 *     dropping the element removes both the visible row and the newline
 *     from the text content. The renderer can animate
 *     `data-collapsed-lines` from N×lineHeight to 0 on the placeholder.
 *
 *  2. Strip `dataLn` from surviving `.line` elements. Concrete line numbers
 *     create huge diff noise whenever a transform inserts/removes lines,
 *     and the renderer reassigns sequential numbers post-patch.
 *
 *  3. Refresh `dataAsString` (plain-text fallback for lazy hydration) so it
 *     matches the now-collapsed text content.
 *
 * Lines that were already blank in the original source are preserved as
 * regular `.line` rows (only newly wiped content collapses).
 *
 * The walk is direct (no `unist-util-visit` recursion) because addLineGutters
 * always emits exactly `root → frame → line/text` — we never descend into a
 * line's syntax-highlighted children, which avoids walking the bulk of the
 * tree's nodes.
 */
function prepareTransformedTree(
  parsedTransform: Nodes,
  originalLines: string[],
  patched: string[],
) {
  const wiped = new Set<number>();
  const limit = Math.min(originalLines.length, patched.length);
  for (let i = 0; i < limit; i += 1) {
    if (patched[i] === '' && originalLines[i] !== '') {
      // dataLn is 1-indexed (see addLineGutters)
      wiped.add(i + 1);
    }
  }

  if (parsedTransform.type !== 'root') {
    return;
  }

  const frames = (parsedTransform as Root).children;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (frame.type !== 'element' || !frame.properties || frame.properties.className !== 'frame') {
      continue;
    }

    const previousAsString = frame.properties.dataAsString;
    const trackAsString = typeof previousAsString === 'string';
    const hadTrailingNewline = trackAsString && (previousAsString as string).endsWith('\n');
    const rebuilt = trackAsString ? { value: '' } : null;

    const children = frame.children;
    const next: ElementContent[] = [];
    let runCount = 0;
    let mutated = false;

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const isLine =
        child.type === 'element' &&
        child.tagName === 'span' &&
        child.properties != null &&
        child.properties.className === 'line';

      if (
        isLine &&
        wiped.size > 0 &&
        typeof (child as Element).properties!.dataLn === 'number' &&
        wiped.has((child as Element).properties!.dataLn as number)
      ) {
        runCount += 1;
        mutated = true;
        continue;
      }

      if (runCount > 0) {
        next.push({
          type: 'element',
          tagName: 'span',
          properties: { dataCollapsedLines: runCount },
          children: [],
        });
        if (rebuilt) {
          // collapsed placeholder contributes no text
        }
        runCount = 0;
      }

      if (isLine) {
        const properties = (child as Element).properties!;
        if (properties.dataLn !== undefined) {
          delete properties.dataLn;
          mutated = true;
        }
      }

      next.push(child);
      if (rebuilt) {
        appendTextContent(child, rebuilt);
      }
    }

    if (runCount > 0) {
      next.push({
        type: 'element',
        tagName: 'span',
        properties: { dataCollapsedLines: runCount },
        children: [],
      });
    }

    if (mutated) {
      frame.children = next;
      if (rebuilt) {
        if (hadTrailingNewline && !rebuilt.value.endsWith('\n')) {
          rebuilt.value += '\n';
        }
        frame.properties.dataAsString = rebuilt.value;
      }
    }
  }
}

/**
 * Strip `dataLn` from `.line` elements directly under each frame in `root`.
 * Walks `root.children → frame.children` only — never descends into a
 * line's highlighted spans (which are the bulk of the tree).
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
 * after the diff (it always came from `addLineGutters`, which numbers
 * lines 1..N in document order, so re-deriving is correct).
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

export async function diffHast(
  source: string,
  parsedSource: Nodes,
  filename: string,
  transforms: Transforms,
  parseSource: ParseSource,
): Promise<Record<string, any>> {
  const originalLines = source.split('\n');

  // Strip line numbers from `parsedSource` in place so the diff doesn't
  // encode the (always-sequential) numbering — we restore them in the
  // `finally` below. Avoiding a deep clone of `parsedSource` saves an
  // O(N) full-tree walk per `diffHast` call. Safe because:
  //  * The mutation is bounded by the synchronous strip + restore here.
  //  * `parsedSource` was produced by `addLineGutters`, which always
  //    assigns line numbers 1..N in document order, so re-deriving them
  //    after the diff yields the original values exactly.
  //  * No code mutates `parsedSource` between this strip and the restore
  //    (the parallel transforms only read it for the diff).
  stripLineNumbersInPlace(parsedSource);

  try {
    const transformed = await Promise.all(
      Object.entries(transforms).map(async ([key, transform]) => {
        const patched = patch(originalLines.slice(), transform.delta);
        if (!Array.isArray(patched)) {
          throw new Error(`Patch for ${key} did not return an array`);
        }

        const transformedSource = patched.join('\n');
        const parsedTransform = await parseSource(
          transformedSource,
          transform.fileName || filename,
        );

        // Single per-frame walk that collapses wiped runs, strips line
        // numbers from survivors, and refreshes `dataAsString`.
        prepareTransformedTree(parsedTransform, originalLines, patched);

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
