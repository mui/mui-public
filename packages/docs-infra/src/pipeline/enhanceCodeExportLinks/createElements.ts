import type { Element, ElementContent } from 'hast';

/**
 * Creates a link element wrapping the given children.
 * When `tagName` is provided, emits a custom component element with `name` property.
 * Otherwise, emits a standard `<a>` element.
 */
export function createLinkElement(
  href: string,
  children: ElementContent[],
  identifier: string,
  className?: string[],
  tagName?: string,
): Element {
  if (tagName) {
    return {
      type: 'element',
      tagName,
      properties:
        className && className.length > 0
          ? { href, name: identifier, className }
          : { href, name: identifier },
      children,
    };
  }
  return {
    type: 'element',
    tagName: 'a',
    properties: className && className.length > 0 ? { href, className } : { href },
    children,
  };
}

/**
 * Creates a prop ref element wrapping the given children.
 *
 * When `isDefinition` is true, the property is the canonical definition site:
 * emits a `<span id="...">` (or custom component with `id` instead of `href`).
 * Otherwise, it's a reference: emits an `<a href="...">` (or custom component with `href`).
 */
export function createPropRefElement(
  anchor: string,
  children: ElementContent[],
  ownerName: string,
  propPath: string,
  isDefinition: boolean,
  className?: string[],
  tagName?: string,
): Element {
  // Strip leading "#" for id attributes — href="#foo" targets id="foo"
  const idValue = anchor.startsWith('#') ? anchor.slice(1) : anchor;
  if (tagName) {
    const properties: Record<string, string | string[]> = isDefinition
      ? { id: idValue, name: ownerName, prop: propPath }
      : { href: anchor, name: ownerName, prop: propPath };
    if (className && className.length > 0) {
      properties.className = className;
    }
    return { type: 'element', tagName, properties, children };
  }
  if (isDefinition) {
    const properties: Record<string, string | string[]> = {
      id: idValue,
      'data-name': ownerName,
      'data-prop': propPath,
    };
    if (className && className.length > 0) {
      properties.className = className;
    }
    return { type: 'element', tagName: 'span', properties, children };
  }
  const properties: Record<string, string | string[]> = {
    href: anchor,
    'data-name': ownerName,
    'data-prop': propPath,
  };
  if (className && className.length > 0) {
    properties.className = className;
  }
  return { type: 'element', tagName: 'a', properties, children };
}

/**
 * Creates a HAST element for a function parameter reference.
 *
 * When a custom tag is provided (`typeParamRefComponent`), emits that element with
 * `name` (owner) and `param` (parameter name) attributes.
 * Otherwise falls back to `<span id>` (definition) or `<a href>` (reference).
 */
export function createParamRefElement(
  anchor: string,
  children: ElementContent[],
  ownerName: string,
  paramName: string,
  isDefinition: boolean,
  className?: string[],
  tagName?: string,
): Element {
  const idValue = anchor.startsWith('#') ? anchor.slice(1) : anchor;
  if (tagName) {
    const properties: Record<string, string | string[]> = isDefinition
      ? { id: idValue, name: ownerName, param: paramName }
      : { href: anchor, name: ownerName, param: paramName };
    if (className && className.length > 0) {
      properties.className = className;
    }
    return { type: 'element', tagName, properties, children };
  }
  if (isDefinition) {
    const properties: Record<string, string | string[]> = {
      id: idValue,
      'data-name': ownerName,
      'data-param': paramName,
    };
    if (className && className.length > 0) {
      properties.className = className;
    }
    return { type: 'element', tagName: 'span', properties, children };
  }
  const properties: Record<string, string | string[]> = {
    href: anchor,
    'data-name': ownerName,
    'data-param': paramName,
  };
  if (className && className.length > 0) {
    properties.className = className;
  }
  return { type: 'element', tagName: 'a', properties, children };
}
