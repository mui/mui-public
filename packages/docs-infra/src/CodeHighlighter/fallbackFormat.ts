import type { Root as HastRoot, RootContent, Element as HastElement, Text as HastText } from 'hast';

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
    const kids = el.children as RootContent[];

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
  return {
    type: 'root',
    children: nodes.map(nodeToHast) as RootContent[],
  };
}

function nodeToHast(node: FallbackNode): RootContent {
  if (typeof node === 'string') {
    return { type: 'text', value: node } as HastText;
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

  const childNodes: RootContent[] =
    typeof children === 'string'
      ? [{ type: 'text', value: children } as HastText]
      : children.map(nodeToHast);

  return {
    type: 'element',
    tagName,
    properties,
    children: childNodes,
  } as unknown as RootContent;
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
