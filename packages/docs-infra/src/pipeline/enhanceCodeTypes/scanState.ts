import type { ElementContent } from 'hast';
import { toKebabCase } from '../loaderUtils/toKebabCase';

/**
 * A proven binding in a scope — links a variable name to its type origin.
 * Discriminated on `refKind` so that each variant carries exactly the
 * metadata needed to produce the correct link element.
 */
export type ScopeBinding =
  | { refKind: 'type'; href: string; typeName: string }
  | { refKind: 'prop'; href: string; ownerName: string; propPath: string }
  | { refKind: 'param'; href: string; paramOwnerName: string; paramName: string }
  | { refKind: 'value'; value: string; varName: string; refs?: Record<string, string> }
  | { refKind: 'value-object'; properties: Map<string, string>; varName: string };

/**
 * A single lexical scope in the scope stack.
 * - `'function'`: function body scope (holds `var` bindings and params)
 * - `'block'`: block scope (holds `let`/`const` bindings)
 */
export interface Scope {
  bindings: Map<string, ScopeBinding>;
  kind: 'function' | 'block';
}

/**
 * Owner context for property linking.
 * Tracks which type/function/component owns the current block of properties.
 */
export interface OwnerContext {
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
export interface ScanState {
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
   * Variable name preserved after `=` so that value capture (string literals,
   * object literals, array literals) can bind back to the declared variable.
   * Only set for `const` declarations (mutable variables are unreliable).
   */
  pendingValueVar: string | null;
  /**
   * Active object literal value collection. Set when `{` follows a `const x =`
   * declaration. Collects top-level property name→value pairs and flushes
   * a `'value-object'` scope binding on `}`.
   */
  pendingObjectValue: {
    varName: string;
    properties: Map<string, string>;
    currentPropName: string | null;
    /** Tentative key from a span-tokenized identifier, awaiting `:` confirmation. */
    pendingSpanKey: string | null;
    braceDepth: number;
    /** True when a shorthand property (no `:` value) was seen — the shape is incomplete. */
    hasUnresolvedKeys: boolean;
  } | null;
  /**
   * Deferred literal candidate for const value binding.
   * Instead of eagerly recording a value binding when we see a literal after
   * `const x =`, we store the candidate here. It is flushed (committed) at
   * the next `;` statement boundary, and invalidated if an operator or
   * non-evaluable expression token appears after the literal.
   */
  pendingLiteralCandidate: {
    varName: string;
    value: string;
    /** Index in newChildren where this literal node was pushed. Set by enhanceChildren. */
    startChildIndex: number;
    /** The child array where this literal node was pushed. */
    targetChildren: ElementContent[] | null;
  } | null;
  /**
   * True when a newline was seen while pendingExpression looked syntactically
   * complete (last token is not an operator). The next non-whitespace token
   * decides the outcome: `.`, `[`, or `(` invalidates the expression
   * (continuation syntax), while a syntax span or `;` commits it.
   */
  expressionNewlineReady: boolean;
  /**
   * Active compound expression accumulator. Promoted from pendingLiteralCandidate
   * when an evaluable operator (`+`, `-`, `*`, `/`) appears after a literal.
   * Tokens are accumulated and evaluated at `;` or ASI boundaries.
   */
  pendingExpression: {
    varName: string;
    tokens: Array<{
      kind: 'number' | 'string' | 'operator' | 'variable';
      value: string;
      /** For `variable` tokens with a type/prop/param binding, the anchor href. */
      ref?: string;
    }>;
    /** Index into newChildren where the expression value nodes begin (for wrapping). */
    startChildIndex: number;
    /** The child array where the expression definition nodes were collected. */
    targetChildren: ElementContent[] | null;
    /**
     * Index into the child array where the expression value nodes end (exclusive).
     * Set when a non-expression element (e.g. comment span) follows the last
     * expression token. When unset (-1), wrapping extends to the end of the array.
     */
    endChildIndex: number;
  } | null;
  /**
   * Result of the last flushed compound expression. Set by flushPendingExpression
   * so enhanceChildren can wrap the expression nodes in a value-ref element.
   * Consumed (cleared) by enhanceChildren after wrapping.
   */
  lastFlushedExpression: {
    value: string;
    varName: string;
    startChildIndex: number;
    endChildIndex: number;
    refs?: Record<string, string>;
    targetChildren: ElementContent[] | null;
  } | null;
  /**
   * Active array literal value collection. Set when `[` follows a `const x =`
   * declaration. Collects element values (literals and resolved variable
   * references) and flushes a `'value'` scope binding on `]`.
   */
  pendingArrayValue: {
    varName: string;
    elements: string[];
    bracketDepth: number;
    /** True when a `...` spread was just seen — the next identifier will be resolved and inlined. */
    pendingSpread: boolean;
  } | null;
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
export function createScanState(): ScanState {
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
    pendingValueVar: null,
    pendingLiteralCandidate: null,
    expressionNewlineReady: false,
    pendingExpression: null,
    lastFlushedExpression: null,
    pendingObjectValue: null,
    pendingArrayValue: null,
  };
}

/**
 * Looks up an owner name in the anchorMap.
 */
export function lookupOwner(
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
export function currentOwner(state: ScanState): OwnerContext | null {
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
export function buildPropHref(owner: OwnerContext, propPathStr: string): string {
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
export function buildParamOwnerKey(owner: OwnerContext, propPath: string[]): string {
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
export function buildParamHref(
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
 * Records a value-object binding for the current pendingObjectValue in the scope stack.
 * Clears pendingObjectValue after flushing.
 */
export function recordObjectValueBinding(state: ScanState): void {
  if (!state.pendingObjectValue) {
    return;
  }
  const { varName, properties } = state.pendingObjectValue;
  // Only record when at least one key: value pair was tracked.
  // Shorthand properties ({ a }) don't produce key: value entries,
  // so an empty map means the shape is uncertain — skip the binding.
  if (properties.size > 0 && !state.pendingObjectValue.hasUnresolvedKeys) {
    const binding: ScopeBinding = {
      refKind: 'value-object',
      properties,
      varName,
    };
    const current = state.scopeStack[state.scopeStack.length - 1];
    if (current) {
      current.bindings.set(varName, binding);
    }
  }
  state.pendingObjectValue = null;
}

/**
 * Records a value binding for the current pendingArrayValue in the scope stack.
 * Formats the elements as `[elem1, elem2, ...]` and clears pendingArrayValue.
 */
export function recordArrayValueBinding(state: ScanState): void {
  if (!state.pendingArrayValue) {
    return;
  }
  const { varName, elements } = state.pendingArrayValue;
  const value = `[${elements.join(', ')}]`;
  const binding: ScopeBinding = {
    refKind: 'value',
    value,
    varName,
  };
  const current = state.scopeStack[state.scopeStack.length - 1];
  if (current) {
    current.bindings.set(varName, binding);
  }
  state.pendingArrayValue = null;
}
