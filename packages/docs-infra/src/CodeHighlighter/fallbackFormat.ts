import type {
  Root as HastRoot,
  RootContent,
  Element as HastElement,
  ElementContent,
  Properties,
  Text as HastText,
} from 'hast';
import { COLLAPSED_VISIBLE_FRAME_TYPES } from '../pipeline/parseSource/frameVisibility';
import { isFrameSpan } from '../pipeline/parseSource/isFrameSpan';

/**
 * Compact serialization format for fallback HAST trees.
 *
 * A `FallbackNode` is either:
 * - a plain string (text node), or
 * - a variable-length tuple whose meaning is determined by length:
 *   - `[tagName, children]`                                – no class, no props
 *   - `[tagName, className, children]`                     – has class, no props
 *   - `[tagName, className, properties, children]`         – has class and props
 *   - `[tagName, className, properties, children, extra]`  – full
 *
 * Where:
 *   - `tagName`    – HTML element name (e.g. `'span'`, `'a'`)
 *   - `className`  – space-joined class string
 *   - `properties` – remaining HTML properties (without `className`)
 *   - `children`   – a single text string **or** an array of child `FallbackNode`s
 *   - `extra`      – optional bag for anything else (data attributes, etc.)
 *
 * This eliminates the repeated `type`, `tagName`, `properties`, `children`,
 * and `value` keys that make raw HAST costly in RSC payloads.
 */
export type FallbackNode = string | FallbackElement;

/**
 * A residual fallback that has been DEFLATE-compressed on its own. Mirrors the
 * `{ hastCompressed }` shape of `VariantSource`.
 *
 * Used for the parts of a variant's fallback that the `ContentLoading`
 * component never renders (extra files when the loading UI shows a single file,
 * extra variants when it shows a single variant). Those residual fallbacks
 * exist only as the DEFLATE dictionary for decompressing `hastCompressed`, so
 * shipping them as plain `FallbackNode[]` text would be dead weight in the
 * initial payload. They are compressed standalone — no preset text dictionary,
 * so the blob is self-contained — and decompressed back to `FallbackNode[]`
 * (via `decompressFallback`) only when the full content swaps in.
 */
export type CompressedFallback = { fallbackCompressed: string };

export type FallbackElement =
  | [tagName: string, children: string | FallbackNode[]]
  | [tagName: string, className: string, children: string | FallbackNode[]]
  | [
      tagName: string,
      className: string,
      properties: Record<string, unknown>,
      children: string | FallbackNode[],
    ]
  | [
      tagName: string,
      className: string,
      properties: Record<string, unknown>,
      children: string | FallbackNode[],
      extra: Record<string, unknown>,
    ];

/**
 * Convert a HAST root into the compact `FallbackNode[]` format.
 */
export function hastToFallback(root: HastRoot): FallbackNode[] {
  return convertChildren(root.children as RootContent[]);
}

function convertChildren(children: RootContent[]): FallbackNode[] {
  return children.map(convertNode);
}

function convertNode(node: RootContent): FallbackNode {
  if (node.type === 'text') {
    return (node as HastText).value;
  }

  if (node.type === 'element') {
    const el = node as HastElement;
    const { className, ...restProps } = el.properties || {};

    let classStr = '';
    if (className != null) {
      classStr = Array.isArray(className) ? (className as string[]).join(' ') : String(className);
    }

    const props = Object.keys(restProps).length > 0 ? restProps : null;
    const kids = (el.children ?? []) as RootContent[];

    // Optimize single-text-child to inline string
    let childValue: string | FallbackNode[];
    if (kids.length === 1 && kids[0].type === 'text') {
      childValue = (kids[0] as HastText).value;
    } else {
      childValue = convertChildren(kids);
    }

    // Variable-length tuple: omit trailing empty fields
    if (props !== null) {
      return [el.tagName, classStr, props, childValue];
    }
    if (classStr) {
      return [el.tagName, classStr, childValue];
    }
    return [el.tagName, childValue];
  }

  // For any other node types (comment, doctype, etc.), skip
  return '';
}

/**
 * Convert the compact `FallbackNode[]` format back into a HAST root.
 */
export function fallbackToHast(nodes: FallbackNode[]): HastRoot {
  // `ElementContent` (text/element) is a subset of `RootContent`, so the mapped
  // children satisfy `Root.children` directly.
  return {
    type: 'root',
    children: nodes.map(nodeToHast),
  };
}

