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
 * Language capabilities derived from the code element's `language-*` class.
 *
 * - `ts`/`typescript`: types ✓, JSX ✗, JS semantics ✓
 * - `tsx`: types ✓, JSX ✓, JS semantics ✓
 * - `js`/`javascript`: types ✗, JSX ✗, JS semantics ✓
 * - `jsx`: types ✗, JSX ✓, JS semantics ✓
 * - `css`/`scss`/`less`/`sass`: CSS semantics ✓
 * - no class / unknown: all ✗
 */
interface LanguageCapabilities {
  /** Whether `type Name` and `const name: Name =` syntax is recognized. */
  supportsTypes: boolean;
  /** Whether JSX `<Component prop={}>` syntax is recognized. */
  supportsJsx: boolean;
  /** Whether JS semantics like `func({ key: value })` are recognized. */
  supportsJsSemantics: boolean;
  /** Whether CSS semantics are recognized. */
  supportsCssSemantics: boolean;
}

const BASE_CAPABILITIES: LanguageCapabilities = {
  supportsTypes: false,
  supportsJsx: false,
  supportsJsSemantics: false,
  supportsCssSemantics: false,
};

/**
 * Detects language capabilities from a `<code>` element's class list.
 * Looks for a `language-*` class following standard markdown fenced-code conventions.
 */
function getLanguageCapabilities(node: Element): LanguageCapabilities {
  const classes = getClassName(node);
  if (!classes) {
    return BASE_CAPABILITIES;
  }

  const langClass = classes.find((c) => c.startsWith('language-'));
  if (!langClass) {
    return BASE_CAPABILITIES;
  }

  const lang = langClass.slice('language-'.length).toLowerCase();
  switch (lang) {
    case 'js':
    case 'javascript':
      return {
        supportsTypes: false,
        supportsJsx: false,
        supportsJsSemantics: true,
        supportsCssSemantics: false,
      };
    case 'jsx':
      return {
        supportsTypes: false,
        supportsJsx: true,
        supportsJsSemantics: true,
        supportsCssSemantics: false,
      };
    case 'ts':
    case 'typescript':
      return {
        supportsTypes: true,
        supportsJsx: false,
        supportsJsSemantics: true,
        supportsCssSemantics: false,
      };
    case 'tsx':
      return {
        supportsTypes: true,
        supportsJsx: true,
        supportsJsSemantics: true,
        supportsCssSemantics: false,
      };
    case 'css':
    case 'scss':
    case 'less':
    case 'sass':
      return {
        supportsTypes: false,
        supportsJsx: false,
        supportsJsSemantics: false,
        supportsCssSemantics: true,
      };
    default:
      return BASE_CAPABILITIES;
  }
}

/**
 * Options for the enhanceCodeExportLinks plugin.
 */
