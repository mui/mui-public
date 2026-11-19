import type { Element, ElementContent, Root } from 'hast';
import type { Category } from './categories';
import type { Categorize } from './engine';
import type { Language } from './languages';

export interface Token {
  text: string;
  /** Space-separated classes, least specific first. */
  className?: string;
}

export function linesToHast(lines: Token[][]): Root {
  const children: ElementContent[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      children.push({ type: 'text', value: '\n' });
    }
    for (const token of line) {
      if (token.className) {
        children.push({
          type: 'element',
          tagName: 'span',
          properties: {
            className: token.className.includes(' ')
              ? [...new Set(token.className.split(' '))]
              : [token.className],
          },
          children: [{ type: 'text', value: token.text }],
        });
      } else {
        children.push({ type: 'text', value: token.text });
      }
    }
  });
  return { type: 'root', children };
}

/** The most specific class: engines that stack ancestor classes list the token's own class last. */
function tokenClass(element: Element): string | undefined {
  const className = element.properties?.className;
  const last = Array.isArray(className) ? className[className.length - 1] : undefined;
  return typeof last === 'string' ? last : undefined;
}

export function textOf(node: ElementContent | Root): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element' || node.type === 'root') {
    return node.children.map((child) => (child.type === 'doctype' ? '' : textOf(child))).join('');
  }
  return '';
}

/**
 * Returns the category of every UTF-16 code unit of the highlighted text. The
 * innermost classed span wins, matching how CSS colors nested tokens.
 */
export function categorizeChars(
  root: Root,
  categorize: Categorize,
  language: Language,
): Category[] {
  const result: Category[] = [];
  const visit = (node: ElementContent, inherited: Category) => {
    if (node.type === 'text') {
      for (let index = 0; index < node.value.length; index += 1) {
        result.push(inherited);
      }
      return;
    }
    if (node.type !== 'element') {
      return;
    }
    const className = tokenClass(node);
    const category = className ? categorize(className, textOf(node), language) : inherited;
    node.children.forEach((child) => visit(child, category));
  };
  root.children.forEach((child) => {
    if (child.type !== 'doctype') {
      visit(child, 'plain');
    }
  });
  return result;
}

/** Replaces each engine-specific class with a shared `c-{category}` class for side-by-side rendering. */
export function toCategoryHast(root: Root, categorize: Categorize, language: Language): Root {
  const visit = (node: ElementContent): ElementContent => {
    if (node.type !== 'element') {
      return node;
    }
    const className = tokenClass(node);
    const children = node.children.map(visit);
    if (!className) {
      return { ...node, children };
    }
    return {
      ...node,
      properties: {
        className: [`c-${categorize(className, textOf(node), language)}`],
        title: className,
      },
      children,
    };
  };
  return {
    type: 'root',
    children: root.children.map((child) => (child.type === 'doctype' ? child : visit(child))),
  };
}

export function countElements(node: ElementContent | Root): number {
  if (node.type !== 'element' && node.type !== 'root') {
    return 0;
  }
  return (
    (node.type === 'element' ? 1 : 0) +
    node.children.reduce(
      (sum, child) => sum + (child.type === 'doctype' ? 0 : countElements(child)),
      0,
    )
  );
}