function nodeToHast(node: FallbackNode): ElementContent {
  if (typeof node === 'string') {
    return { type: 'text', value: node };
  }

  let tagName: string;
  let classStr: string | undefined;
  let props: Record<string, unknown> | undefined;
  let children: string | FallbackNode[];
  let extra: Record<string, unknown> | undefined;

  if (node.length === 2) {
    [tagName, children] = node;
  } else if (node.length === 3) {
    [tagName, classStr, children] = node;
  } else if (node.length === 5) {
    [tagName, classStr, props, children, extra] = node;
  } else {
    [tagName, classStr, props, children] = node;
  }

  const properties: Record<string, unknown> = { ...props, ...extra };
  if (classStr) {
    properties.className = classStr.split(' ');
  }

  const childNodes: ElementContent[] =
    typeof children === 'string' ? [{ type: 'text', value: children }] : children.map(nodeToHast);

  return {
    type: 'element',
    tagName,
    // The fallback tuple stores element props as `unknown`; assert they are
    // valid HAST property values at this boundary (the one untyped seam).
    properties: properties as Properties,
    children: childNodes,
  };
}

/**
 * Extract the text content from compact `FallbackNode[]` without
 * converting back to HAST. Used to build DEFLATE dictionaries.
 */
export function fallbackToText(nodes: FallbackNode[]): string {
  return nodes.map(nodeText).join('');
}

function nodeText(node: FallbackNode): string {
  if (typeof node === 'string') {
    return node;
  }
  // children is always the last element (or second-to-last when extra is present)
  const children = node.length === 5 ? node[3] : node[node.length - 1];
  if (typeof children === 'string') {
    return children;
  }
  return (children as FallbackNode[]).map(nodeText).join('');
}

/**
 * Collects the plain text of a frame from its `.line` spans and the newline
 * text nodes between them. Used only as a fallback when a frame is missing a
 * precomputed `data.fallback` (which `addLineGutters` normally provides);
 * walks the frame's direct children once without recursing into highlighting
 * spans beyond their text.
 */
function collectFrameText(frame: HastElement): string {
  let out = '';
  const visit = (nodes: RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        out += (node as HastText).value;
      } else if (node.type === 'element') {
        visit((node as HastElement).children as RootContent[]);
      }
    }
  };
  visit(frame.children as RootContent[]);
  return out;
}

/**
 * Builds the variant-level root fallback from a final (post-enhancer) HAST
 * root. Each `span.frame` becomes a compact frame element whose single text
 * child is the frame's precomputed plain text (`frame.data.fallback`), so the
 * result is directly renderable as the pre-hydration code block **and** can be
 * redistributed back onto the decoded HAST's frames (see
 * `redistributeRootFallback`).
 *
 * The frame's `data-lined` attribute is dropped (line spans don't exist in the
 * fallback) while other frame attributes (e.g. `data-frame-type`) are kept so
 * the fallback's layout matches the highlighted render. Non-frame top-level
 * nodes (e.g. whitespace text between frames) are preserved in place.
 */
export function buildRootFallback(root: HastRoot): FallbackNode[] {
  const syntheticChildren: RootContent[] = [];
  for (const child of root.children) {
    if (child.type === 'element' && isFrameSpan(child as HastElement)) {
      const frame = child as HastElement;
      const { dataLined, ...properties } = frame.properties || {};
      const fallbackNodes = frame.data?.fallback;
      const text =
        fallbackNodes && fallbackNodes.length > 0
          ? fallbackNodes
              .map((node) => (node.type === 'text' ? (node as HastText).value : ''))
              .join('')
          : collectFrameText(frame);
      syntheticChildren.push({
        type: 'element',
        tagName: 'span',
        properties,
        children: [{ type: 'text', value: text } as HastText],
      } as HastElement);
    } else {
      syntheticChildren.push(child);
    }
  }
  return convertChildren(syntheticChildren);
}

/**
 * Redistributes a root fallback (built by `buildRootFallback`) back onto the
 * frames of a decoded HAST root, setting each frame's `data.fallback` to the
 * corresponding fallback frame's text nodes (as HAST, not the compact form).
 *
 * Frames align 1:1 by position because the root fallback and the decoded HAST
 * are both derived from the same final tree. Non-frame fallback entries (e.g.
 * inter-frame whitespace) advance the cursor without being assigned. Mutates
 * `root` in place and returns it.
 */