export interface EnhanceCodeExportLinksOptions {
  /**
   * Platform-scoped anchor maps. Each code element resolves its anchor map based
   * on its language class: JS-family languages use `js`, CSS-family use `css`.
   *
   * Each map maps export names (both flat and dotted) to their anchor hrefs.
   * Examples (within `js`):
   * - `"AccordionTrigger"` → `"#trigger"`
   * - `"Accordion.Trigger"` → `"#trigger"`
   */
  anchorMap: {
    /** Anchors for JS-family languages (js, jsx, ts, tsx). */
    js?: Record<string, string>;
    /** Anchors for CSS-family languages (css, scss, less, sass). */
    css?: Record<string, string>;
  };
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
  /**
   * Opt-in function parameter linking.
   * When `true`, links function parameter names (`pl-v` spans inside parentheses)
   * to documentation anchors.
   *
   * At definition sites (type definitions), params produce positional `id` anchors
   * (e.g., `id="callback[0]"`). Named anchors can be provided via `anchorMap`
   * (e.g., `anchorMap["Callback[0]"]`) to override the positional id.
   * At reference sites (annotations, function calls), params produce positional
   * `href` anchors resolved through `anchorMap["Owner[N]"]` named anchors.
   */
  linkParams?: boolean;
  /**
   * When set, the plugin emits a custom component element instead of a plain HTML element
   * for function parameter references.
   *
   * For definition sites, the element receives `id` (anchor target).
   * For reference sites, the element receives `href` (link).
   * Both also receive `name` (the owner identifier) and `param` (parameter name).
   */
  typeParamRefComponent?: string;
  /**
   * Links later uses of identifiers whose type provenance was proven during parse.
   * Conservative and single-pass: only syntactically explicit bindings (`param: Type`,
   * `const x: Type`, `{ a }: Type`) are tracked. Uncertain cases stay unlinked.
   *
   * Variable references (`pl-smi` spans) are resolved against a scope stack and linked
   * to the appropriate type, property, or parameter anchor depending on how the variable
   * was declared. `let`/`const` are block-scoped; `var` and function params are
   * function-scoped (no hoisting — linked only after their declaration).
   */
  linkScope?: boolean;
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
 * In CSS contexts, pl-v (CSS variables) and pl-e (class selectors) are also linkable.
 * Only spans are considered linkable - not anchors we've already created.
 */
function isLinkableSpan(element: Element, lang?: LanguageCapabilities): boolean {
  if (isConstantSpan(element) || isEntityNameSpan(element)) {
    return true;
  }
  if (lang?.supportsCssSemantics) {
    return isPropertyNameSpan(element) || (element.tagName === 'span' && hasClass(element, 'pl-e'));
  }
  return false;
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
 * Checks if an element is an identifier reference span (pl-smi).
 */
function isSmiSpan(element: Element): boolean {
  return element.tagName === 'span' && hasClass(element, 'pl-smi');
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
 * Creates a HAST element for a function parameter reference.
 *
 * When a custom tag is provided (`typeParamRefComponent`), emits that element with
 * `name` (owner) and `param` (parameter name) attributes.
 * Otherwise falls back to `<span id>` (definition) or `<a href>` (reference).
 */
function createParamRefElement(
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

/**
 * A proven binding in a scope — links a variable name to its type origin.
 * Discriminated on `refKind` so that each variant carries exactly the
 * metadata needed to produce the correct link element.
 */
type ScopeBinding =
  | { refKind: 'type'; href: string; typeName: string }
  | { refKind: 'prop'; href: string; ownerName: string; propPath: string }
  | { refKind: 'param'; href: string; paramOwnerName: string; paramName: string };

/**
 * A single lexical scope in the scope stack.
 * - `'function'`: function body scope (holds `var` bindings and params)
 * - `'block'`: block scope (holds `let`/`const` bindings)
 */
interface Scope {
  bindings: Map<string, ScopeBinding>;
  kind: 'function' | 'block';
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
  kind: 'type-def' | 'type-annotation' | 'func-call' | 'jsx' | 'css-property';
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
  /** Pending CSS property name for owner context (set after a linked pl-c1 span in CSS) */
  pendingCssProperty: { name: string; anchorHref: string } | null;
  /** Set after seeing pl-k("function") keyword */
  sawFunctionKeyword: boolean;
  /** Scope stack for variable reference resolution (innermost last) */
  scopeStack: Scope[];
  /**
   * Set when `)` closes a recognized non-definition funcParamContext.
   * The next `{` pushes a function scope and flushes pendingFunctionBindings.
   * Cleared on any token that isn't `{` or a `=>` keyword span.
   */
  expectingFunctionBody: boolean;
  /**
   * Transient flag set when `=>` keyword is seen while expectingFunctionBody is true.
   * Consumed by text `(` to set expressionArrowBody.
   */
  sawArrowForBody: boolean;
  /**
   * Set when `(` follows `=>` while expectingFunctionBody is true.
   * Indicates the arrow has an expression body with a paren-wrapped object literal
   * `=> ({...})` — the `{` should push a block scope, not a function scope.
   */
  expressionArrowBody: boolean;
  /**
   * Param bindings saved from funcParamContext at `)` close, waiting for `{`
   * to flush into the new function scope. Dropped if expectingFunctionBody is cleared.
   */
  pendingFunctionBindings: Map<string, ScopeBinding> | null;
  /** Variable name from `const x` / `let x` / `var x`, awaiting type annotation */
  lastDeclaredVarName: string | null;
  /** Which variable keyword (`const`/`let`/`var`) introduced lastDeclaredVarName */
  lastVarKeyword: 'const' | 'let' | 'var' | null;
  /**
   * Active function-parameter context. Set when inside a parenthesised parameter
   * list of a known owner (type def arrow, annotation arrow, function decl, or
   * callback property in deep mode). `pl-v` spans inside this context are treated
   * as function parameters rather than object properties.
   */
  funcParamContext: {
    /** Owner name for anchor building */
    ownerName: string;
    /** Base anchor href from the anchorMap */
    anchorHref: string;
    /** Paren nesting depth (1 = top-level params) */
    parenDepth: number;
    /** Nesting depth of braces/brackets inside the param list (for destructuring) */
    nestedBracketDepth: number;
    /** Nesting depth of angle brackets inside the param list (for generics) */
    nestedAngleDepth: number;
    /** 0-indexed position of the current parameter */
    paramIndex: number;
    /** Whether this is a definition site (type def) or reference site */
    isDefinition: boolean;
    /** Inherited property path from an outer owner (for deep callback nesting) */
    basePropPath: string[];
    /** Whether we're inside a default value expression (after `=` in a param slot) */
    inDefaultValue: boolean;
    /** Most recently linked param name (for upgrading to type-ref when annotation follows) */
    lastParamName: string | null;
    /** Flat destructured names accumulated inside `{ }` in the param list */
    destructuredNames: string[];
    /** True when a `:` is seen inside destructuring braces — indicates rename or nesting, bail out of prop-ref bindings */
    sawColonInDestructuring: boolean;
    /** Pending scope bindings collected from this function's params, flushed into the function scope on `{` */
    pendingScopeBindings: Map<string, ScopeBinding>;
  } | null;
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
    pendingCssProperty: null,
    sawFunctionKeyword: false,
    scopeStack: [],
    expectingFunctionBody: false,
    sawArrowForBody: false,
    expressionArrowBody: false,
    pendingFunctionBindings: null,
    lastDeclaredVarName: null,
    lastVarKeyword: null,
    funcParamContext: null,
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
 * Builds the anchor map lookup key for a deep callback property.
 * For JSX/func-call owners with paramAnchorHref, uses the resolved owner key path.
 * For type-def/type-annotation, uses `OwnerName:prop.path`.
 */
function buildParamOwnerKey(owner: OwnerContext, propPath: string[]): string {
  const propPathStr = propPath.map(toKebabCase).join('.');
  if (owner.paramAnchorHref) {
    // The paramAnchorHref is pre-resolved (e.g., Test[0] → #test:props).
    // Build the key as Owner:props:propPath to match the anchorMap convention.
    return `${owner.name}:${propPathStr}`;
  }
  if (owner.kind === 'func-call' || owner.kind === 'jsx') {
    if (owner.paramIndex === 0) {
      return `${owner.name}:${propPathStr}`;
    }
    return `${owner.name}:${owner.paramIndex}:${propPathStr}`;
  }
  return `${owner.name}:${propPathStr}`;
}

/**
 * Builds the anchor for a function parameter.
 *
 * At **definition sites** (type defs), checks `anchorMap["Owner[N]"]` for a named
 * anchor, then falls back to the positional format `#anchor[N]`.
 *
 * At **reference sites**, resolves through `anchorMap["OwnerKey[N]"]` named anchors,
 * or falls back to `#anchor[N]`.
 */
function buildParamHref(
  ctx: NonNullable<ScanState['funcParamContext']>,
  paramName: string,
  anchorMap: Record<string, string>,
): string {
  const basePath = ctx.basePropPath.length > 0 ? ctx.basePropPath.map(toKebabCase).join('.') : null;

  if (ctx.isDefinition) {
    // Definition site: check for a named anchor in the anchorMap first,
    // then fall back to positional format so reference sites can link without a map entry
    const paramKey = basePath
      ? `${ctx.ownerName}:${basePath}[${ctx.paramIndex}]`
      : `${ctx.ownerName}[${ctx.paramIndex}]`;
    const namedAnchor = anchorMap[paramKey];
    if (namedAnchor) {
      return namedAnchor.startsWith('#') ? namedAnchor.slice(1) : namedAnchor;
    }
    if (basePath) {
      return `${ctx.anchorHref}:${basePath}[${ctx.paramIndex}]`;
    }
    return `${ctx.anchorHref}[${ctx.paramIndex}]`;
  }

  // Reference site: look up named anchor first
  const paramKey = basePath
    ? `${ctx.ownerName}:${basePath}[${ctx.paramIndex}]`
    : `${ctx.ownerName}[${ctx.paramIndex}]`;
  const namedAnchor = anchorMap[paramKey];
  if (namedAnchor) {
    return namedAnchor;
  }

  // Fallback to positional
  if (basePath) {
    return `${ctx.anchorHref}:${basePath}[${ctx.paramIndex}]`;
  }
  return `${ctx.anchorHref}[${ctx.paramIndex}]`;
}

/**
 * Scans forward through sibling nodes to determine if `=>` or a function body `{`
 * follows after the matching `)` for the current `(`. This confirms that a
 * parenthesized expression is actually a function parameter list.
 *
 * Starts scanning from `charIndex` within the text node at `siblings[siblingIndex]`,
 * with an initial paren depth of 1 (the opening `(` has been consumed).
 */
function hasArrowAfterParens(
  siblings: ElementContent[],
  siblingIndex: number,
  charIndex: number,
): boolean {
  let depth = 1;

  // Scan the rest of the current text node
  const firstNode = siblings[siblingIndex];
  if (firstNode.type === 'text') {
    for (let j = charIndex; j < firstNode.value.length; j += 1) {
      const c = firstNode.value[j];
      if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          // Check the rest of this text node for =>
          const rest = firstNode.value.substring(j + 1).trimStart();
          if (rest.startsWith('=>')) {
            return true;
          }
          // Need to check subsequent siblings
          return checkSiblingsForArrow(siblings, siblingIndex + 1);
        }
      }
    }
  }

  // Continue scanning subsequent siblings
  for (let s = siblingIndex + 1; s < siblings.length; s += 1) {
    const sib = siblings[s];
    if (sib.type === 'text') {
      for (let j = 0; j < sib.value.length; j += 1) {
        const c = sib.value[j];
        if (c === '(') {
          depth += 1;
        } else if (c === ')') {
          depth -= 1;
          if (depth === 0) {
            const rest = sib.value.substring(j + 1).trimStart();
            if (rest.startsWith('=>')) {
              return true;
            }
            return checkSiblingsForArrow(siblings, s + 1);
          }
        }
      }
    }
    // Element nodes (spans) don't contain parens in their text content for our purposes,
    // but we skip them for depth tracking. The `=>` keyword is always a pl-k span.
  }

  return false;
}

/**
 * After finding the matching `)`, checks subsequent siblings for `=>` (pl-k span or text).
 * Bare `{` is NOT accepted — that pattern is a function declaration handled by case 3
 * (sawFunctionKeyword). Accepting `{` here would false-classify `if(cond){}` as a function.
 * Skips whitespace text nodes and return-type annotations (`: Type`).
 */
function checkSiblingsForArrow(siblings: ElementContent[], startIndex: number): boolean {
  let sawReturnTypeColon = false;

  for (let s = startIndex; s < siblings.length; s += 1) {
    const sib = siblings[s];
    if (sib.type === 'text') {
      const trimmed = sib.value.trimStart();
      if (trimmed.length === 0) {
        continue; // whitespace-only text node, skip
      }
      // Text starting with => confirms arrow function
      if (trimmed.startsWith('=>')) {
        return true;
      }
      // Colon after `)` means a return-type annotation (e.g., `(a): Result => {}`)
      if (!sawReturnTypeColon && trimmed.startsWith(':')) {
        sawReturnTypeColon = true;
        continue;
      }
      // Inside a return type annotation, skip type-related text tokens
      if (sawReturnTypeColon) {
        continue;
      }
      return false;
    }
    if (sib.type === 'element') {
      if (isKeywordSpan(sib)) {
        const text = getTextContent(sib);
        // pl-k span containing "=>" confirms arrow function
        if (text === '=>') {
          return true;
        }
        // pl-k ":" is a return-type annotation colon
        if (!sawReturnTypeColon && text === ':') {
          sawReturnTypeColon = true;
          continue;
        }
      }
      // Inside a return type annotation, skip type name spans and other tokens
      if (sawReturnTypeColon) {
        continue;
      }
      // Any other element without a prior colon means it's not an arrow function
      return false;
    }
  }
  return false;
}

/**
 * Tries to create a funcParamContext when "(" is encountered.
 * Returns the context if a known owner is detected, otherwise null.
 *
 * Contexts detected (in priority order):
 * 1. Type def arrow: `type Cb = (`  — definition site (confirmed by `=>` lookahead)
 * 2. Type annotation arrow: `const cb: Type = (`  — reference site (confirmed by `=>` lookahead)
 * 3. Function declaration: `function name(`  — reference site (links via anchorMap)
 * 4. Deep callback property: inside owner, `{ callback: (`  — inherits owner context
 * 5. Deep callback via brace-nested prop path: `{ func: {(` or JSX `func={(`  — inherits owner context
 */
function tryStartFuncParamContext(
  state: ScanState,
  anchorMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
  linkScope: boolean | undefined,
  siblings: ElementContent[],
  siblingIndex: number,
  charIndex: number,
): ScanState['funcParamContext'] {
  // 1. Type def arrow: type Cb = (
  //    Only enter param context if `=>` follows the matching `)`.
  if (state.expectingTypeDefBrace && state.pendingTypeDefName) {
    const lookup = lookupOwner(state.pendingTypeDefName, anchorMap);
    if (lookup && hasArrowAfterParens(siblings, siblingIndex, charIndex)) {
      // Also set typeDefPersist so brace-based property linking still works
      // after the arrow function if it's a union type
      state.typeDefPersist = {
        name: lookup.ownerName,
        anchorHref: lookup.anchorHref,
      };
      state.pendingTypeDefName = null;
      state.expectingTypeDefBrace = false;
      return {
        ownerName: lookup.ownerName,
        anchorHref: lookup.anchorHref,
        parenDepth: 1,
        nestedBracketDepth: 0,
        nestedAngleDepth: 0,
        paramIndex: 0,
        isDefinition: true,
        basePropPath: [],
        inDefaultValue: false,
        lastParamName: null,
        destructuredNames: [],
        sawColonInDestructuring: false,
        pendingScopeBindings: new Map(),
      };
    }
  }

  // 2. Type annotation arrow: const cb: Type = (
  //    Only enter param context if `=>` follows the matching `)`.
  if (state.expectingAnnotationBrace && state.pendingAnnotationType) {
    const lookup = lookupOwner(state.pendingAnnotationType, anchorMap);
    if (lookup && hasArrowAfterParens(siblings, siblingIndex, charIndex)) {
      state.pendingAnnotationType = null;
      state.expectingAnnotationBrace = false;
      return {
        ownerName: lookup.ownerName,
        anchorHref: lookup.anchorHref,
        parenDepth: 1,
        nestedBracketDepth: 0,
        nestedAngleDepth: 0,
        paramIndex: 0,
        isDefinition: false,
        basePropPath: [],
        inDefaultValue: false,
        lastParamName: null,
        destructuredNames: [],
        sawColonInDestructuring: false,
        pendingScopeBindings: new Map(),
      };
    }
  }

  // 3. Function declaration: function name(
  //    Always clear sawFunctionKeyword to prevent leaking to later contexts
  //    (e.g., anonymous `function (...) {}` where lastEntityName is absent).
  if (state.sawFunctionKeyword) {
    state.sawFunctionKeyword = false;
    const name = state.lastEntityName;
    state.lastEntityName = null;
    if (!name) {
      // With linkScope, still create a context for anonymous functions
      if (linkScope) {
        return {
          ownerName: '',
          anchorHref: '',
          parenDepth: 1,
          nestedBracketDepth: 0,
          nestedAngleDepth: 0,
          paramIndex: 0,
          isDefinition: false,
          basePropPath: [],
          inDefaultValue: false,
          lastParamName: null,
          destructuredNames: [],
          sawColonInDestructuring: false,
          pendingScopeBindings: new Map(),
        };
      }
      return null;
    }
    const href = anchorMap[name];
    if (href || linkScope) {
      return {
        ownerName: name,
        anchorHref: href ?? '',
        parenDepth: 1,
        nestedBracketDepth: 0,
        nestedAngleDepth: 0,
        paramIndex: 0,
        isDefinition: false,
        basePropPath: [],
        inDefaultValue: false,
        lastParamName: null,
        destructuredNames: [],
        sawColonInDestructuring: false,
        pendingScopeBindings: new Map(),
      };
    }
  }

  // 4. Deep callback property: inside an owner context, after a linked property
  //    e.g., type Opts = { callback: (details) => void }
  //    Only enter param context if `=>` follows the matching `)`.
  const owner = currentOwner(state);
  if (owner && linkProps === 'deep' && state.lastLinkedProp) {
    const fullPropPath = [...owner.propPath, state.lastLinkedProp];
    const propPathStr = fullPropPath.map(toKebabCase).join('.');
    // Resolve the full href for the callback property so params build on top of it
    const resolvedHref = buildPropHref(owner, propPathStr);
    // Build the ownerName key for anchorMap lookup of positional params
    const resolvedOwnerKey = buildParamOwnerKey(owner, fullPropPath);
    if (hasArrowAfterParens(siblings, siblingIndex, charIndex)) {
      state.lastLinkedProp = null;
      return {
        ownerName: resolvedOwnerKey,
        anchorHref: resolvedHref,
        parenDepth: 1,
        nestedBracketDepth: 0,
        nestedAngleDepth: 0,
        paramIndex: 0,
        isDefinition: owner.kind === 'type-def',
        basePropPath: [],
        inDefaultValue: false,
        lastParamName: null,
        destructuredNames: [],
        sawColonInDestructuring: false,
        pendingScopeBindings: new Map(),
      };
    }
  }

  // 5. Deep callback via brace-nested prop path: `{ func: {(` or JSX `func={(`
  //    The `{` already pushed the prop into owner.propPath, so lastLinkedProp is null.
  //    Detect this by checking if owner.propPath is non-empty and braceDepth matches
  //    the last propPathDepth (meaning we're directly inside the brace that followed the prop).
  if (owner && linkProps === 'deep' && owner.propPath.length > 0) {
    const lastPropDepth = owner.propPathDepths[owner.propPathDepths.length - 1];
    if (
      lastPropDepth === owner.braceDepth &&
      hasArrowAfterParens(siblings, siblingIndex, charIndex)
    ) {
      const propPathStr = owner.propPath.map(toKebabCase).join('.');
      const resolvedHref = buildPropHref(owner, propPathStr);
      const resolvedOwnerKey = buildParamOwnerKey(owner, owner.propPath);
      return {
        ownerName: resolvedOwnerKey,
        anchorHref: resolvedHref,
        parenDepth: 1,
        nestedBracketDepth: 0,
        nestedAngleDepth: 0,
        paramIndex: 0,
        isDefinition: owner.kind === 'type-def',
        basePropPath: [],
        inDefaultValue: false,
        lastParamName: null,
        destructuredNames: [],
        sawColonInDestructuring: false,
        pendingScopeBindings: new Map(),
      };
    }
  }

  // 6. Scope-only: bare arrow function — (x: Type) => { ... }
  //    When linkScope is enabled and an arrow follows the parens, create a
  //    funcParamContext for scope tracking even without a known function name.
  //    If inside a pendingFuncCall, derive the owner from the call context so
  //    unannotated params can get positional bindings (e.g. callFunction[0][0]).
  if (linkScope && hasArrowAfterParens(siblings, siblingIndex, charIndex)) {
    let callbackOwner = '';
    let callbackHref = '';
    if (state.pendingFuncCall) {
      const callCtx = state.pendingFuncCall;
      callbackOwner = `${callCtx.name}[${callCtx.paramIndex}]`;
      callbackHref = anchorMap[callbackOwner] ?? `${callCtx.anchorHref}[${callCtx.paramIndex}]`;
    }
    return {
      ownerName: callbackOwner,
      anchorHref: callbackHref,
      parenDepth: 1,
      nestedBracketDepth: 0,
      nestedAngleDepth: 0,
      paramIndex: 0,
      isDefinition: false,
      basePropPath: [],
      inDefaultValue: false,
      lastParamName: null,
      destructuredNames: [],
      sawColonInDestructuring: false,
      pendingScopeBindings: new Map(),
    };
  }

  return null;
}

/**
 * Flushes an unannotated function parameter as a positional scope binding.
 * When a param has no type annotation but the funcParamContext has a known owner
 * (e.g. from a pendingFuncCall), creates a 'param' binding using positional
 * notation like `callFunction[0][0]`.
 */
function flushUnannotatedParam(
  ctx: NonNullable<ScanState['funcParamContext']>,
  anchorMap: Record<string, string>,
): void {
  if (!ctx.lastParamName || !ctx.ownerName) {
    return;
  }
  // Only flush if no binding was already created (by a type annotation)
  if (ctx.pendingScopeBindings.has(ctx.lastParamName)) {
    return;
  }
  const paramKey = `${ctx.ownerName}[${ctx.paramIndex}]`;
  const href = anchorMap[paramKey];
  if (!href) {
    return;
  }
  ctx.pendingScopeBindings.set(ctx.lastParamName, {
    refKind: 'param',
    href,
    paramOwnerName: ctx.ownerName,
    paramName: ctx.lastParamName,
  });
  ctx.lastParamName = null;
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
  linkParams: boolean | undefined,
  linkScope: boolean | undefined,
  typePropRefComponent: string | undefined,
  lang: LanguageCapabilities,
  siblings: ElementContent[],
  siblingIndex: number,
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

    // NOTE: expectingFunctionBody is NOT cleared in text nodes.
    // Between ) and {, return-type annotations can contain arbitrary text
    // (e.g. ): Promise<Result<T[]>> {) including type-name identifiers.
    // Stale flags are cleared by: `;` handler, element-level guard, and `{` itself.

    // JSX opening "<" — but not inside funcParamContext where it's a generic angle bracket
    if (ch === '<' && lang.supportsJsx && !state.funcParamContext) {
      state.sawJsxOpen = true;
      i += 1;
      continue;
    }

    // JSX self-closing "/>"
    if (
      ch === '/' &&
      text[i + 1] === '>' &&
      lang.supportsJsx &&
      currentOwner(state)?.kind === 'jsx'
    ) {
      flush(i);
      state.ownerStack.pop();
      i += 2;
      textStart = i;
      continue;
    }

    // JSX closing ">" (only in JSX context; avoid matching ">" in "=>")
    if (ch === '>' && lang.supportsJsx && currentOwner(state)?.kind === 'jsx') {
      flush(i);
      state.ownerStack.pop();
      i += 1;
      textStart = i;
      continue;
    }

    // Arrow "=>" in text — some highlighters emit => as plain text rather than
    // a pl-k keyword span. Detect it here so expressionArrowBody tracking works.
    if (
      ch === '=' &&
      text[i + 1] === '>' &&
      state.expectingFunctionBody &&
      !state.sawArrowForBody
    ) {
      state.sawArrowForBody = true;
      i += 2;
      continue;
    }

    // Open parenthesis "(" — start function call tracking, type def paren tracking,
    // or function parameter context
    if (ch === '(') {
      // Nested paren inside an existing funcParamContext
      if (state.funcParamContext) {
        state.funcParamContext.parenDepth += 1;
        i += 1;
        continue;
      }

      // Expression-bodied arrow: `=> ({...})` — the `(` after `=>` means the
      // body is an expression, not a block. Mark so the `{` pushes a block scope.
      if (state.sawArrowForBody && state.expectingFunctionBody) {
        state.expressionArrowBody = true;
        state.sawArrowForBody = false;
      }

      // Try to start a funcParamContext for param/scope linking
      if ((linkParams || linkScope) && lang.supportsJsSemantics) {
        const paramCtx = tryStartFuncParamContext(
          state,
          anchorMap,
          linkProps,
          linkScope,
          siblings,
          siblingIndex,
          i + 1, // charIndex after the '('
        );
        if (paramCtx) {
          state.funcParamContext = paramCtx;
          i += 1;
          continue;
        }
      }

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
      } else if (
        lang.supportsJsSemantics &&
        state.lastEntityName &&
        state.lastEntityName in anchorMap &&
        (linkProps || linkScope)
      ) {
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

    // Close parenthesis ")" — end func param context, function call, or type def paren tracking
    if (ch === ')') {
      if (state.funcParamContext) {
        state.funcParamContext.parenDepth -= 1;
        if (state.funcParamContext.parenDepth === 0) {
          // Flush last unannotated param as positional binding before saving
          if (linkScope) {
            flushUnannotatedParam(state.funcParamContext, anchorMap);
          }
          // Save pending scope bindings before clearing the context
          if (linkScope && !state.funcParamContext.isDefinition) {
            state.pendingFunctionBindings = state.funcParamContext.pendingScopeBindings;
            state.expectingFunctionBody = true;
          }
          state.funcParamContext = null;
        }
        i += 1;
        continue;
      }
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

    // Comma "," — increment parameter index in function calls or func param contexts
    if (ch === ',') {
      if (
        state.funcParamContext &&
        state.funcParamContext.parenDepth === 1 &&
        state.funcParamContext.nestedBracketDepth === 0 &&
        state.funcParamContext.nestedAngleDepth === 0
      ) {
        // Flush unannotated param as positional binding before advancing
        if (linkScope) {
          flushUnannotatedParam(state.funcParamContext, anchorMap);
        }
        state.funcParamContext.paramIndex += 1;
        state.funcParamContext.inDefaultValue = false;
      } else if (
        state.pendingFuncCall &&
        state.pendingFuncCall.parenDepth === 1 &&
        !currentOwner(state)
      ) {
        state.pendingFuncCall.paramIndex += 1;
      }
    }

    // CSS colon ":" — start CSS property owner context
    if (ch === ':' && lang.supportsCssSemantics && state.pendingCssProperty && linkProps) {
      state.ownerStack.push({
        name: state.pendingCssProperty.name,
        anchorHref: state.pendingCssProperty.anchorHref,
        kind: 'css-property',
        braceDepth: 0,
        propPath: [],
        propPathDepths: [],
        paramIndex: 0,
        paramAnchorHref: null,
      });
      state.pendingCssProperty = null;
      i += 1;
      continue;
    }

    // CSS semicolon ";" — end CSS property owner context
    if (ch === ';' && currentOwner(state)?.kind === 'css-property') {
      flush(i);
      state.ownerStack.pop();
      i += 1;
      textStart = i;
      continue;
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

    // Clear stale pendingCssProperty at semicolons and braces
    if ((ch === ';' || ch === '{' || ch === '}') && state.pendingCssProperty) {
      state.pendingCssProperty = null;
    }

    // Semicolon ";" — scope ambiguity resets
    if (ch === ';' && linkScope) {
      state.lastDeclaredVarName = null;
      state.lastVarKeyword = null;
      state.expectingFunctionBody = false;
      state.sawArrowForBody = false;
      state.expressionArrowBody = false;
      state.pendingFunctionBindings = null;
    }

    // Open brace "{"
    if (ch === '{') {
      if (state.funcParamContext) {
        state.funcParamContext.nestedBracketDepth += 1;
      } else if (linkScope && state.expectingFunctionBody) {
        // Function body takes priority over owner tracking (e.g., arrow body
        // inside a pendingFuncCall should be a function scope, not an object arg).
        // For expression-bodied arrows `=> ({...})`, push a block scope instead
        // of a function scope to avoid trapping `var` hoisting.
        const bindings = state.pendingFunctionBindings ?? new Map();
        const kind = state.expressionArrowBody ? 'block' : 'function';
        state.scopeStack.push({ bindings, kind });
        state.pendingFunctionBindings = null;
        state.expectingFunctionBody = false;
        state.sawArrowForBody = false;
        state.expressionArrowBody = false;
      } else {
        const handled = handleOpenBrace(state, anchorMap, linkProps);
        if (!handled && linkScope) {
          // Push a block scope
          state.scopeStack.push({ bindings: new Map(), kind: 'block' });
        }
      }
      i += 1;
      continue;
    }

    // Close brace "}"
    if (ch === '}') {
      if (state.funcParamContext && state.funcParamContext.nestedBracketDepth > 0) {
        state.funcParamContext.nestedBracketDepth -= 1;
      } else {
        const handled = handleCloseBrace(state);
        if (!handled && linkScope && state.scopeStack.length > 1) {
          state.scopeStack.pop();
        }
      }
      i += 1;
      continue;
    }

    // Open bracket "[" — track nesting inside func param context (destructuring)
    if (ch === '[' && state.funcParamContext) {
      state.funcParamContext.nestedBracketDepth += 1;
      i += 1;
      continue;
    }

    // Close bracket "]" — track nesting inside func param context (destructuring)
    if (ch === ']' && state.funcParamContext && state.funcParamContext.nestedBracketDepth > 0) {
      state.funcParamContext.nestedBracketDepth -= 1;
      i += 1;
      continue;
    }

    // Open angle bracket "<" — track nesting inside func param context (generics)
    // Skip when inside a default value expression, where "<" is a comparison operator
    if (ch === '<' && state.funcParamContext && !state.funcParamContext.inDefaultValue) {
      state.funcParamContext.nestedAngleDepth += 1;
      i += 1;
      continue;
    }

    // Close angle bracket ">" — track nesting inside func param context (generics)
    if (ch === '>' && state.funcParamContext && state.funcParamContext.nestedAngleDepth > 0) {
      state.funcParamContext.nestedAngleDepth -= 1;
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
 * Returns true if the brace was consumed by owner logic, false otherwise.
 */
function handleOpenBrace(
  state: ScanState,
  anchorMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
): boolean {
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  // Nested brace inside an owner (skip CSS property owners — they end at `;`, not `}`)
  if (owner && owner.kind !== 'css-property') {
    owner.braceDepth += 1;
    if (linkProps === 'deep' && state.lastLinkedProp) {
      owner.propPath.push(state.lastLinkedProp);
      owner.propPathDepths.push(owner.braceDepth);
      state.lastLinkedProp = null;
    }
    return true;
  }

  return false;
}

/**
 * Handles a close brace "}" in text, updating the scan state.
 * Returns true if the brace was consumed by owner logic, false otherwise.
 */
function handleCloseBrace(state: ScanState): boolean {
  const owner = currentOwner(state);
  if (!owner || owner.kind === 'css-property') {
    return false;
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

  return true;
}

/**
 * Options passed to enhanceChildren for cleaner signatures.
 */
interface EnhanceOptions {
  anchorMap: Record<string, string>;
  typeRefComponent?: string;
  typePropRefComponent?: string;
  typeParamRefComponent?: string;
  linkProps?: 'shallow' | 'deep';
  linkParams?: boolean;
  linkScope?: boolean;
  lang: LanguageCapabilities;
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
  const { anchorMap, typePropRefComponent, linkProps, linkParams, linkScope, lang } = options;
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
        linkParams,
        linkScope,
        typePropRefComponent,
        lang,
        children,
        i,
      );
      newChildren.push(...processed);
      i += 1;
      continue;
    }

    // --- Element node ---
    if (node.type === 'element') {
      // Tighten expectingFunctionBody: allow return-type annotation tokens
      // (keyword spans like `:`, `=>`, `|`, `&`, linkable type-name spans,
      // and property spans like pl-v for type parameters e.g. `T` in `Map<K, T>`)
      // to pass through; clear on other spans (identifiers like pl-smi).
      if (state.expectingFunctionBody && linkScope) {
        const isAllowedSpan =
          isKeywordSpan(node) || isLinkableSpan(node, lang) || isPropertySpan(node);
        if (!isAllowedSpan) {
          state.expectingFunctionBody = false;
          state.sawArrowForBody = false;
          state.expressionArrowBody = false;
          state.pendingFunctionBindings = null;
        }
      }

      // Linkable span (pl-c1, pl-en; also pl-v, pl-e in CSS): handle chains + state updates
      if (isLinkableSpan(node, lang)) {
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
        handleKeywordSpan(node, state, lang);
        newChildren.push(node);
        i += 1;
        continue;
      }

      // Identifier reference span (pl-smi): resolve against scope stack
      if (linkScope && isSmiSpan(node)) {
        const result = handleSmiSpan(node, state, options);
        newChildren.push(result);
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
  const { anchorMap, typeRefComponent, linkProps, lang } = options;
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
      isLinkableSpan(maybeNextSpan, lang)
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
    // CSS value: if inside a CSS property owner context, create a prop ref element.
    // Skip numeric values and CSS function calls (e.g., var(), calc(), rgb()).
    const cssOwner = lang.supportsCssSemantics ? currentOwner(state) : null;
    const nextAfterChain = children[chain.endIndex + 1];
    const isCssFunction = nextAfterChain?.type === 'text' && nextAfterChain.value.startsWith('(');
    if (
      cssOwner?.kind === 'css-property' &&
      linkProps &&
      !isCssFunction &&
      !/^\d+(\.\d+)?$/.test(identifier)
    ) {
      const propPathStr = propPathToString(cssOwner.propPath, identifier);
      const anchor = buildPropHref(cssOwner, propPathStr);
      const className = chain.spans.length === 1 ? getClassName(startNode) : undefined;
      const valueChildren: ElementContent[] =
        chain.spans.length === 1
          ? startNode.children
          : chain.spans.flatMap((span, k) =>
              k < chain.dotTexts.length ? [span, chain.dotTexts[k]] : [span],
            );
      nodes.push(
        createPropRefElement(
          anchor,
          valueChildren,
          cssOwner.name,
          propPathStr,
          false,
          className,
          options.typePropRefComponent,
        ),
      );
    } else {
      // No match: keep original nodes
      for (let k = chain.startIndex; k <= chain.endIndex; k += 1) {
        nodes.push(children[k]);
      }
    }
  }

  // Update state based on this entity (use full chain identifier, not just first span)
  updateStateForEntity(identifier, startNode, state, anchorMap, linkProps, options.linkScope, lang);

  return { nodes, nextIndex: chain.endIndex + 1 };
}

/**
 * Records a scope binding when a type annotation is found for a parameter or variable.
 */
function recordScopeBinding(
  typeName: string,
  state: ScanState,
  anchorMap: Record<string, string>,
): void {
  const href = anchorMap[typeName];
  if (!href) {
    return;
  }

  // Inside a function parameter context
  if (state.funcParamContext) {
    const ctx = state.funcParamContext;

    // Destructured param: { a, b }: TypeName → each gets a prop-ref binding.
    // Skip when a rename colon was detected — uncertain provenance (conservative).
    if (ctx.destructuredNames.length > 0) {
      if (!ctx.sawColonInDestructuring) {
        for (const name of ctx.destructuredNames) {
          ctx.pendingScopeBindings.set(name, {
            refKind: 'prop',
            href: `${href}:${name}`,
            ownerName: typeName,
            propPath: name,
          });
        }
      }
      ctx.destructuredNames = [];
      ctx.sawColonInDestructuring = false;
      ctx.lastParamName = null;
      return;
    }

    // Simple param: x: TypeName → upgrade to type-ref binding
    if (ctx.lastParamName) {
      ctx.pendingScopeBindings.set(ctx.lastParamName, {
        refKind: 'type',
        href,
        typeName,
      });
      ctx.lastParamName = null;
      return;
    }
    return;
  }

  // Variable declaration outside funcParamContext
  if (state.lastDeclaredVarName) {
    const binding: ScopeBinding = { refKind: 'type', href, typeName };
    const varName = state.lastDeclaredVarName;

    if (state.lastVarKeyword === 'var') {
      // var: add to nearest function scope (function-scoped)
      for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
        if (state.scopeStack[k].kind === 'function') {
          state.scopeStack[k].bindings.set(varName, binding);
          break;
        }
      }
    } else {
      // const/let: add to current (innermost) scope (block-scoped)
      const current = state.scopeStack[state.scopeStack.length - 1];
      if (current) {
        current.bindings.set(varName, binding);
      }
    }
    state.lastDeclaredVarName = null;
    state.lastVarKeyword = null;
  }
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
  linkScope: boolean | undefined,
  lang: LanguageCapabilities,
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

    // Record scope bindings when type annotation is found
    if (linkScope) {
      recordScopeBinding(text, state, anchorMap);
    }

    return;
  }

  // JSX opening: after "<", pl-c1 is the component name
  if (isC1 && state.sawJsxOpen && linkProps && lang.supportsJsx) {
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
    if (text === 'type' && lang.supportsTypes) {
      state.sawTypeKeyword = true;
      state.lastEntityName = null;
      return;
    }
    state.lastEntityName = text;
  }

  // CSS: track linked pl-c1 spans as potential CSS property owners
  if (
    lang.supportsCssSemantics &&
    isC1 &&
    currentOwner(state)?.kind !== 'css-property' &&
    text in anchorMap
  ) {
    state.pendingCssProperty = { name: text, anchorHref: anchorMap[text] };
  }

  // Track variable name for scope binding (const x, let x, var x)
  if (isC1 && linkScope && state.lastVarKeyword) {
    state.lastDeclaredVarName = text;
  }

  state.sawJsxOpen = false;
}

/**
 * Handles a property span (pl-v or pl-e).
 * If inside a func param context, wraps it as a param ref.
 * If inside an owner context, wraps it as a prop ref.
 */
function handlePropertySpan(
  node: Element,
  state: ScanState,
  options: EnhanceOptions,
): ElementContent {
  const { linkProps, linkParams, linkScope, typePropRefComponent, anchorMap } = options;

  // Function parameter context takes priority over owner context
  if (
    state.funcParamContext &&
    state.funcParamContext.nestedBracketDepth === 0 &&
    state.funcParamContext.nestedAngleDepth === 0 &&
    !state.funcParamContext.inDefaultValue
  ) {
    const paramName = getTextContent(node);
    const className = getClassName(node);

    // Record param name for scope binding when the type annotation fills
    if (linkScope) {
      state.funcParamContext.lastParamName = paramName;
    }

    // Only create param ref element when linkParams is enabled
    if (linkParams) {
      const anchor = buildParamHref(state.funcParamContext, paramName, anchorMap);
      return createParamRefElement(
        anchor,
        node.children,
        state.funcParamContext.ownerName,
        paramName,
        state.funcParamContext.isDefinition,
        className,
        options.typeParamRefComponent,
      );
    }

    // When only linkScope (not linkParams), return original node
    return node;
  }

  // Destructured parameter names (inside { }) — only flat depth-1 bindings
  if (
    state.funcParamContext &&
    linkScope &&
    state.funcParamContext.nestedBracketDepth === 1 &&
    state.funcParamContext.nestedAngleDepth === 0 &&
    !state.funcParamContext.inDefaultValue
  ) {
    const paramName = getTextContent(node);
    state.funcParamContext.destructuredNames.push(paramName);
  }

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
 * Handles an identifier reference span (pl-smi) by resolving it against the scope stack.
 * Returns a linked element if a binding is found, otherwise the original node.
 */
function handleSmiSpan(node: Element, state: ScanState, options: EnhanceOptions): ElementContent {
  const text = getTextContent(node);
  const className = getClassName(node);

  // Search scope stack innermost-to-outermost
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(text);
    if (binding) {
      switch (binding.refKind) {
        case 'type':
          return createLinkElement(
            binding.href,
            node.children,
            binding.typeName,
            className,
            options.typeRefComponent,
          );
        case 'prop':
          return createPropRefElement(
            binding.href,
            node.children,
            binding.ownerName,
            binding.propPath,
            false,
            className,
            options.typePropRefComponent,
          );
        case 'param':
          return createParamRefElement(
            binding.href,
            node.children,
            binding.paramOwnerName,
            binding.paramName,
            false,
            className,
            options.typeParamRefComponent,
          );
        default:
          break;
      }
    }
  }

  return node;
}

/**
 * Handles a keyword span (pl-k) by updating scan state.
 */
function handleKeywordSpan(node: Element, state: ScanState, lang: LanguageCapabilities): void {
  const text = getTextContent(node);

  switch (text) {
    case 'type':
      if (!lang.supportsTypes) {
        break;
      }
      state.sawTypeKeyword = true;
      state.lastEntityName = null;
      state.typeDefPersist = null;
      break;
    case 'function':
      if (!lang.supportsJsSemantics) {
        break;
      }
      state.sawFunctionKeyword = true;
      state.lastEntityName = null;
      break;
    case 'const':
    case 'let':
    case 'var':
      // Reset — next pl-en after ":" will be the type annotation
      state.sawTypeKeyword = false;
      state.lastEntityName = null;
      state.typeDefPersist = null;
      // Track for scope binding
      state.lastVarKeyword = text as 'const' | 'let' | 'var';
      state.lastDeclaredVarName = null;
      break;
    case '=>':
      // Arrow token after `)` confirms arrow function. Mark it so that a
      // subsequent `(` can be recognised as expression-body grouping.
      if (state.expectingFunctionBody) {
        state.sawArrowForBody = true;
      }
      break;
    case ':':
      // Inside destructuring braces, `:` indicates a rename pattern (e.g. { a: renamed })
      // — mark the group so recordScopeBinding skips these uncertain bindings
      if (state.funcParamContext && state.funcParamContext.nestedBracketDepth > 0) {
        state.funcParamContext.sawColonInDestructuring = true;
      }
      // If we have a lastEntityName pending (from a type annotation context),
      // prepare to capture the type name
      if (lang.supportsTypes && !state.sawTypeKeyword && !currentOwner(state)) {
        state.pendingAnnotationType = ''; // sentinel: next pl-en fills this
      }
      break;
    case '=':
      // Assignment operator ends the declaration's type-annotation window.
      // Any subsequent `:` is inside the initializer (ternary, object literal)
      // and must NOT bind back to the declared variable.
      if (state.lastDeclaredVarName && !state.funcParamContext) {
        state.lastDeclaredVarName = null;
        state.lastVarKeyword = null;
      }
      // After type annotation "const x: Type =", expect a brace
      if (state.pendingAnnotationType && state.pendingAnnotationType !== '') {
        state.expectingAnnotationBrace = true;
      }
      // After type keyword "type Name =", expect a brace
      if (state.pendingTypeDefName) {
        state.expectingTypeDefBrace = true;
      }
      // Inside a func param context, `=` at the top level starts a default value expression
      if (
        state.funcParamContext &&
        state.funcParamContext.parenDepth === 1 &&
        state.funcParamContext.nestedBracketDepth === 0 &&
        state.funcParamContext.nestedAngleDepth === 0
      ) {
        state.funcParamContext.inDefaultValue = true;
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
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'code') {
        return;
      }
      if (!node.children || node.children.length === 0) {
        return;
      }

      const lang = getLanguageCapabilities(node);
      let anchorMap: Record<string, string> = {};
      if (lang.supportsJsSemantics) {
        anchorMap = options.anchorMap.js ?? {};
      } else if (lang.supportsCssSemantics) {
        anchorMap = options.anchorMap.css ?? {};
      }
      const enhanceOptions: EnhanceOptions = {
        anchorMap,
        typeRefComponent: options.typeRefComponent,
        typePropRefComponent: options.typePropRefComponent,
        typeParamRefComponent: options.typeParamRefComponent,
        linkProps: options.linkProps,
        linkParams: options.linkParams,
        linkScope: options.linkScope,
        lang,
      };

      const state = createScanState();

      // Initialize top-level function scope for scope tracking
      if (options.linkScope) {
        state.scopeStack.push({ bindings: new Map(), kind: 'function' });
      }

      node.children = enhanceChildren(node.children, enhanceOptions, state);
    });
  };
}
