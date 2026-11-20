import type { ElementContent, Root } from 'hast';
import { starryNightGutter } from '../pipeline/parseSource/addLineGutters';
import { hasClassName, isFrameSpan } from '../pipeline/parseSource/isFrameSpan';

/** Keep line boxes so a multiline fallback is not aggregated into one LCP candidate. */
export function renderFallbackLines(children: ElementContent[]): ElementContent[] {
  if (children.some((child) => child.type === 'element' && hasClassName(child, 'line'))) {
    return children;
  }

  const root: Root = { type: 'root', children };
  starryNightGutter(root);

  const frame = root.children[0];

  if (frame?.type !== 'element' || !isFrameSpan(frame)) {
    return children;
  }

  for (const child of frame.children) {
    if (child.type === 'element' && hasClassName(child, 'line')) {
      delete child.properties.dataLn;
    }
  }

  return frame.children;
}

/** Restore render-only line structure without changing serialized fallback dictionaries. */
export function restoreFallbackLines(root: Root): Root {
  return {
    ...root,
    children: root.children.map((child) => {
      if (child.type !== 'element' || !isFrameSpan(child)) {
        return child;
      }

      return {
        ...child,
        properties: { ...child.properties, dataLined: '' },
        children: renderFallbackLines(child.children),
      };
    }),
  };
}