export function redistributeRootFallback(root: HastRoot, fallback: FallbackNode[]): HastRoot {
  let fallbackIndex = 0;
  for (const child of root.children) {
    // Advance past any non-frame fallback entries so frames stay aligned.
    while (fallbackIndex < fallback.length && !isFallbackFrame(fallback[fallbackIndex])) {
      fallbackIndex += 1;
    }
    if (child.type !== 'element' || !isFrameSpan(child as HastElement)) {
      continue;
    }
    if (fallbackIndex >= fallback.length) {
      break;
    }
    const frameFallback = fallback[fallbackIndex] as FallbackElement;
    fallbackIndex += 1;
    const frame = child as HastElement;
    // The fallback frame's children are the frame's plain text.
    const childValue =
      frameFallback.length === 5 ? frameFallback[3] : frameFallback[frameFallback.length - 1];
    const nodes: HastText[] =
      typeof childValue === 'string'
        ? [{ type: 'text', value: childValue }]
        : (childValue as FallbackNode[]).map((node) => ({
            type: 'text',
            value: nodeText(node),
          }));
    if (!frame.data) {
      frame.data = {} as HastElement['data'] & {};
    }
    frame.data.fallback = nodes;
  }
  return root;
}

function isFallbackFrame(node: FallbackNode): node is FallbackElement {
  if (!Array.isArray(node) || node[0] !== 'span' || node.length < 3) {
    return false;
  }
  const classStr = node[1];
  return (
    typeof classStr === 'string' && (classStr === 'frame' || classStr.split(' ').includes('frame'))
  );
}

function fallbackFrameType(frame: FallbackElement): string | undefined {
  // Properties (carrying `dataFrameType`) live at index 2 of the 4- and
  // 5-element tuple forms; the shorter forms have no properties.
  if (frame.length >= 4) {
    const frameType = (frame[2] as Record<string, unknown>)?.dataFrameType;
    return typeof frameType === 'string' ? frameType : undefined;
  }
  return undefined;
}

/**
 * Reduce a root fallback to the frames visible while the code block is
 * collapsed — the contiguous focused window (`padding-top`, `highlighted` /
 * `focus`, `padding-bottom`). Inter-frame nodes inside that window are kept so
 * the slice renders with the same spacing as the full fallback.
 *
 * Matches the runtime rule in `Pre.tsx`: when a block has no emphasis frames
 * (the whole source is the focused window) the first frame stands in. Returns
 * the input unchanged when it has no frames at all.
 *
 * When `collapsesToEmpty` is `true` the source records `focusedLines === 0`
 * (the `oversizedFocus: 'hide'` collapse-to-nothing case): the collapsed window
 * is intentionally empty, so the first-frame fallback is skipped and an empty
 * array is returned. Mirrors the runtime rule in `Pre.tsx` /
 * `getInitialVisibleSourceLines`.
 *
 * Used by `fallbackCollapsed` to paint only the on-screen lines while the
 * file's full fallback rides along compressed (see the prop-compression
 * pattern's "Splitting the Fallback by Visibility").
 */
export function collapsedVisibleFallback(
  fallback: FallbackNode[],
  collapsesToEmpty = false,
): FallbackNode[] {
  if (collapsesToEmpty) {
    return [];
  }

  let firstFrame = -1;
  let firstVisible = -1;
  let lastVisible = -1;

  for (let index = 0; index < fallback.length; index += 1) {
    const node = fallback[index];
    if (!isFallbackFrame(node)) {
      continue;
    }
    if (firstFrame === -1) {
      firstFrame = index;
    }
    const frameType = fallbackFrameType(node);
    if (frameType && COLLAPSED_VISIBLE_FRAME_TYPES.has(frameType)) {
      if (firstVisible === -1) {
        firstVisible = index;
      }
      lastVisible = index;
    }
  }

  if (firstVisible === -1) {
    // No emphasis frames: the first frame is the collapsed window.
    return firstFrame === -1 ? fallback : [fallback[firstFrame]];
  }
  return fallback.slice(firstVisible, lastVisible + 1);
}
