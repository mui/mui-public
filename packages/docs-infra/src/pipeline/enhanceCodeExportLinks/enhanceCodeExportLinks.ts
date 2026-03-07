import type { Root as HastRoot, Element, Text, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';
import { toKebabCase } from '../loaderUtils/toKebabCase';
import {
  getShallowTextContent,
  hasClass,
  isConstantSpan,
  isEntityNameSpan,
  isKeywordSpan as isKeywordSpanShared,
  isPropertyNameSpan,
} from '../loadServerTypes/hastTypeUtils';

/**
 * Options for the enhanceCodeExportLinks plugin.
 */
export interface EnhanceCodeExportLinksOptions {
  /**
   * Map from export names (both flat and dotted) to their anchor hrefs.
   * Examples:
   * - "AccordionTrigger" → "#trigger"
   * - "Accordion.Trigger" → "#trigger"
   * - "AccordionTriggerState" → "#trigger.state"
   * - "Accordion.Trigger.State" → "#trigger.state"
   *
   * Function calls and JSX components are looked up by their plain name.
   * For prop linking, the parameter index is encoded in the href:
   * - param 0: `#anchor::prop` (zero omitted)
   * - param N: `#anchor:N:prop`
   *
   * If a named parameter anchor is provided (e.g., `"makeItem[0]": "#make-item:props"`),
   * the prop href uses the named anchor as a base: `#make-item:props:label`.
   */
  anchorMap: Record<string, string>;
  /**
   * When set, the plugin emits a custom component element instead of an `<a>` tag
   * for type/export name references.
   * The custom element receives `href` and `name` (the matched identifier) as properties.
   * This is used to render interactive type popovers via a `TypeRef` component.
   */
  typeRefComponent?: string;
  /**
   * When set, the plugin emits a custom component element instead of a plain HTML element
   * for property references within type definitions, object literals, function calls, and JSX.
   *
   * For definition sites (type definitions), the element receives `id` (anchor target).
   * For reference sites (annotations, function calls, JSX), the element receives `href` (link).
   * Both also receive `name` (the owner identifier) and `prop` (kebab-case property path).
   */
  typePropRefComponent?: string;
  /**
   * Opt-in property linking mode.
   * - `'shallow'`: Link only top-level properties of known owners.
   * - `'deep'`: Link nested properties with dotted paths (e.g., `address.street-name`).
   * - `undefined` (default): No property linking (backward compatible).
   */
  linkProps?: 'shallow' | 'deep';
}

/**
 * Converts a prop path (array of property names) to a kebab-case dotted string.
 * Each segment is independently converted.
 * Example: ["homeAddress", "streetName"] → "home-address.street-name"
 */
function propPathToString(propPath: string[], propName: string): string {
  const allParts = [...propPath, propName];
  return allParts.map(toKebabCase).join('.');
}

/**
 * Checks if an element is a linkable span (pl-c1 or pl-en).
 * Only spans are considered linkable - not anchors we've already created.
 */
function isLinkableSpan(element: Element): boolean {
  return isConstantSpan(element) || isEntityNameSpan(element);
}

/**
 * Checks if an element is a property span (pl-v or pl-e).
 */
function isPropertySpan(element: Element): boolean {
  return isPropertyNameSpan(element) || (element.tagName === 'span' && hasClass(element, 'pl-e'));
}

/**
 * Checks if an element is a keyword span (pl-k).
 */
function isKeywordSpan(element: Element): boolean {
  return isKeywordSpanShared(element);
}

/**
 * Gets the text content of an element (concatenates all text children).
 */
function getTextContent(element: Element): string {
  return getShallowTextContent(element);
}

/**
 * Gets the class names from an element's properties.
 */
function getClassName(element: Element): string[] | undefined {
  const className = element.properties?.className;
  return Array.isArray(className) ? (className as string[]) : undefined;
}

/**
 * Represents a chain of linkable spans that may form a dotted identifier.
 */
interface LinkableChain {
  spans: Element[];
  dotTexts: Text[];
  startIndex: number;
  endIndex: number;
}

/**
 * Builds the full identifier string from a chain.
 */
function chainToIdentifier(chain: LinkableChain): string {
  return chain.spans.map(getTextContent).join('.');
}

/**
 * Creates a link element wrapping the given children.
 * When `tagName` is provided, emits a custom component element with `name` property.
 * Otherwise, emits a standard `<a>` element.
 */
function createLinkElement(
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
function createPropRefElement(
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
 * Owner context for property linking.
 * Tracks which type/function/component owns the current block of properties.
 */
interface OwnerContext {
  /** The owner identifier, e.g., "User", "createUser[0]", "Card[0]" */
  name: string;
  /** The anchor href from the anchorMap for this owner */
  anchorHref: string;
  /** The kind of owner, affecting how the context ends */
  kind: 'type-def' | 'type-annotation' | 'func-call' | 'jsx';
  /** Current brace depth within this owner (1 = top-level properties) */
  braceDepth: number;
  /** Stack of property names for deep nesting */
  propPath: string[];
  /** Brace depths at which each propPath entry was pushed */
  propPathDepths: number[];
  /** Parameter index for function calls (0-indexed). Only used for func-call and jsx kinds. */
  paramIndex: number;
  /**
   * Optional param-specific anchor href from the anchorMap (e.g., anchorMap["makeItem[0]"]).
   * When set, prop hrefs use this as the base instead of index-based formatting.
   */
  paramAnchorHref: string | null;
}

/**
 * Mutable state threaded through the single-pass traversal.
 */
interface ScanState {
  /** Stack of active owner contexts (for nested types) */
  ownerStack: OwnerContext[];
  /** Set after seeing pl-k("type") keyword */
  sawTypeKeyword: boolean;
  /** The entity name seen after "type" keyword (potential type definition owner) */
  pendingTypeDefName: string | null;
  /** Whether we're expecting a brace to start a type def body */
  expectingTypeDefBrace: boolean;
  /** Type annotation name (from pl-en after pl-k(":") in const declarations) */
  pendingAnnotationType: string | null;
  /** Whether we saw pl-k("=") after a type annotation, expecting a brace */
  expectingAnnotationBrace: boolean;
  /** Last seen entity name from pl-en (for function call detection) */
  lastEntityName: string | null;
  /** Whether we just saw "<" text (for JSX detection) */
  sawJsxOpen: boolean;
  /** JSX component name (from pl-c1 after "<") */
  jsxComponentName: string | null;
  /** Last property name that was linked (for deep nesting: detect { after prop) */
  lastLinkedProp: string | null;
  /** Pending function call context for tracking parentheses and parameter indices */
  pendingFuncCall: {
    name: string;
    anchorHref: string;
    parenDepth: number;
    paramIndex: number;
  } | null;
  /** Persisted type def info for multi-brace type definitions (unions, intersections) */
  typeDefPersist: { name: string; anchorHref: string } | null;
  /** Paren depth tracking for type def expressions (e.g., `type X = ( | {...} | {...} ) & {...}`) */
  typeDefParenDepth: number;
}

/**
 * Creates a fresh ScanState.
 */
function createScanState(): ScanState {
  return {
    ownerStack: [],
    sawTypeKeyword: false,
    pendingTypeDefName: null,
    expectingTypeDefBrace: false,
    pendingAnnotationType: null,
    expectingAnnotationBrace: false,
    lastEntityName: null,
    sawJsxOpen: false,
    jsxComponentName: null,
    lastLinkedProp: null,
    pendingFuncCall: null,
    typeDefPersist: null,
    typeDefParenDepth: 0,
  };
}

/**
 * Looks up an owner name in the anchorMap.
 */
function lookupOwner(
  name: string,
  anchorMap: Record<string, string>,
): { ownerName: string; anchorHref: string } | null {
  if (name in anchorMap) {
    return { ownerName: name, anchorHref: anchorMap[name] };
  }
  return null;
}

/**
 * Returns the current active owner context, or null if none.
 */
function currentOwner(state: ScanState): OwnerContext | null {
  return state.ownerStack.length > 0 ? state.ownerStack[state.ownerStack.length - 1] : null;
}

/**
 * Builds the property href for the given owner and property path.
 * - If a named param anchor exists (e.g., `makeItem[0]` → `#make-item:props`):
 *   uses `paramAnchorHref:propPath` (e.g., `#make-item:props:label`)
 * - For type-def/type-annotation: `#anchor:prop-path`
 * - For func-call/jsx param 0: `#anchor::prop-path` (zero omitted)
 * - For func-call param N: `#anchor:N:prop-path`
 */
function buildPropHref(owner: OwnerContext, propPathStr: string): string {
  if (owner.paramAnchorHref) {
    return `${owner.paramAnchorHref}:${propPathStr}`;
  }
  if (owner.kind === 'func-call' || owner.kind === 'jsx') {
    if (owner.paramIndex === 0) {
      return `${owner.anchorHref}::${propPathStr}`;
    }
    return `${owner.anchorHref}:${owner.paramIndex}:${propPathStr}`;
  }
  return `${owner.anchorHref}:${propPathStr}`;
}

/**
 * Process a text node for brace/JSX tracking and plain text property extraction.
 * Returns an array of ElementContent nodes (possibly splitting the text node).
 */
function processTextNode(
  text: string,
  state: ScanState,
  anchorMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
  typePropRefComponent: string | undefined,
): ElementContent[] {
  const output: ElementContent[] = [];
  let textStart = 0;

  /** Flush accumulated text from textStart to `end` as a text node. */
  function flush(end: number): void {
    if (end > textStart) {
      output.push({ type: 'text', value: text.substring(textStart, end) });
    }
    textStart = end;
  }

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // JSX opening "<"
    if (ch === '<') {
      state.sawJsxOpen = true;
      i += 1;
      continue;
    }

    // JSX self-closing "/>"
    if (ch === '/' && text[i + 1] === '>' && currentOwner(state)?.kind === 'jsx') {
      flush(i);
      state.ownerStack.pop();
      i += 2;
      textStart = i;
      continue;
    }

    // JSX closing ">" (only in JSX context; avoid matching ">" in "=>")
    if (ch === '>' && currentOwner(state)?.kind === 'jsx') {
      flush(i);
      state.ownerStack.pop();
      i += 1;
      textStart = i;
      continue;
    }

    // Open parenthesis "(" — start function call tracking or type def paren tracking
    if (ch === '(') {
      if (state.typeDefParenDepth > 0) {
        state.typeDefParenDepth += 1;
      } else if (state.expectingTypeDefBrace && state.pendingTypeDefName && linkProps) {
        const lookup = lookupOwner(state.pendingTypeDefName, anchorMap);
        if (lookup) {
          state.typeDefPersist = {
            name: lookup.ownerName,
            anchorHref: lookup.anchorHref,
          };
          state.typeDefParenDepth = 1;
        }
        state.pendingTypeDefName = null;
        state.expectingTypeDefBrace = false;
      } else if (state.pendingFuncCall) {
        state.pendingFuncCall.parenDepth += 1;
      } else if (state.lastEntityName && state.lastEntityName in anchorMap && linkProps) {
        state.pendingFuncCall = {
          name: state.lastEntityName,
          anchorHref: anchorMap[state.lastEntityName],
          parenDepth: 1,
          paramIndex: 0,
        };
        state.lastEntityName = null;
      }
      i += 1;
      continue;
    }

    // Close parenthesis ")" — end function call or type def paren tracking
    if (ch === ')') {
      if (state.typeDefParenDepth > 0) {
        state.typeDefParenDepth -= 1;
        // Keep typeDefPersist for potential & { continuation after )
      } else if (state.pendingFuncCall) {
        state.pendingFuncCall.parenDepth -= 1;
        if (state.pendingFuncCall.parenDepth === 0) {
          state.pendingFuncCall = null;
        }
      }
      i += 1;
      continue;
    }

    // Comma "," — increment parameter index in function calls
    if (
      ch === ',' &&
      state.pendingFuncCall &&
      state.pendingFuncCall.parenDepth === 1 &&
      !currentOwner(state)
    ) {
      state.pendingFuncCall.paramIndex += 1;
    }

    // Semicolon ";" — clear typeDefPersist at top level (end of type declaration)
    if (
      ch === ';' &&
      state.typeDefPersist &&
      !currentOwner(state) &&
      state.typeDefParenDepth === 0
    ) {
      state.typeDefPersist = null;
    }

    // Open brace "{"
    if (ch === '{') {
      handleOpenBrace(state, anchorMap, linkProps);
      i += 1;
      continue;
    }

    // Close brace "}"
    if (ch === '}') {
      handleCloseBrace(state);
      i += 1;
      continue;
    }

    // Try to match a property name (identifier followed by ":")
    const owner = currentOwner(state);
    if (owner && linkProps && owner.braceDepth >= 1) {
      // In shallow mode, skip nested properties
      if (linkProps === 'shallow' && owner.braceDepth > 1) {
        i += 1;
        continue;
      }

      if (/[a-zA-Z_$]/.test(ch)) {
        const rest = text.substring(i);
        const identMatch = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/);
        if (identMatch) {
          const propName = identMatch[1];
          flush(i);

          const propPathStr = propPathToString(owner.propPath, propName);
          const anchor = buildPropHref(owner, propPathStr);
          const isDefinition = owner.kind === 'type-def';
          output.push(
            createPropRefElement(
              anchor,
              [{ type: 'text', value: propName }],
              owner.name,
              propPathStr,
              isDefinition,
              undefined,
              typePropRefComponent,
            ),
          );
          state.lastLinkedProp = propName;

          i += propName.length;
          textStart = i;
          continue;
        }
      }
    }

    i += 1;
  }

  // Flush remaining text
  flush(text.length);

  return output.length > 0 ? output : [{ type: 'text', value: text }];
}

/**
 * Handles an open brace "{" in text, updating the scan state.
 */
function handleOpenBrace(
  state: ScanState,
  anchorMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
): void {
  const owner = currentOwner(state);

  // Function call: pending function call with object argument
  if (!owner && state.pendingFuncCall) {
    const paramKey = `${state.pendingFuncCall.name}[${state.pendingFuncCall.paramIndex}]`;
    const paramAnchorHref = anchorMap[paramKey] ?? null;
    state.ownerStack.push({
      name: state.pendingFuncCall.name,
      anchorHref: state.pendingFuncCall.anchorHref,
      kind: 'func-call',
      braceDepth: 1,
      propPath: [],
      propPathDepths: [],
      paramIndex: state.pendingFuncCall.paramIndex,
      paramAnchorHref,
    });
    return;
  }

  // Start of type definition body
  if (!owner && state.expectingTypeDefBrace && state.pendingTypeDefName && linkProps) {
    const lookup = lookupOwner(state.pendingTypeDefName, anchorMap);
    if (lookup) {
      state.ownerStack.push({
        name: lookup.ownerName,
        anchorHref: lookup.anchorHref,
        kind: 'type-def',
        braceDepth: 1,
        propPath: [],
        propPathDepths: [],
        paramIndex: 0,
        paramAnchorHref: null,
      });
      // Persist type def info for subsequent union/intersection braces
      state.typeDefPersist = { name: lookup.ownerName, anchorHref: lookup.anchorHref };
    }
    state.pendingTypeDefName = null;
    state.expectingTypeDefBrace = false;
    return;
  }

  // Reuse persisted type def context for union/intersection branches
  if (!owner && state.typeDefPersist && linkProps) {
    state.ownerStack.push({
      name: state.typeDefPersist.name,
      anchorHref: state.typeDefPersist.anchorHref,
      kind: 'type-def',
      braceDepth: 1,
      propPath: [],
      propPathDepths: [],
      paramIndex: 0,
      paramAnchorHref: null,
    });
    return;
  }

  // Start of type-annotated object literal body
  if (!owner && state.expectingAnnotationBrace && state.pendingAnnotationType && linkProps) {
    const lookup = lookupOwner(state.pendingAnnotationType, anchorMap);
    if (lookup) {
      state.ownerStack.push({
        name: lookup.ownerName,
        anchorHref: lookup.anchorHref,
        kind: 'type-annotation',
        braceDepth: 1,
        propPath: [],
        propPathDepths: [],
        paramIndex: 0,
        paramAnchorHref: null,
      });
    }
    state.pendingAnnotationType = null;
    state.expectingAnnotationBrace = false;
    return;
  }

  // Nested brace inside an owner
  if (owner) {
    owner.braceDepth += 1;
    if (linkProps === 'deep' && state.lastLinkedProp) {
      owner.propPath.push(state.lastLinkedProp);
      owner.propPathDepths.push(owner.braceDepth);
      state.lastLinkedProp = null;
    }
  }
}

/**
 * Handles a close brace "}" in text, updating the scan state.
 */
function handleCloseBrace(state: ScanState): void {
  const owner = currentOwner(state);
  if (!owner) {
    return;
  }

  // Pop propPath entries at this brace depth
  while (
    owner.propPathDepths.length > 0 &&
    owner.propPathDepths[owner.propPathDepths.length - 1] === owner.braceDepth
  ) {
    owner.propPath.pop();
    owner.propPathDepths.pop();
  }

  owner.braceDepth -= 1;

  if (owner.braceDepth === 0) {
    state.ownerStack.pop();
  }
}

/**
 * Options passed to enhanceChildren for cleaner signatures.
 */
interface EnhanceOptions {
  anchorMap: Record<string, string>;
  typeRefComponent?: string;
  typePropRefComponent?: string;
  linkProps?: 'shallow' | 'deep';
}

/**
 * Single-pass function that enhances children by:
 * 1. Linking type/export name spans (chains) to their anchors
 * 2. Tracking owner context for property linking
 * 3. Wrapping property names (spans or plain text) with prop ref elements
 *
 * State is threaded through recursive calls so context flows across
 * nested frame/line elements.
 */
function enhanceChildren(
  children: ElementContent[],
  options: EnhanceOptions,
  state: ScanState,
): ElementContent[] {
  const { anchorMap, typePropRefComponent, linkProps } = options;
  const newChildren: ElementContent[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    // --- Text node: process for brace tracking and plain text properties ---
    if (node.type === 'text') {
      const processed = processTextNode(
        node.value,
        state,
        anchorMap,
        linkProps,
        typePropRefComponent,
      );
      newChildren.push(...processed);
      i += 1;
      continue;
    }

    // --- Element node ---
    if (node.type === 'element') {
      // Linkable span (pl-c1, pl-en): handle chains + state updates
      if (isLinkableSpan(node)) {
        const result = handleLinkableSpan(children, i, options, state);
        newChildren.push(...result.nodes);
        i = result.nextIndex;
        continue;
      }

      // Property span (pl-v, pl-e): wrap as prop ref if in owner context
      if (isPropertySpan(node)) {
        const result = handlePropertySpan(node, state, options);
        newChildren.push(result);
        i += 1;
        continue;
      }

      // Keyword span (pl-k): update state
      if (isKeywordSpan(node)) {
        handleKeywordSpan(node, state);
        newChildren.push(node);
        i += 1;
        continue;
      }

      // Other element (frame, line, etc.): recursively process children
      if (node.children) {
        const processedChildren = enhanceChildren(node.children, options, state);
        newChildren.push({ ...node, children: processedChildren } as Element);
      } else {
        newChildren.push(node);
      }
      i += 1;
      continue;
    }

    // Any other node type: pass through
    newChildren.push(node);
    i += 1;
  }

  return newChildren;
}

/**
 * Handles a linkable span (pl-c1 or pl-en).
 * Detects chains (Accordion.Trigger.State), links them, and updates state.
 */
function handleLinkableSpan(
  children: ElementContent[],
  startIndex: number,
  options: EnhanceOptions,
  state: ScanState,
): { nodes: ElementContent[]; nextIndex: number } {
  const { anchorMap, typeRefComponent, linkProps } = options;
  const startNode = children[startIndex] as Element;

  // Try to build a chain (look ahead for "." + linkable span)
  const chain: LinkableChain = {
    spans: [startNode],
    dotTexts: [],
    startIndex,
    endIndex: startIndex,
  };

  let j = startIndex + 1;
  while (j < children.length - 1) {
    const maybeText = children[j];
    const maybeNextSpan = children[j + 1];
    if (
      maybeText.type === 'text' &&
      maybeText.value === '.' &&
      maybeNextSpan.type === 'element' &&
      isLinkableSpan(maybeNextSpan)
    ) {
      chain.dotTexts.push(maybeText);
      chain.spans.push(maybeNextSpan);
      chain.endIndex = j + 1;
      j += 2;
    } else {
      break;
    }
  }

  const identifier = chainToIdentifier(chain);
  const href = anchorMap[identifier];
  const nodes: ElementContent[] = [];

  if (href) {
    // Matched: create link element
    if (chain.spans.length === 1) {
      const className = getClassName(startNode);
      nodes.push(
        createLinkElement(href, startNode.children, identifier, className, typeRefComponent),
      );
    } else {
      const wrappedChildren: ElementContent[] = [];
      for (let k = 0; k < chain.spans.length; k += 1) {
        wrappedChildren.push(chain.spans[k]);
        if (k < chain.dotTexts.length) {
          wrappedChildren.push(chain.dotTexts[k]);
        }
      }
      nodes.push(createLinkElement(href, wrappedChildren, identifier, undefined, typeRefComponent));
    }
  } else {
    // No match: keep original nodes
    for (let k = chain.startIndex; k <= chain.endIndex; k += 1) {
      nodes.push(children[k]);
    }
  }

  // Update state based on this entity (use full chain identifier, not just first span)
  updateStateForEntity(identifier, startNode, state, anchorMap, linkProps);

  return { nodes, nextIndex: chain.endIndex + 1 };
}

/**
 * Updates scan state after seeing a linkable entity (pl-c1 or pl-en).
 */
function updateStateForEntity(
  text: string,
  element: Element,
  state: ScanState,
  anchorMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
): void {
  const className = getClassName(element);
  const isEn = className?.includes('pl-en');
  const isC1 = className?.includes('pl-c1');

  // After "type" keyword, the next pl-en is the type name
  if (isEn && state.sawTypeKeyword) {
    state.pendingTypeDefName = text;
    state.expectingTypeDefBrace = true;
    state.sawTypeKeyword = false;
    return;
  }

  // After pl-k(":") for type annotations, pl-en is the type name
  if (isEn && state.pendingAnnotationType === '') {
    state.pendingAnnotationType = text;
    return;
  }

  // JSX opening: after "<", pl-c1 is the component name
  if (isC1 && state.sawJsxOpen && linkProps) {
    const href = anchorMap[text];
    if (href) {
      const paramKey = `${text}[0]`;
      const paramAnchorHref = anchorMap[paramKey] ?? null;
      state.ownerStack.push({
        name: text,
        anchorHref: href,
        kind: 'jsx',
        braceDepth: 1, // JSX doesn't use brace depth, but 1 means "active"
        propPath: [],
        propPathDepths: [],
        paramIndex: 0,
        paramAnchorHref,
      });
    }
    state.sawJsxOpen = false;
    state.jsxComponentName = text;
    return;
  }

  // Track pl-en as potential function name or type annotation name
  if (isEn) {
    // Some highlighters emit "type" as pl-en instead of pl-k
    if (text === 'type') {
      state.sawTypeKeyword = true;
      state.lastEntityName = null;
      return;
    }
    state.lastEntityName = text;
  }

  state.sawJsxOpen = false;
}

/**
 * Handles a property span (pl-v or pl-e).
 * If inside an owner context, wraps it as a prop ref.
 */
function handlePropertySpan(
  node: Element,
  state: ScanState,
  options: EnhanceOptions,
): ElementContent {
  const { linkProps, typePropRefComponent } = options;
  const owner = currentOwner(state);

  if (!owner || !linkProps) {
    return node;
  }

  // In shallow mode, skip nested properties
  if (linkProps === 'shallow' && owner.braceDepth > 1) {
    return node;
  }

  const propName = getTextContent(node);
  const propPathStr = propPathToString(owner.propPath, propName);
  const anchor = buildPropHref(owner, propPathStr);
  const className = getClassName(node);
  const isDefinition = owner.kind === 'type-def';

  state.lastLinkedProp = propName;

  return createPropRefElement(
    anchor,
    node.children,
    owner.name,
    propPathStr,
    isDefinition,
    className,
    typePropRefComponent,
  );
}

/**
 * Handles a keyword span (pl-k) by updating scan state.
 */
function handleKeywordSpan(node: Element, state: ScanState): void {
  const text = getTextContent(node);

  switch (text) {
    case 'type':
      state.sawTypeKeyword = true;
      state.lastEntityName = null;
      state.typeDefPersist = null;
      break;
    case 'const':
    case 'let':
    case 'var':
      // Reset — next pl-en after ":" will be the type annotation
      state.sawTypeKeyword = false;
      state.lastEntityName = null;
      state.typeDefPersist = null;
      break;
    case ':':
      // If we have a lastEntityName pending (from a type annotation context),
      // prepare to capture the type name
      if (!state.sawTypeKeyword && !currentOwner(state)) {
        state.pendingAnnotationType = ''; // sentinel: next pl-en fills this
      }
      break;
    case '=':
      // After type annotation "const x: Type =", expect a brace
      if (state.pendingAnnotationType && state.pendingAnnotationType !== '') {
        state.expectingAnnotationBrace = true;
      }
      // After type keyword "type Name =", expect a brace
      if (state.pendingTypeDefName) {
        state.expectingTypeDefBrace = true;
      }
      break;
    default:
      break;
  }
}

/**
 * A rehype plugin that links code identifiers and their properties to
 * corresponding type documentation anchors.
 *
 * **Type/export linking** (existing behavior):
 * Transforms `<span class="pl-en">Trigger</span>` → `<a href="#trigger">Trigger</a>`
 * and chains like `Accordion.Trigger` into single anchors.
 *
 * **Property linking** (new, opt-in via `linkProps`):
 * Inside type definitions, object literals, function calls, and JSX components,
 * wraps property names with prop ref elements linked to `#anchor:prop-name`.
 *
 * @param options - Configuration options
 * @returns A unified transformer function
 */
export default function enhanceCodeExportLinks(options: EnhanceCodeExportLinksOptions) {
  const enhanceOptions: EnhanceOptions = {
    anchorMap: options.anchorMap,
    typeRefComponent: options.typeRefComponent,
    typePropRefComponent: options.typePropRefComponent,
    linkProps: options.linkProps,
  };

  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'code') {
        return;
      }
      if (!node.children || node.children.length === 0) {
        return;
      }

      const state = createScanState();
      node.children = enhanceChildren(node.children, enhanceOptions, state);
    });
  };
}
