import type { Element, ElementContent } from 'hast';
import { toKebabCase } from '../loaderUtils/toKebabCase';

/**
 * A proven binding in a scope — links a variable name to its type origin.
 * Discriminated on `refKind` so that each variant carries exactly the
 * metadata needed to produce the correct link element.
 */
export type ScopeBinding =
  | { refKind: 'type'; href: string; typeName: string; declKind?: 'const' | 'let' | 'var' }
  | { refKind: 'prop'; href: string; ownerName: string; propPath: string }
  | { refKind: 'param'; href: string; paramOwnerName: string; paramName: string }
  | {
      refKind: 'value';
      value: string;
      varName: string;
      refs?: Record<string, string>;
      declKind?: 'const' | 'let' | 'var';
    }
  | {
      refKind: 'value-object';
      properties: Map<string, string>;
      varName: string;
      declKind?: 'const' | 'let' | 'var';
    }
  | { refKind: 'shadow' }
  | {
      refKind: 'module';
      href: string;
      defaultHref?: string;
      exports: Record<string, { slug: string; title?: string }>;
    };

/**
 * Entry in the moduleLinkMap configuration.
 */
export interface ModuleLinkMapEntry {
  /** The page URL for this module (e.g., '/docs-infra/pipeline/enhanceCodeTypes'). */
  href: string;
  /** Per-module override for the anchor slug used by default/namespace imports. */
  defaultSlug?: string;
  /** The kind of the default export, when known (e.g., 'function', 'class', 'object'). */
  defaultKind?: ResolvedExportKind;
  /**
   * Structured properties for the default export when `defaultKind` is `'object'`.
   * Keys are property names; values are the literal type strings (e.g., `"'.root'"`).
   */
  defaultProperties?: Record<string, string>;
  /** Maps exported names to their slug and optional title. */
  exports?: Record<
    string,
    {
      slug: string;
      title?: string;
      kind?: ResolvedExportKind;
      /**
       * Structured properties when `kind` is `'object'`.
       * Keys are property names; values are the literal type strings.
       */
      properties?: Record<string, string>;
    }
  >;
}

/**
 * Resolved import collected during the scan.
 * Used to build the `data-imports` attribute on the `<code>` element.
 */
export interface ResolvedImport {
  link: string;
  exports: Array<{ slug: string; title: string }>;
}

/**
 * Resolved export collected during the scan.
 * Used to build the `data-exports` attribute on the `<code>` element.
 */
export type ResolvedExportKind =
  | 'function'
  | 'const'
  | 'let'
  | 'var'
  | 'type'
  | 'interface'
  | 'class'
  | 'unknown'
  | 'enum'
  | 'object';

interface BaseResolvedExport {
  /** The exported name (or "default" for default exports) */
  name: string;
  /** The kind of export declaration */
  kind: ResolvedExportKind;
}

export interface ResolvedValueExport extends BaseResolvedExport {
  kind: Exclude<ResolvedExportKind, 'object'>;
  /** The type annotation or inferred literal type, when determinable */
  type?: string;
  /** The resolved href for the type, when available in the linkMap */
  typeHref?: string;
}

export interface ResolvedObjectExport extends BaseResolvedExport {
  kind: 'object';
  /** Structured key/value properties for object-shaped exports */
  properties: Record<string, string>;
}

