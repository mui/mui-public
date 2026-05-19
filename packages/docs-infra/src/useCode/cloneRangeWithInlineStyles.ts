/**
 * Clone a `Range` into a self-contained wrapper element with computed
 * styles inlined onto every cloned descendant, so that pasting into
 * rich-text targets (email, Word, Notion, etc.) preserves the source's
 * visual styling without depending on the source page's stylesheet.
 *
 * The wrapper defaults to `<pre>` so monospace + whitespace context
 * survives a copy/paste round-trip. The original ancestor chain
 * between `range.commonAncestorContainer` and `root` is reconstructed
 * inside the wrapper so a selection living entirely inside a styled
 * descendant (e.g. one token of a syntax-highlighted line) keeps that
 * wrapper in the clipboard payload.
 */

interface InlineStyleOptions {
  /**
   * Tag name for the wrapper element. Defaults to `'pre'` so monospace
   * + whitespace context survives a copy/paste round-trip.
   */
  wrapperTag?: string;
  /**
   * Class name applied to the wrapper. Defaults to `root.className` so
   * consumers that scope styles by class keep matching when the snippet
   * is pasted into a richer environment that loads the same stylesheet.
   */
  className?: string;
  /**
   * Computed-style properties inlined onto every cloned descendant.
   * Keep this list short — each property is read via
   * `getComputedStyle` per node.
   */
  elementStyleProps?: readonly string[];
  /**
   * Computed-style properties read from `root` and inlined onto the
   * wrapper. Use to carry typography (font-family, font-size,
   * line-height, …) onto the wrapper so the pasted block matches the
   * source even when only a descendant was selected.
   */
  rootStyleProps?: readonly string[];
  /**
   * Static CSS prepended to the wrapper's `style` attribute, before any
   * computed properties. Useful for visual chrome (padding, rounded
   * corners) that does not depend on the source.
   */
  rootStaticStyles?: string;
}

const asElement = (node: Node | null | undefined): Element | null =>
  node instanceof Element ? node : null;

const nextElement = (walker: TreeWalker): Element | null => asElement(walker.nextNode());

const inlineComputedStyles = (
  target: Element,
  computed: CSSStyleDeclaration,
  props: readonly string[],
): void => {
  let inline = target.getAttribute('style') ?? '';
  for (const prop of props) {
    const value = computed.getPropertyValue(prop);
    if (value && value !== 'normal' && value !== 'none' && value !== 'auto') {
      inline += `${prop}:${value};`;
    }
  }
  if (inline) {
    target.setAttribute('style', inline);
  }
};

export const cloneRangeWithInlineStyles = (
  root: HTMLElement,
  range: Range,
  options: InlineStyleOptions = {},
): HTMLElement => {
  const {
    wrapperTag = 'pre',
    className = root.className,
    elementStyleProps = [],
    rootStyleProps = [],
    rootStaticStyles = '',
  } = options;

  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const fragment = range.cloneContents();
  const container = doc.createElement(wrapperTag);
  if (className) {
    container.className = className;
  }

  // `Range.cloneContents` returns the descendants of the
  // `commonAncestorContainer` but never the ancestor itself, so any
  // selection that lives entirely inside a styled wrapper (a single
  // text node inside a token, or multiple children of the same token)
  // loses that wrapper in the clipboard payload. The computed-style
  // inlining pass below has nothing to inline onto in that case.
  // Reconstruct the ancestor chain up to (but not including) `root`
  // and inline styles onto each rebuilt wrapper so rich-text paste
  // targets keep the original highlighting.
  const cac = range.commonAncestorContainer;
  const anchor: Element | null = asElement(cac) ?? cac.parentElement;
  let rootContent: Node = fragment;
  // The innermost reconstructed wrapper, if any. The style-inlining
  // pass below walks from here so the clone walker stays aligned with
  // the source walker (which starts from the CAC's descendants).
  let cloneStylingRoot: Node = container;
  if (anchor && anchor !== root && root.contains(anchor)) {
    let current: Element | null = anchor;
    let innermost: Element | null = null;
    while (current && current !== root) {
      const cloned = current.cloneNode(false);
      // `Element.cloneNode` returns an Element; the runtime check
      // exists purely to satisfy the DOM lib's `Node` return type.
      if (!(cloned instanceof Element)) {
        current = current.parentElement;
        continue;
      }
      if (view && elementStyleProps.length > 0) {
        inlineComputedStyles(cloned, view.getComputedStyle(current), elementStyleProps);
      }
      cloned.appendChild(rootContent);
      rootContent = cloned;
      if (innermost === null) {
        innermost = cloned;
      }
      current = current.parentElement;
    }
    if (innermost) {
      cloneStylingRoot = innermost;
    }
  }
  container.appendChild(rootContent);

  if (view && elementStyleProps.length > 0) {
    // Walk the CAC's descendants and mirror them onto the cloned
    // descendants of the innermost reconstructed wrapper. Both
    // walkers exclude their root, so as long as the roots correspond
    // (CAC ↔ innermost reconstructed wrapper, or CAC ↔ wrapper when
    // there is no reconstruction) the per-step pairing is correct.
    const sourceWalker = doc.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) =>
          range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      },
    );
    const cloneWalker = doc.createTreeWalker(cloneStylingRoot, NodeFilter.SHOW_ELEMENT);
    let source = nextElement(sourceWalker);
    let clone = nextElement(cloneWalker);
    while (source && clone) {
      if (source.tagName === clone.tagName) {
        inlineComputedStyles(clone, view.getComputedStyle(source), elementStyleProps);
      }
      source = nextElement(sourceWalker);
      clone = nextElement(cloneWalker);
    }
  }

  if (view && (rootStyleProps.length > 0 || rootStaticStyles)) {
    let rootInline = rootStaticStyles;
    if (rootStyleProps.length > 0) {
      const rootComputed = view.getComputedStyle(root);
      for (const prop of rootStyleProps) {
        const value = rootComputed.getPropertyValue(prop);
        if (value) {
          rootInline += `${prop}:${value};`;
        }
      }
    }
    if (rootInline) {
      container.setAttribute('style', rootInline);
    }
  }

  return container;
};