export type ResolvedExport = ResolvedValueExport | ResolvedObjectExport;

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
  /** The anchor href from the linkMap for this owner */
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
   * Optional param-specific anchor href from the linkMap (e.g., linkMap["makeItem[0]"]).
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
    /** Base anchor href from the linkMap */
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
  /** Set after seeing pl-k("import") keyword — JS import statement in progress */
  sawJsImportKeyword: boolean;
  /** Collected named import identifiers: { localName, exportedName } */
  pendingImportNames: Array<{ localName: string; exportedName: string }>;
  /** Default import name (before `{` or `from`) */
  pendingDefaultImport: string | null;
  /** Namespace import name (`import * as X`) */
  pendingNamespaceImport: string | null;
  /** True when `as` keyword seen inside import — next pl-c1 is alias */
  importSawAs: boolean;
  /** Set after seeing `from` keyword while import is active */
  sawFromKeyword: boolean;
  /** True when inside the `{ }` block of a named import */
  inImportBraces: boolean;
  /** True when `*` was seen in import context (namespace import) */
  importSawStar: boolean;
  /** Paren depth tracking for dynamic `import()` expressions */
  dynamicImportDepth: number;
  /**
   * Deferred link for a dynamic import string. Set when a string literal
   * is seen inside `import(...)` and finalized only when `)` closes the
   * expression with no other content. Cleared if computed content is detected.
   */
  pendingDynamicImportLink: {
    node: Element;
    href: string;
    rawValue: string;
  } | null;
  /**
   * Deferred `data-import` annotation for a dynamic import string that didn't
   * match `moduleLinkMap`. Applied only at finalization when the expression is
   * confirmed non-computed. Cleared if computed content is detected.
   */
  pendingDynamicImportAnnotation: {
    node: Element;
    rawValue: string;
  } | null;
  /** True when non-string content is detected inside `import(...)`, preventing link creation */
  dynamicImportIsComputed: boolean;
  /** Set after seeing CSS `@import` keyword — CSS import statement in progress */
  sawCssImportKeyword: boolean;
  /** Resolved imports collected during the scan, keyed by module specifier */
  resolvedImports: Map<string, ResolvedImport>;
  /** Unresolved module specifiers that didn't match moduleLinkMap */
  unresolvedImports: Set<string>;
  /** Set after seeing pl-k("export") keyword — JS export statement in progress */
  sawExportKeyword: boolean;
  /** Set after seeing pl-k("default") following an export keyword */
  sawExportDefaultKeyword: boolean;
  /** The export kind keyword seen after `export` (e.g., "function", "const", "type") */
  pendingExportKind: ResolvedExport['kind'] | null;
  /** The export keyword node, for adding `id` attribute once the export name is known */
  pendingExportKeywordNode: Element | null;
  /** Collected export names for `export { a, b as c }` */
  pendingExportNames: Array<{ localName: string; exportedName: string; node: Element }>;
  /** True when inside the `{ }` block of a named export */
  inExportBraces: boolean;
  /** True when `as` keyword seen inside export — next identifier is the external name */
  exportSawAs: boolean;
  /** Resolved exports collected during the scan */
  resolvedExports: ResolvedExport[];
  /** Bare CSS class selectors collected for CSS Modules-style default export objects */
  cssModuleExports: Map<string, string>;
  /** Index into resolvedExports of the last recorded variable export awaiting type resolution */
  pendingExportTypeIndex: number | null;
  /** Index into resolvedExports of the last recorded variable export awaiting kind refinement (e.g. arrow → function) */
  pendingExportKindIndex: number | null;
  /** Tracks parenthesis nesting depth since pendingExportKindIndex was set.
   *  Only an `=>` at depth 0 should refine the export kind — arrows inside
   *  function calls (depth > 0) belong to nested expressions. */
  exportKindParenDepth: number;
  /** For multi-declarator exports (`export const a = 1, b = 2`), remembers the
   *  declaration keyword so the second declarator can be re-armed on `,`. */
  pendingMultiDeclKind: 'const' | 'let' | 'var' | null;
  /** Nesting depth for `()`, `[]`, `{}` while inside a multi-declarator export.
   *  Only a `,` at depth 0 separates declarators. */
  multiDeclNestingDepth: number;
  /** Recently-recorded export list entries awaiting `from 'module'` enrichment.
   *  Populated at the closing `}` of `export { ... }` so the module string
   *  handler can look up each entry against moduleLinkMap and set typeHref. */
  pendingReExportEntries: Array<{ localName: string; index: number }>;
  /** True when `export *` was recorded and awaits `from 'module'` handling. */
  pendingStarReExport: boolean;
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
    sawJsImportKeyword: false,
    pendingImportNames: [],
    pendingDefaultImport: null,
    pendingNamespaceImport: null,
    importSawAs: false,
    sawFromKeyword: false,
    inImportBraces: false,
    importSawStar: false,
    dynamicImportDepth: 0,
    pendingDynamicImportLink: null,
    pendingDynamicImportAnnotation: null,
    dynamicImportIsComputed: false,
    sawCssImportKeyword: false,
    resolvedImports: new Map(),
    unresolvedImports: new Set(),
    sawExportKeyword: false,
    sawExportDefaultKeyword: false,
    pendingExportKind: null,
    pendingExportKeywordNode: null,
    pendingExportNames: [],
    inExportBraces: false,
    exportSawAs: false,
    resolvedExports: [],
    cssModuleExports: new Map(),
    pendingExportTypeIndex: null,
    pendingExportKindIndex: null,
    exportKindParenDepth: 0,
    pendingMultiDeclKind: null,
    multiDeclNestingDepth: 0,
    pendingReExportEntries: [],
    pendingStarReExport: false,
  };
}

/**
 * Looks up an owner name in the linkMap.
 */
export function lookupOwner(
  name: string,
  linkMap: Record<string, string>,
): { ownerName: string; anchorHref: string } | null {
  if (name in linkMap) {
    return { ownerName: name, anchorHref: linkMap[name] };
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
    // Build the key as Owner:props:propPath to match the linkMap convention.
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
 * At **definition sites** (type defs), checks `linkMap["Owner[N]"]` for a named
 * anchor, then falls back to the positional format `#anchor[N]`.
 *
 * At **reference sites**, resolves through `linkMap["OwnerKey[N]"]` named anchors,
 * or falls back to `#anchor[N]`.
 */
export function buildParamHref(
  ctx: NonNullable<ScanState['funcParamContext']>,
  paramName: string,
  linkMap: Record<string, string>,
): string {
  const basePath = ctx.basePropPath.length > 0 ? ctx.basePropPath.map(toKebabCase).join('.') : null;

  if (ctx.isDefinition) {
    // Definition site: check for a named anchor in the linkMap first,
    // then fall back to positional format so reference sites can link without a map entry
    const paramKey = basePath
      ? `${ctx.ownerName}:${basePath}[${ctx.paramIndex}]`
      : `${ctx.ownerName}[${ctx.paramIndex}]`;
    const namedAnchor = linkMap[paramKey];
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
  const namedAnchor = linkMap[paramKey];
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
      declKind: 'const',
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
/**
 * Clears all JS import-related parsing state.
 * Used after an import statement is fully consumed, or when we discover the
 * `import` keyword was not actually an import statement (e.g. `import.meta`).
 */
export function resetImportState(state: ScanState): void {
  state.sawJsImportKeyword = false;
  state.pendingImportNames = [];
  state.pendingDefaultImport = null;
  state.pendingNamespaceImport = null;
  state.importSawAs = false;
  state.sawFromKeyword = false;
  state.inImportBraces = false;
  state.importSawStar = false;
}

/**
 * Clears all JS export-related parsing state.
 * Used after an export statement is fully consumed.
 */
export function resetExportState(state: ScanState): void {
  state.sawExportKeyword = false;
  state.sawExportDefaultKeyword = false;
  state.pendingExportKind = null;
  state.pendingExportKeywordNode = null;
  state.pendingExportNames = [];
  state.inExportBraces = false;
  state.exportSawAs = false;
  state.pendingMultiDeclKind = null;
}

/**
 * Finalizes an in-progress `export default ...` statement that has reached a
 * statement boundary before a named declaration identifier was seen.
 */
export function finalizePendingDefaultExport(state: ScanState): boolean {
  if (!state.sawExportKeyword || !state.sawExportDefaultKeyword) {
    return false;
  }

  recordExport(
    state,
    'default',
    (state.pendingExportKind ?? 'unknown') as ResolvedValueExport['kind'],
  );
  resetExportState(state);
  return true;
}

/**
 * Records a resolved export and sets the `id` attribute on the export keyword node.
 */
export function recordExport(
  state: ScanState,
  name: string,
  kind: ResolvedValueExport['kind'],
): number {
  const index = state.resolvedExports.length;
  state.resolvedExports.push({ name, kind });
  if (state.pendingExportKeywordNode) {
    state.pendingExportKeywordNode.properties.id = name;
  }
  return index;
}

export function getResolvedValueExportAt(
  state: ScanState,
  index: number | null,
): ResolvedValueExport | null {
  if (index === null) {
    return null;
  }

  const entry = state.resolvedExports[index];
  if (!entry || entry.kind === 'object') {
    return null;
  }

  return entry;
}

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
    declKind: 'const',
  };
  const current = state.scopeStack[state.scopeStack.length - 1];
  if (current) {
    current.bindings.set(varName, binding);
  }
  state.pendingArrayValue = null;
}
