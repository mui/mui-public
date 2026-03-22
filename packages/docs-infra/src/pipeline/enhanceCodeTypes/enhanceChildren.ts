import type { Element, ElementContent, Text } from 'hast';
import type { LanguageCapabilities } from './getLanguageCapabilities';
import type { ScanState, ScopeBinding, ModuleLinkMapEntry } from './scanState';
import {
  isLinkableSpan,
  isPropertySpan,
  isKeywordSpan,
  isCommentSpan,
  isSmiSpan,
  isStringLiteralSpan,
  getTextContent,
  getClassName,
  propPathToString,
} from './hastUtils';
import {
  createLinkElement,
  createPropRefElement,
  createParamRefElement,
  createValueRefElement,
} from './createElements';
import { currentOwner, buildPropHref, buildParamHref, resetImportState } from './scanState';
import {
  flushLiteralCandidate,
  flushPendingExpression,
  processTextNode,
  tokenFromLiteral,
} from './processTextNode';

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
 * Options passed to enhanceChildren for cleaner signatures.
 */
export interface EnhanceOptions {
  linkMap: Record<string, string>;
  typeRefComponent?: string;
  typePropRefComponent?: string;
  typeParamRefComponent?: string;
  typeValueRefComponent?: string;
  linkProps?: 'shallow' | 'deep';
  linkParams?: boolean;
  linkScope?: boolean;
  linkValues?: boolean;
  linkArrays?: boolean;
  moduleLinkMap?: Record<string, ModuleLinkMapEntry>;
  defaultImportSlug?: string;
  lang: LanguageCapabilities;
}

/**
 * Builds the full identifier string from a chain.
 */
function chainToIdentifier(chain: LinkableChain): string {
  return chain.spans.map(getTextContent).join('.');
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
export function enhanceChildren(
  children: ElementContent[],
  options: EnhanceOptions,
  state: ScanState,
): ElementContent[] {
  const {
    linkMap,
    typePropRefComponent,
    linkProps,
    linkParams,
    linkScope,
    linkValues,
    linkArrays,
    lang,
    moduleLinkMap,
  } = options;
  const newChildren: ElementContent[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    // --- Text node: process for brace tracking and plain text properties ---
    if (node.type === 'text') {
      const processed = processTextNode(
        node.value,
        state,
        linkMap,
        linkProps,
        linkParams,
        linkScope,
        linkValues,
        linkArrays,
        typePropRefComponent,
        lang,
        children,
        i,
      );
      newChildren.push(...processed);

      // Finalize deferred dynamic import link/annotation when `)` just closed the expression
      if (state.dynamicImportDepth === 0) {
        if (state.pendingDynamicImportLink) {
          const { node: linkNode, href, rawValue } = state.pendingDynamicImportLink;
          const originalChildren = [...linkNode.children];
          linkNode.children = [createLinkElement(href, originalChildren, rawValue)];
          if (options.moduleLinkMap) {
            const moduleEntry = options.moduleLinkMap[rawValue];
            if (moduleEntry) {
              recordResolvedImport(state, rawValue, moduleEntry, []);
            }
          }
          state.pendingDynamicImportLink = null;
        } else if (state.pendingDynamicImportAnnotation) {
          const { node: annoNode, rawValue } = state.pendingDynamicImportAnnotation;
          annoNode.properties['data-import'] = rawValue;
          state.unresolvedImports.add(rawValue);
          state.pendingDynamicImportAnnotation = null;
        }
      }

      // Wrap expression nodes if an expression was just evaluated at `;`
      if (state.lastFlushedExpression) {
        wrapExpressionNodes(newChildren, state, options);
      }

      i += 1;
      continue;
    }

    // --- Element node ---
    if (node.type === 'element') {
      // Mark dynamic import as computed when a non-string element appears
      // inside `import(...)`. This prevents linking in computed expressions
      // like `import(cond ? '@foo' : '@bar')` or `import('@foo' + bar)`.
      if (state.dynamicImportDepth > 0 && !isStringLiteralSpan(node)) {
        state.dynamicImportIsComputed = true;
        state.pendingDynamicImportLink = null;
        state.pendingDynamicImportAnnotation = null;
      }

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

      // Flush (commit) any pending literal candidate when a recognized
      // syntax span (identifier, reference, or string literal) appears that
      // is not a keyword or property.  If the expression were compound
      // (e.g. `42 + foo`), the operator in the intervening text node would
      // have already cleared the candidate.  A surviving candidate here
      // means the literal was a complete initializer and this span starts
      // a new statement (ASI boundary).
      // Structural wrapper elements (e.g. <span class="line">) are ignored
      // so they don't prematurely commit candidates across line boundaries.
      if (state.pendingLiteralCandidate && !isKeywordSpan(node) && !isPropertySpan(node)) {
        const isSyntaxSpan =
          isLinkableSpan(node, lang) || isSmiSpan(node) || isStringLiteralSpan(node);
        if (isSyntaxSpan) {
          if (linkScope) {
            flushLiteralCandidate(state);
          } else {
            state.pendingLiteralCandidate = null;
          }
        }
      }

      // Flush a pending expression that was marked as complete at a newline
      // (ASI boundary). The deferred approach lets next-line continuation
      // syntax (`.`, `[`, `(`) invalidate the expression in processTextNode
      // before we commit here.
      if (
        state.expressionNewlineReady &&
        state.pendingExpression &&
        linkScope &&
        !isKeywordSpan(node) &&
        !isPropertySpan(node)
      ) {
        const isSyntaxSpan =
          isLinkableSpan(node, lang) || isSmiSpan(node) || isStringLiteralSpan(node);
        if (isSyntaxSpan) {
          flushLiteralCandidate(state);
          const exprResult = flushPendingExpression(state);
          if (exprResult) {
            state.lastFlushedExpression = exprResult;
          }
          state.expressionNewlineReady = false;
          wrapExpressionNodes(newChildren, state, options);
        }
      }

      // Track span-tokenized object keys: when inside a pending object literal
      // at depth 1, any identifier-class span could be a property key.  Store
      // its text tentatively; the next text node will confirm (`:`) or discard.
      if (
        state.pendingObjectValue &&
        state.pendingObjectValue.braceDepth === 1 &&
        !state.pendingObjectValue.currentPropName
      ) {
        const isIdentifierSpan =
          isLinkableSpan(node, lang) || isPropertySpan(node) || isSmiSpan(node);
        if (isIdentifierSpan) {
          state.pendingObjectValue.pendingSpanKey = getTextContent(node);
        }
      }

      // Linkable span (pl-c1, pl-en; also pl-v, pl-e in CSS): handle chains + state updates
      if (isLinkableSpan(node, lang)) {
        const hadCandidate = state.pendingLiteralCandidate !== null;
        const result = handleLinkableSpan(children, i, options, state);
        newChildren.push(...result.nodes);
        // Stamp startChildIndex when a new literal candidate was just created
        if (!hadCandidate && state.pendingLiteralCandidate?.startChildIndex === -1) {
          state.pendingLiteralCandidate.startChildIndex = newChildren.length - 1;
          state.pendingLiteralCandidate.targetChildren = newChildren;
        }
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
        handleKeywordSpan(node, state, options);
        newChildren.push(node);
        i += 1;
        continue;
      }

      // String literal span (pl-s): capture value for const tracking
      if (isStringLiteralSpan(node)) {
        const hadCandidate = state.pendingLiteralCandidate !== null;
        const hadExpression = state.pendingExpression !== null;
        handleStringLiteralSpan(node, state, options);
        newChildren.push(node);
        // Stamp startChildIndex when a new literal candidate was just created
        if (!hadCandidate && state.pendingLiteralCandidate?.startChildIndex === -1) {
          state.pendingLiteralCandidate.startChildIndex = newChildren.length - 1;
          state.pendingLiteralCandidate.targetChildren = newChildren;
        }
        // Stamp startChildIndex when a template literal created a new pendingExpression
        if (!hadExpression && state.pendingExpression?.startChildIndex === -1) {
          state.pendingExpression.startChildIndex = newChildren.length - 1;
          state.pendingExpression.targetChildren = newChildren;
        }
        i += 1;
        continue;
      }

      // Comment span (pl-c): pass through without processing text content.
      // Comments may contain operator-like characters (e.g. `//`) that would
      // incorrectly interact with expression tracking if recursively processed.
      if (isCommentSpan(node)) {
        const commentText = getTextContent(node);
        const isLineComment = commentText.startsWith('//');
        if (
          isLineComment &&
          state.pendingExpression &&
          state.pendingExpression.endChildIndex === -1
        ) {
          state.pendingExpression.endChildIndex = newChildren.length;
        }
        newChildren.push(node);
        i += 1;
        continue;
      }

      // Import identifier collection: pl-smi spans inside an import statement
      // are imported names (Starry Night tokenizes them as pl-smi, not pl-c1).
      if (moduleLinkMap && isSmiSpan(node) && state.sawJsImportKeyword) {
        collectImportIdentifier(getTextContent(node), state);
        newChildren.push(node);
        i += 1;
        continue;
      }

      // Identifier reference span (pl-smi): resolve against scope stack
      if ((linkScope || moduleLinkMap) && isSmiSpan(node)) {
        const hadCandidate = state.pendingLiteralCandidate !== null;
        const result = handleSmiSpan(node, children, i, state, options);
        newChildren.push(...result.nodes);
        // Stamp startChildIndex when a new literal candidate was just created from a variable
        if (!hadCandidate && state.pendingLiteralCandidate?.startChildIndex === -1) {
          state.pendingLiteralCandidate.startChildIndex = newChildren.length - 1;
          state.pendingLiteralCandidate.targetChildren = newChildren;
        }
        i = result.nextIndex;
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
 * Collects an import identifier name into the scan state.
 * Called for identifier spans (pl-smi, pl-c1) inside an `import` statement.
 */
function collectImportIdentifier(text: string, state: ScanState): void {
  if (state.importSawAs) {
    // `as X` — alias the previously collected name
    if (state.importSawStar) {
      // `import * as X` — namespace import
      state.pendingNamespaceImport = text;
    } else if (state.inImportBraces && state.pendingImportNames.length > 0) {
      // `import { foo as X }` — alias the last named import
      state.pendingImportNames[state.pendingImportNames.length - 1].localName = text;
    } else if (state.pendingDefaultImport) {
      // Edge case: `import default as X` — unlikely but handle
      state.pendingDefaultImport = text;
    }
    state.importSawAs = false;
  } else if (state.inImportBraces) {
    // Inside `{ }` — named import
    state.pendingImportNames.push({ localName: text, exportedName: text });
  } else if (state.importSawStar) {
    // After `* as` — this shouldn't happen (handled by `as` branch above)
    state.pendingNamespaceImport = text;
    state.importSawStar = false;
  } else {
    // Before `{` or `from` — default import
    state.pendingDefaultImport = text;
  }
}

/**
 * Resolves a type reference href by checking the user-provided linkMap first,
 * then falling back to scope-tracked type bindings (e.g., from imports).
 */
function resolveTypeHref(
  identifier: string,
  linkMap: Record<string, string>,
  state: ScanState,
): string | undefined {
  const href = linkMap[identifier];
  if (href) {
    return href;
  }
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(identifier);
    if (binding) {
      return binding.refKind === 'type' ? binding.href : undefined;
    }
  }
  return undefined;
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
  const { linkMap, typeRefComponent, linkProps, lang } = options;
  const startNode = children[startIndex] as Element;

  // CSS @import context: spans like `url` should not be linked or tracked.
  if (state.sawCssImportKeyword) {
    return { nodes: [startNode], nextIndex: startIndex + 1 };
  }

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

  // Variable declarations: when a `const`/`let`/`var` re-declares a name
  // that already has a scope binding (e.g., from an import), replace it
  // with a shadow binding before resolving. This prevents the declaration
  // site itself from being linked, and blocks later usage from inheriting
  // the previous binding when no type annotation provides new provenance.
  // If a type annotation follows, recordScopeBinding overwrites the shadow.
  const isVarDecl =
    state.lastVarKeyword && chain.spans.length === 1 && getClassName(startNode)?.includes('pl-c1');
  if (isVarDecl && state.scopeStack.length > 0) {
    for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
      if (state.scopeStack[k].bindings.has(identifier)) {
        const targetScope =
          state.lastVarKeyword === 'var'
            ? (state.scopeStack.find((s) => s.kind === 'function') ?? state.scopeStack[0])
            : state.scopeStack[state.scopeStack.length - 1];
        targetScope.bindings.set(identifier, { refKind: 'shadow' });
        break;
      }
    }
  }

  const href = resolveTypeHref(identifier, linkMap, state);
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
    const cssOwner = lang.semantics === 'css' ? currentOwner(state) : null;
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
  updateStateForEntity(
    identifier,
    startNode,
    state,
    linkMap,
    linkProps,
    options.linkScope,
    options.linkValues,
    lang,
  );

  return { nodes, nextIndex: chain.endIndex + 1 };
}

/**
 * Records a scope binding when a type annotation is found for a parameter or variable.
 */
function recordScopeBinding(
  typeName: string,
  state: ScanState,
  linkMap: Record<string, string>,
): void {
  const href = resolveTypeHref(typeName, linkMap, state);
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
  linkMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
  linkScope: boolean | undefined,
  linkValues: boolean | undefined,
  lang: LanguageCapabilities,
): void {
  const className = getClassName(element);
  const isEn = className?.includes('pl-en');
  const isC1 = className?.includes('pl-c1');

  // Import identifier collection: when inside an import statement,
  // identifier spans are imported names — collect them and skip other processing.
  // Starry Night tokenizes import identifiers as pl-smi; pl-c1 is kept as a
  // fallback for robustness.
  if ((isC1 || className?.includes('pl-smi')) && state.sawJsImportKeyword) {
    collectImportIdentifier(text, state);
    return;
  }

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
      recordScopeBinding(text, state, linkMap);
    }

    return;
  }

  // JSX opening: after "<", pl-c1 is the component name
  if (isC1 && state.sawJsxOpen && linkProps && lang.supportsJsx) {
    const href = resolveTypeHref(text, linkMap, state);
    if (href) {
      const paramKey = `${text}[0]`;
      const paramAnchorHref = linkMap[paramKey] ?? null;
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

    // A pl-en entity after `=` means the initializer is a call/expression,
    // not a simple literal. Clear pendingValueVar to avoid false captures.
    if (state.pendingValueVar && !state.pendingObjectValue && !state.pendingArrayValue) {
      state.pendingValueVar = null;
    }
  }

  // CSS: track linked pl-c1 spans as potential CSS property owners
  if (
    lang.semantics === 'css' &&
    isC1 &&
    !state.sawCssImportKeyword &&
    currentOwner(state)?.kind !== 'css-property' &&
    text in linkMap
  ) {
    state.pendingCssProperty = { name: text, anchorHref: linkMap[text] };
  }

  // Track variable name for scope binding (const x, let x, var x)
  if (isC1 && linkScope && state.lastVarKeyword) {
    state.lastDeclaredVarName = text;
  }

  // Capture number/boolean literals for const value tracking.
  // pl-c1 is used for both identifiers (myVar) and literals (42, true, false, null).
  // We capture when inside an active array/object, or when pendingValueVar is set
  // AND linkValues is enabled (so linkArrays alone doesn't trigger scalar annotation).
  if (
    isC1 &&
    (state.pendingArrayValue ||
      state.pendingObjectValue ||
      state.pendingExpression ||
      (state.pendingValueVar && linkValues))
  ) {
    if (/^\d/.test(text) || text === 'true' || text === 'false' || text === 'null') {
      if (state.pendingArrayValue) {
        state.pendingArrayValue.elements.push(text);
      } else if (
        state.pendingObjectValue &&
        state.pendingObjectValue.braceDepth === 1 &&
        state.pendingObjectValue.currentPropName
      ) {
        state.pendingObjectValue.properties.set(state.pendingObjectValue.currentPropName, text);
        state.pendingObjectValue.currentPropName = null;
      } else if (state.pendingExpression) {
        state.pendingExpression.tokens.push({ kind: 'number', value: text });
      } else if (state.pendingValueVar) {
        // Defer value binding — store as a candidate rather than committing
        // immediately, so that compound expressions like `42 + 1` are invalidated.
        state.pendingLiteralCandidate = {
          varName: state.pendingValueVar,
          value: text,
          startChildIndex: -1,
          targetChildren: null,
        };
        state.pendingValueVar = null;
      }
    } else if (state.pendingArrayValue) {
      // Variable reference inside an array literal — resolve from scope
      if (state.pendingArrayValue.pendingSpread) {
        resolveSpreadIntoArray(state, text);
      } else {
        const resolved = resolveFromScope(state, text);
        state.pendingArrayValue.elements.push(resolved ?? text);
      }
    } else if (state.pendingValueVar) {
      // pl-c1 identifier (not a literal) after `=` means the initializer is a
      // variable reference or complex expression — not a direct literal value.
      state.pendingValueVar = null;
    }
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
  const { linkProps, linkParams, linkScope, typePropRefComponent, linkMap } = options;

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
      const anchor = buildParamHref(state.funcParamContext, paramName, linkMap);
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
 * Returns linked element(s) if a binding is found, otherwise the original node.
 *
 * For `value-object` bindings, performs dot-access lookahead: if the next siblings
 * are a "." text + a pl-smi/pl-c1 span matching a property, those siblings are
 * consumed and a single value ref element is produced for the resolved property value.
 */
function handleSmiSpan(
  node: Element,
  siblings: ElementContent[],
  index: number,
  state: ScanState,
  options: EnhanceOptions,
): { nodes: ElementContent[]; nextIndex: number } {
  const text = getTextContent(node);
  const className = getClassName(node);

  // Variable reference inside a pendingArrayValue — resolve and push
  if (state.pendingArrayValue) {
    if (state.pendingArrayValue.pendingSpread) {
      resolveSpreadIntoArray(state, text);
    } else {
      const resolved = resolveFromScope(state, text);
      state.pendingArrayValue.elements.push(resolved ?? text);
    }
    return { nodes: [node], nextIndex: index + 1 };
  }

  // Variable reference inside a pendingExpression — resolve and push as token
  if (state.pendingExpression) {
    const resolved = resolveFromScope(state, text, true);
    if (resolved) {
      state.pendingExpression.tokens.push(tokenFromLiteral(resolved));
    } else if (hasObjectOrArrayBinding(state, text)) {
      // Object/array bindings cannot participate in expressions — invalidate
      state.pendingExpression = null;
    } else {
      // Value not resolvable — check for a type/prop/param binding whose ref
      // we can carry through partial expression evaluation.
      const ref = resolveRefFromScope(state, text) ?? undefined;
      // Keep as a variable token for partial evaluation (string context).
      // If the expression turns out to be pure numeric with variables,
      // evaluateExpression will return null.
      state.pendingExpression.tokens.push({ kind: 'variable', value: text, ref });
    }
    return { nodes: [node], nextIndex: index + 1 };
  }

  // When pendingValueVar is set and this smi resolves to a tracked value,
  // seed a pendingLiteralCandidate so that a subsequent operator can promote
  // it to a pendingExpression (e.g. `const b = a + 5` where `a` is tracked).
  // Array-shaped values are excluded — they cannot participate in expressions.
  if (state.pendingValueVar && options.linkValues) {
    for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
      const binding = state.scopeStack[k].bindings.get(text);
      if (binding && binding.refKind === 'value' && !binding.value.startsWith('[')) {
        state.pendingLiteralCandidate = {
          varName: state.pendingValueVar,
          value: binding.value,
          startChildIndex: -1,
          targetChildren: null,
        };
        state.pendingValueVar = null;
        return { nodes: [node], nextIndex: index + 1 };
      }
    }
  }

  // Search scope stack innermost-to-outermost
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(text);
    if (binding) {
      switch (binding.refKind) {
        case 'type':
          return {
            nodes: [
              createLinkElement(
                binding.href,
                node.children,
                binding.typeName,
                className,
                options.typeRefComponent,
              ),
            ],
            nextIndex: index + 1,
          };
        case 'prop':
          return {
            nodes: [
              createPropRefElement(
                binding.href,
                node.children,
                binding.ownerName,
                binding.propPath,
                false,
                className,
                options.typePropRefComponent,
              ),
            ],
            nextIndex: index + 1,
          };
        case 'param':
          return {
            nodes: [
              createParamRefElement(
                binding.href,
                node.children,
                binding.paramOwnerName,
                binding.paramName,
                false,
                className,
                options.typeParamRefComponent,
              ),
            ],
            nextIndex: index + 1,
          };
        case 'value': {
          if (!options.linkValues && !options.linkArrays) {
            break;
          }
          return {
            nodes: [
              createValueRefElement(
                binding.value,
                node.children,
                binding.varName,
                className,
                options.typeValueRefComponent,
                binding.refs,
              ),
            ],
            nextIndex: index + 1,
          };
        }
        case 'value-object': {
          // Dot-access lookahead: check for `.propName` after this smi span
          const dotResult = tryResolveDotAccess(binding, text, siblings, index, className, options);
          if (dotResult) {
            return dotResult;
          }
          // No dot access — annotate with the full object shape
          const shapeStr = formatObjectShape(binding.properties);
          return {
            nodes: [
              createValueRefElement(
                shapeStr,
                node.children,
                binding.varName,
                className,
                options.typeValueRefComponent,
              ),
            ],
            nextIndex: index + 1,
          };
        }
        case 'shadow':
          return { nodes: [node], nextIndex: index + 1 };
        case 'module': {
          // Namespace dot-access: `NS.exportName` — look for `.` + span
          const moduleResult = tryResolveModuleDotAccess(
            binding,
            text,
            siblings,
            index,
            className,
            options,
          );
          if (moduleResult) {
            return moduleResult;
          }
          // No dot-access — just render the namespace identifier as a link
          // to the module page if it has a default href
          if (binding.defaultHref) {
            return {
              nodes: [
                createLinkElement(
                  binding.defaultHref,
                  node.children,
                  text,
                  className,
                  options.typeRefComponent,
                ),
              ],
              nextIndex: index + 1,
            };
          }
          return { nodes: [node], nextIndex: index + 1 };
        }
        default:
          break;
      }
    }
  }

  return { nodes: [node], nextIndex: index + 1 };
}

/**
 * Handles a keyword span (pl-k) by updating scan state.
 */
function handleKeywordSpan(node: Element, state: ScanState, options: EnhanceOptions): void {
  const { lang, linkValues, linkArrays, moduleLinkMap } = options;
  const text = getTextContent(node);

  switch (text) {
    case '@import':
      if (lang.semantics !== 'css') {
        break;
      }
      if (moduleLinkMap) {
        state.sawCssImportKeyword = true;
      }
      break;
    case 'import':
      if (lang.semantics !== 'js') {
        break;
      }
      if (moduleLinkMap) {
        state.sawJsImportKeyword = true;
        state.pendingImportNames = [];
        state.pendingDefaultImport = null;
        state.pendingNamespaceImport = null;
        state.importSawAs = false;
        state.sawFromKeyword = false;
        state.inImportBraces = false;
        state.importSawStar = false;
      }
      break;
    case 'from':
      if (state.sawJsImportKeyword && moduleLinkMap) {
        state.sawFromKeyword = true;
      }
      break;
    case 'as':
      if (state.sawJsImportKeyword && moduleLinkMap) {
        state.importSawAs = true;
      }
      break;
    case 'default':
      // Inside `import { default as Foo }`, `default` is tokenized as pl-k.
      // Collect it as a named import so that the subsequent `as Foo` aliases it.
      if (state.sawJsImportKeyword && state.inImportBraces && moduleLinkMap) {
        state.pendingImportNames.push({ localName: 'default', exportedName: 'default' });
      }
      break;
    case 'type':
      if (state.sawJsImportKeyword && moduleLinkMap) {
        break;
      }
      if (!lang.supportsTypes) {
        break;
      }
      state.sawTypeKeyword = true;
      state.lastEntityName = null;
      state.typeDefPersist = null;
      break;
    case 'function':
      if (lang.semantics !== 'js') {
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
      // Clear stale pending value state, but only when NOT inside a nested
      // object/array literal. A `const` inside a nested function body
      // (e.g., `{ fn: () => { const t = 'x'; }, key: 'v' }`) should not
      // abort the outer collection.
      state.pendingValueVar = null;
      if (!state.pendingObjectValue || state.pendingObjectValue.braceDepth <= 1) {
        state.pendingObjectValue = null;
      }
      if (!state.pendingArrayValue || state.pendingArrayValue.bracketDepth <= 1) {
        state.pendingArrayValue = null;
      }
      break;
    case '=>':
      // Arrow token after `)` confirms arrow function. Mark it so that a
      // subsequent `(` can be recognised as expression-body grouping.
      if (state.expectingFunctionBody) {
        state.sawArrowForBody = true;
      }
      break;
    case '...':
      // Spread operator — mark pending so the next identifier can be resolved.
      if (state.pendingArrayValue) {
        state.pendingArrayValue.pendingSpread = true;
      }
      break;
    case ':':
      // Inside destructuring braces, `:` indicates a rename pattern (e.g. { a: renamed })
      // — mark the group so recordScopeBinding skips these uncertain bindings
      if (state.funcParamContext && state.funcParamContext.nestedBracketDepth > 0) {
        state.funcParamContext.sawColonInDestructuring = true;
      }
      // Object property pending value: confirm a span-tokenized key if pending.
      // When the key was plain text, currentPropName was already set by
      // processTextNode's identifier+colon regex.  When the key was a span,
      // pendingSpanKey holds the tentative name and this `:` keyword confirms it.
      // When the colon is an object property separator, skip the type-annotation
      // setup below — it's not a declaration annotation.
      if (state.pendingObjectValue && state.pendingObjectValue.braceDepth === 1) {
        if (state.pendingObjectValue.pendingSpanKey && !state.pendingObjectValue.currentPropName) {
          state.pendingObjectValue.currentPropName = state.pendingObjectValue.pendingSpanKey;
          state.pendingObjectValue.pendingSpanKey = null;
        }
        break;
      }
      // If we have a lastEntityName pending (from a type annotation context),
      // prepare to capture the type name
      if (lang.supportsTypes && !state.sawTypeKeyword && !currentOwner(state)) {
        state.pendingAnnotationType = ''; // sentinel: next pl-en fills this
      }
      break;
    case '=':
      // Save the declared variable name for value capture before clearing.
      // Only const declarations produce reliable value bindings.
      if (
        (linkValues || linkArrays) &&
        state.lastDeclaredVarName &&
        state.lastVarKeyword === 'const' &&
        !state.funcParamContext
      ) {
        state.pendingValueVar = state.lastDeclaredVarName;
      }
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
 * Extracts the text content from a string literal span (pl-s).
 * The span structure is: `<span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span>`
 * Returns the string value with surrounding quotes (e.g., `'hello'`).
 *
 * Returns `null` for template literals with interpolations (`${...}`) —
 * those are handled separately by `handleTemplateLiteral`.
 */
function extractStringLiteralValue(node: Element): string | null {
  // String literal spans contain: [pl-pds(quote), text, pl-pds(quote)]
  // or possibly more complex nested structures
  const parts: string[] = [];
  let quote = "'";
  let isBacktick = false;
  for (const child of node.children) {
    if (child.type === 'text') {
      parts.push(child.value);
    } else if (child.type === 'element') {
      const cls = getClassName(child);
      if (cls?.includes('pl-pds')) {
        // Quote delimiter — use the first one to determine quote style
        const delimText = getTextContent(child);
        if (delimText === '"' || delimText === "'") {
          quote = "'"; // normalise to single quotes in output
        } else if (delimText === '`') {
          isBacktick = true;
          quote = "'"; // template literals normalise to single quotes too
        }
      } else {
        // Other nested element — get its text content
        parts.push(getTextContent(child));
      }
    }
  }
  if (parts.length === 0) {
    return null;
  }
  // Template literals with interpolations need special handling
  if (isBacktick) {
    const joined = parts.join('');
    if (joined.includes('${')) {
      return null; // Handled by handleTemplateLiteral
    }
  }
  // Escape embedded single quotes so the output is a valid JS string literal.
  const raw = parts.join('').replace(/'/g, "\\'");
  return `${quote}${raw}${quote}`;
}

/**
 * Recursively extracts all text content from an element, including nested elements.
 */
function getDeepTextContent(node: Element | ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element') {
    return node.children.map(getDeepTextContent).join('');
  }
  return '';
}

/**
 * Checks whether a pl-s span is a template literal with interpolations.
 * Looks for a backtick pl-pds delimiter and pl-pse interpolation boundaries.
 *
 * Starry-night renders template literal interpolations as:
 *   `<span class="pl-pse"><span class="pl-s1">${</span></span>`
 *   `<span class="pl-s1">name</span>`
 *   `<span class="pl-pse"><span class="pl-s1">}</span></span>`
 */
function isTemplateLiteralWithInterpolations(node: Element): boolean {
  let hasBacktick = false;
  let hasPse = false;
  for (const child of node.children) {
    if (child.type === 'element') {
      const cls = getClassName(child);
      if (cls?.includes('pl-pds') && getTextContent(child) === '`') {
        hasBacktick = true;
      }
      if (cls?.includes('pl-pse')) {
        hasPse = true;
      }
    }
  }
  return hasBacktick && hasPse;
}

/**
 * Extracts expression tokens from a template literal with interpolations.
 *
 * Parses the pl-s span children based on starry-night's HAST structure:
 * - Text nodes between pl-pds/pl-pse become string tokens
 * - `pl-pse` elements with `${` / `}` delimit interpolation regions
 * - Inside interpolation regions, simple `pl-s1` identifiers become
 *   variable tokens resolved against the scope stack
 * - Whitespace-only text inside interpolation is ignored so `${ name }`
 *   remains trackable across tokenization variants
 *
 * Returns null for complex interpolations (expressions, member access, etc.)
 * since those cannot be tracked.
 */
function extractTemplateLiteralTokens(
  node: Element,
  state: ScanState,
): Array<{
  kind: 'number' | 'string' | 'operator' | 'variable';
  value: string;
  ref?: string;
}> | null {
  const tokens: Array<{
    kind: 'number' | 'string' | 'operator' | 'variable';
    value: string;
    ref?: string;
  }> = [];

  let inInterpolation = false;
  // Count non-delimiter elements seen inside current interpolation
  let interpolationContentCount = 0;

  for (const child of node.children) {
    if (child.type === 'text') {
      // Plain text outside interpolation → string token
      if (!inInterpolation && child.value.length > 0) {
        if (tokens.length > 0) {
          tokens.push({ kind: 'operator', value: '+' });
        }
        tokens.push({ kind: 'string', value: `'${child.value.replace(/'/g, "\\'")}'` });
      }
      // Ignore whitespace-only text inside interpolation so `${ name }`
      // works regardless of whether the highlighter emits spaces as text nodes
      if (inInterpolation && child.value.trim().length > 0) {
        return null;
      }
      continue;
    }

    if (child.type !== 'element') {
      continue;
    }

    const cls = getClassName(child);
    if (!cls) {
      continue;
    }

    // Backtick delimiters — skip
    if (cls.includes('pl-pds')) {
      continue;
    }

    // Interpolation boundary: pl-pse wrapping `${` or `}`
    if (cls.includes('pl-pse')) {
      const delimText = getDeepTextContent(child);
      if (delimText === '${') {
        inInterpolation = true;
        interpolationContentCount = 0;
      } else if (delimText === '}') {
        inInterpolation = false;
      }
      continue;
    }

    if (inInterpolation) {
      interpolationContentCount += 1;
      if (interpolationContentCount > 1) {
        // Complex interpolation (e.g., member access `obj.prop`) — bail
        return null;
      }
      // Simple identifier inside interpolation: pl-s1 or pl-smi
      if (!cls.includes('pl-s1') && !cls.includes('pl-smi')) {
        // Unexpected element type in interpolation — bail
        return null;
      }
      const varName = getTextContent(child).trim();
      if (varName.length === 0) {
        return null;
      }

      // Try to resolve as a tracked value
      const resolved = resolveFromScope(state, varName, true);
      if (resolved) {
        const tok = tokenFromLiteral(resolved);
        if (tokens.length > 0) {
          tokens.push({ kind: 'operator', value: '+' });
        }
        tokens.push(tok);
      } else {
        // Check for a type/prop/param ref
        const ref = resolveRefFromScope(state, varName) ?? undefined;
        if (tokens.length > 0) {
          tokens.push({ kind: 'operator', value: '+' });
        }
        tokens.push({ kind: 'variable', value: varName, ref });
      }
    }
    // Elements outside interpolation that aren't pl-pds — ignore
  }

  return tokens.length > 0 ? tokens : null;
}

/**
 * Handles a string literal span (pl-s) by capturing it for value tracking.
 * Also handles import module specifier linking when inside an import statement.
 */
function handleStringLiteralSpan(node: Element, state: ScanState, options: EnhanceOptions): void {
  // Dynamic import: defer linking until `)` closes the expression.
  // Only simple `import('module')` with no other content is linked.
  if (state.dynamicImportDepth > 0) {
    if (!state.dynamicImportIsComputed && options.moduleLinkMap) {
      if (!state.pendingDynamicImportLink) {
        const rawValue = extractStringLiteralRawValue(node);
        if (rawValue !== null) {
          const moduleEntry = options.moduleLinkMap[rawValue];
          if (moduleEntry) {
            state.pendingDynamicImportLink = {
              node,
              href: moduleEntry.href,
              rawValue,
            };
          } else {
            state.pendingDynamicImportAnnotation = { node, rawValue };
          }
        }
      } else {
        // Second string in dynamic import — must be a computed expression
        state.dynamicImportIsComputed = true;
        state.pendingDynamicImportLink = null;
        state.pendingDynamicImportAnnotation = null;
      }
    }
    return;
  }

  // CSS @import module specifier: `@import './foo.css'` or `@import url("./foo.css")`
  // Only links the string — no scope/identifier registration needed.
  if (state.sawCssImportKeyword) {
    if (options.moduleLinkMap) {
      const rawValue = extractStringLiteralRawValue(node);
      if (rawValue !== null) {
        const moduleEntry = options.moduleLinkMap[rawValue];
        if (moduleEntry) {
          const originalChildren = [...node.children];
          node.children = [createLinkElement(moduleEntry.href, originalChildren, rawValue)];
          recordResolvedImport(state, rawValue, moduleEntry, []);
        } else {
          node.properties['data-import'] = rawValue;
          state.unresolvedImports.add(rawValue);
        }
      }
    }
    state.sawCssImportKeyword = false;
    return;
  }

  // Static import module specifier: `from 'module'` or `import 'module'` (side-effect)
  if (state.sawFromKeyword || state.sawJsImportKeyword) {
    if (options.moduleLinkMap) {
      const rawValue = extractStringLiteralRawValue(node);
      if (rawValue !== null) {
        const moduleEntry = options.moduleLinkMap[rawValue];
        if (moduleEntry) {
          const originalChildren = [...node.children];
          node.children = [createLinkElement(moduleEntry.href, originalChildren, rawValue)];
          collectStaticImportExports(state, rawValue, moduleEntry, options);
          finalizeStaticImport(state, moduleEntry, options);
        } else {
          node.properties['data-import'] = rawValue;
          state.unresolvedImports.add(rawValue);
        }
      }
    }
    resetImportState(state);
    return;
  }
  if (!options.linkValues && !options.linkArrays) {
    return;
  }

  // Check for template literals with interpolations first
  if (isTemplateLiteralWithInterpolations(node)) {
    handleTemplateLiteralSpan(node, state, options);
    return;
  }

  const value = extractStringLiteralValue(node);
  if (!value) {
    return;
  }

  // Inside an array literal being collected
  if (state.pendingArrayValue) {
    if (state.pendingArrayValue.pendingSpread) {
      // Literal after spread (e.g., [...'abc']) — cannot inline, invalidate
      state.pendingArrayValue = null;
    } else {
      state.pendingArrayValue.elements.push(value);
    }
    return;
  }

  // Inside an object literal being collected — assign to currentPropName
  // Only capture at braceDepth 1 (top-level properties), matching the key
  // detection depth gate. Inner objects (braceDepth > 1) are ignored.
  if (
    state.pendingObjectValue &&
    state.pendingObjectValue.braceDepth === 1 &&
    state.pendingObjectValue.currentPropName
  ) {
    state.pendingObjectValue.properties.set(state.pendingObjectValue.currentPropName, value);
    state.pendingObjectValue.currentPropName = null;
    return;
  }

  // Direct assignment: const x = 'hello'
  // Only capture when not inside a function call — prevents const x = fn('hello') from tracking 'hello'
  // Deferred: store as a candidate, committed at `;` and invalidated by operators.
  if (state.pendingExpression && !state.pendingFuncCall) {
    state.pendingExpression.tokens.push({ kind: 'string', value });
  } else if (state.pendingValueVar && options.linkValues && !state.pendingFuncCall) {
    state.pendingLiteralCandidate = {
      varName: state.pendingValueVar,
      value,
      startChildIndex: -1,
      targetChildren: null,
    };
    state.pendingValueVar = null;
  }
}

/**
 * Handles a template literal span with interpolations.
 *
 * Extracts expression tokens from the template literal and either:
 * - Starts a new pendingExpression (if we're on the RHS of an assignment)
 * - Appends tokens to an existing pendingExpression
 *
 * For example, `` `prefix-${name}-suffix` `` produces tokens equivalent to
 * `'prefix-' + name + '-suffix'`.
 */
function handleTemplateLiteralSpan(node: Element, state: ScanState, options: EnhanceOptions): void {
  if (!options.linkValues) {
    return;
  }
  if (state.pendingFuncCall) {
    return;
  }

  const tokens = extractTemplateLiteralTokens(node, state);
  if (!tokens || tokens.length === 0) {
    // Complex template or couldn't parse — invalidate any pending state
    if (state.pendingExpression) {
      state.pendingExpression = null;
    }
    if (state.pendingValueVar) {
      state.pendingValueVar = null;
    }
    return;
  }

  if (state.pendingExpression) {
    // Append all tokens — they include their own `+` operators
    state.pendingExpression.tokens.push(...tokens);
  } else if (state.pendingValueVar) {
    // Start a new pendingExpression with these tokens
    state.pendingExpression = {
      varName: state.pendingValueVar,
      tokens,
      startChildIndex: -1,
      targetChildren: null,
      endChildIndex: -1,
    };
    state.pendingValueVar = null;
  }
}

/**
 * Resolves a variable name against the scope stack and returns its literal value
 * if it's a `'value'` binding. Returns null if not found or not a value binding.
 *
 * When `scalarOnly` is true, only plain `'value'` bindings are accepted.
 * Object and array bindings are skipped because their formatted shapes cannot
 * participate in arithmetic or concatenation expressions.
 */
function resolveFromScope(state: ScanState, name: string, scalarOnly?: boolean): string | null {
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(name);
    if (binding) {
      if (binding.refKind === 'value') {
        // Array-shaped values ("[...]") cannot participate in scalar expressions
        if (scalarOnly && binding.value.startsWith('[')) {
          return null;
        }
        return binding.value;
      }
      if (!scalarOnly && binding.refKind === 'value-object') {
        return formatObjectShape(binding.properties);
      }
      return null;
    }
  }
  return null;
}

/**
 * Resolves a variable name against the scope stack and returns its anchor href
 * if it has a type, prop, or param binding. Used for partial expression
 * evaluation where the variable cannot be resolved to a value but its type
 * reference can be carried through.
 */
function resolveRefFromScope(state: ScanState, name: string): string | null {
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(name);
    if (binding) {
      if (binding.refKind === 'type') {
        return binding.href;
      }
      if (binding.refKind === 'prop') {
        return binding.href;
      }
      if (binding.refKind === 'param') {
        return binding.href;
      }
      return null;
    }
  }
  return null;
}

/**
 * Checks whether a variable has a value-object or value-array binding in scope.
 * These bindings cannot participate in expressions.
 */
function hasObjectOrArrayBinding(state: ScanState, name: string): boolean {
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(name);
    if (binding) {
      return (
        binding.refKind === 'value-object' ||
        (binding.refKind === 'value' && binding.value.startsWith('['))
      );
    }
  }
  return false;
}

/**
 * Resolves a spread operand inside a pendingArrayValue.
 * If the operand is a tracked array value ("[a, b, c]"), its inner elements
 * are inlined into the current array. Otherwise the array tracking is invalidated.
 */
function resolveSpreadIntoArray(state: ScanState, name: string): void {
  const resolved = resolveFromScope(state, name);
  if (resolved && resolved.startsWith('[') && resolved.endsWith(']')) {
    // Extract inner elements from the resolved "[a, b, c]" string
    const inner = resolved.slice(1, -1).trim();
    if (inner.length > 0) {
      // Split on ", " — matches the format produced by recordArrayValueBinding
      const inlined = inner.split(', ');
      state.pendingArrayValue!.elements.push(...inlined);
    }
    state.pendingArrayValue!.pendingSpread = false;
  } else {
    // Cannot resolve the spread target — invalidate array tracking
    state.pendingArrayValue = null;
  }
}

/**
 * Formats an object's properties map as a human-readable literal string.
 * Example: `{ a: 'one', b: 'two' }`
 */
function formatObjectShape(properties: Map<string, string>): string {
  const pairs: string[] = [];
  properties.forEach((val, key) => {
    pairs.push(`${key}: ${val}`);
  });
  return `{ ${pairs.join(', ')} }`;
}

/**
 * Attempts to resolve a dot-access chain after a value-object binding.
 * Looks ahead for: text "." + pl-smi/pl-c1 span with a matching property name.
 * Returns the consumed nodes and next index if successful, otherwise null.
 */
function tryResolveDotAccess(
  binding: Extract<ScopeBinding, { refKind: 'value-object' }>,
  varName: string,
  siblings: ElementContent[],
  index: number,
  className: string[] | undefined,
  options: EnhanceOptions,
): { nodes: ElementContent[]; nextIndex: number } | null {
  // Check for "." text node followed by a smi or c1 span
  if (index + 2 >= siblings.length) {
    return null;
  }
  const maybeDot = siblings[index + 1];
  const maybeProp = siblings[index + 2];
  if (maybeDot.type !== 'text' || maybeDot.value !== '.' || maybeProp.type !== 'element') {
    return null;
  }
  const propName = getTextContent(maybeProp);
  const propValue = binding.properties.get(propName);
  if (propValue === undefined) {
    return null;
  }

  // Build the display name: "varName.propName"
  const displayName = `${varName}.${propName}`;
  // Consume the smi span, the dot text, and the property span
  const allChildren: ElementContent[] = [
    ...(siblings[index].type === 'element' ? (siblings[index] as Element).children : []),
    { type: 'text', value: '.' },
    ...(maybeProp.type === 'element' ? maybeProp.children : []),
  ];
  return {
    nodes: [
      createValueRefElement(
        propValue,
        allChildren,
        displayName,
        className,
        options.typeValueRefComponent,
      ),
    ],
    nextIndex: index + 3,
  };
}

/**
 * Attempts to resolve a dot-access chain after a module namespace binding.
 * Looks ahead for: text "." + pl-smi/pl-c1 span with an export name that
 * matches the module's exports map.
 * Returns the consumed nodes and next index if successful, otherwise null.
 */
function tryResolveModuleDotAccess(
  binding: Extract<ScopeBinding, { refKind: 'module' }>,
  nsName: string,
  siblings: ElementContent[],
  index: number,
  className: string[] | undefined,
  options: EnhanceOptions,
): { nodes: ElementContent[]; nextIndex: number } | null {
  if (index + 2 >= siblings.length) {
    return null;
  }
  const maybeDot = siblings[index + 1];
  const maybeProp = siblings[index + 2];
  if (maybeDot.type !== 'text' || maybeDot.value !== '.' || maybeProp.type !== 'element') {
    return null;
  }
  const exportName = getTextContent(maybeProp);
  const exportEntry = binding.exports[exportName];
  if (!exportEntry) {
    return null;
  }

  const href = `${binding.href}${exportEntry.slug}`;
  const title = exportEntry.title ?? exportName;
  // Consume the namespace span, dot text, and property span
  const allChildren: ElementContent[] = [
    ...(siblings[index].type === 'element' ? (siblings[index] as Element).children : []),
    { type: 'text', value: '.' },
    ...(maybeProp.type === 'element' ? maybeProp.children : []),
  ];
  return {
    nodes: [createLinkElement(href, allChildren, title, className, options.typeRefComponent)],
    nextIndex: index + 3,
  };
}

/**
 * Extracts the raw (unquoted) string value from a pl-s string literal span.
 * Returns null for template literals with interpolations or empty strings.
 */
function extractStringLiteralRawValue(node: Element): string | null {
  const parts: string[] = [];
  let isBacktick = false;
  for (const child of node.children) {
    if (child.type === 'text') {
      parts.push(child.value);
    } else if (child.type === 'element') {
      const cls = getClassName(child);
      if (cls?.includes('pl-pds')) {
        const delimText = getTextContent(child);
        if (delimText === '`') {
          isBacktick = true;
        }
      } else {
        parts.push(getTextContent(child));
      }
    }
  }
  if (parts.length === 0) {
    return null;
  }
  if (isBacktick) {
    const joined = parts.join('');
    if (joined.includes('${')) {
      return null;
    }
  }
  return parts.join('');
}

/**
 * Finalizes a static import statement by registering imported identifiers
 * in the scope stack. Import-derived bindings live exclusively in the scope
 * stack so that local declarations can shadow them; the user-provided linkMap
 * is never mutated.
 */
function finalizeStaticImport(
  state: ScanState,
  moduleEntry: ModuleLinkMapEntry,
  options: EnhanceOptions,
): void {
  const defaultSlug = moduleEntry.defaultSlug ?? options.defaultImportSlug;
  const exports = moduleEntry.exports ?? {};

  // Ensure a top-level scope exists for import bindings
  if (state.scopeStack.length === 0) {
    state.scopeStack.push({ bindings: new Map(), kind: 'function' });
  }
  const topScope = state.scopeStack[0];

  // Named imports: `import { test, foo as bar } from 'mod'`
  for (const { localName, exportedName } of state.pendingImportNames) {
    // `import { default as X }` is equivalent to `import X from 'mod'`
    if (exportedName === 'default') {
      if (defaultSlug) {
        const href = `${moduleEntry.href}${defaultSlug}`;
        topScope.bindings.set(localName, { refKind: 'type', href, typeName: localName });
      }
      continue;
    }
    const exportEntry = exports[exportedName];
    if (exportEntry) {
      const href = `${moduleEntry.href}${exportEntry.slug}`;
      const typeName = exportEntry.title ?? exportedName;
      topScope.bindings.set(localName, { refKind: 'type', href, typeName });
    }
  }

  // Default import: `import React from 'mod'`
  if (state.pendingDefaultImport && defaultSlug) {
    const href = `${moduleEntry.href}${defaultSlug}`;
    const localName = state.pendingDefaultImport;
    topScope.bindings.set(localName, { refKind: 'type', href, typeName: localName });
  }

  // Namespace import: `import * as NS from 'mod'`
  if (state.pendingNamespaceImport) {
    const localName = state.pendingNamespaceImport;
    const defaultHref = defaultSlug ? `${moduleEntry.href}${defaultSlug}` : undefined;
    // Add a module binding so `NS.exportName` resolves via dot-access
    topScope.bindings.set(localName, {
      refKind: 'module',
      href: moduleEntry.href,
      defaultHref,
      exports,
    });
  }
}

/**
 * Records a resolved import in the state for the `data-imports` attribute.
 * Merges exports when the same module is imported multiple times.
 */
function recordResolvedImport(
  state: ScanState,
  moduleSpecifier: string,
  moduleEntry: ModuleLinkMapEntry,
  importedExports: Array<{ slug: string; title: string }>,
): void {
  const existing = state.resolvedImports.get(moduleSpecifier);
  if (existing) {
    for (const exp of importedExports) {
      if (!existing.exports.some((e) => e.slug === exp.slug)) {
        existing.exports.push(exp);
      }
    }
  } else {
    state.resolvedImports.set(moduleSpecifier, {
      link: moduleEntry.href,
      exports: [...importedExports],
    });
  }
}

/**
 * Collects the actually-imported exports from the pending import state
 * and records them in `state.resolvedImports`.
 */
function collectStaticImportExports(
  state: ScanState,
  moduleSpecifier: string,
  moduleEntry: ModuleLinkMapEntry,
  options: EnhanceOptions,
): void {
  const defaultSlug = moduleEntry.defaultSlug ?? options.defaultImportSlug;
  const exports = moduleEntry.exports ?? {};
  const importedExports: Array<{ slug: string; title: string }> = [];

  // Named imports
  for (const { localName, exportedName } of state.pendingImportNames) {
    if (exportedName === 'default') {
      if (defaultSlug) {
        importedExports.push({ slug: defaultSlug, title: localName });
      }
    } else {
      const exportEntry = exports[exportedName];
      if (exportEntry) {
        importedExports.push({
          slug: exportEntry.slug,
          title: exportEntry.title ?? exportedName,
        });
      }
    }
  }

  // Default import
  if (state.pendingDefaultImport && defaultSlug) {
    importedExports.push({ slug: defaultSlug, title: state.pendingDefaultImport });
  }

  // Namespace import — record the module itself
  if (state.pendingNamespaceImport) {
    // No specific export to record, but the module should appear
  }

  recordResolvedImport(state, moduleSpecifier, moduleEntry, importedExports);
}

/**
 * Resets all import-related state flags.
 */

/**
 * Wraps the expression nodes in `newChildren` from `startChildIndex` to the end
 * (excluding the trailing `;` or `\n`) in a value-ref element.
 * Called after processTextNode detects a statement boundary that flushed a
 * pending expression.
 */
export function wrapExpressionNodes(
  newChildren: ElementContent[],
  state: ScanState,
  options: EnhanceOptions,
): void {
  const expr = state.lastFlushedExpression;
  if (!expr) {
    return;
  }
  state.lastFlushedExpression = null;

  const targetChildren = expr.targetChildren ?? newChildren;
  const { value, varName, startChildIndex, endChildIndex } = expr;
  if (startChildIndex < 0 || startChildIndex >= targetChildren.length) {
    return;
  }

  // The last node in newChildren should be a text node containing the
  // statement terminator (`;` or `\n` for ASI).  Split it so the terminator
  // and anything after it stays outside the wrapper.
  const lastNode = targetChildren[targetChildren.length - 1];
  let afterTerminator: string | null = null;
  if (lastNode.type === 'text') {
    // Try `;` first; fall back to `\n` for ASI-terminated expressions
    let splitIdx = lastNode.value.indexOf(';');
    if (splitIdx < 0) {
      splitIdx = lastNode.value.indexOf('\n');
    }
    if (splitIdx >= 0) {
      const before = lastNode.value.substring(0, splitIdx);
      afterTerminator = lastNode.value.substring(splitIdx);
      if (before.length > 0) {
        targetChildren[targetChildren.length - 1] = { type: 'text', value: before };
      } else {
        targetChildren.pop();
      }
    }
  }

  const effectiveEndChildIndex =
    endChildIndex >= 0 && endChildIndex <= targetChildren.length
      ? endChildIndex
      : targetChildren.length;

  if (effectiveEndChildIndex < startChildIndex) {
    return;
  }

  // Extract only the expression nodes, leaving trailing comments outside.
  const exprNodes = targetChildren.splice(
    startChildIndex,
    effectiveEndChildIndex - startChildIndex,
  );
  const wrapper = createValueRefElement(
    value,
    exprNodes,
    varName,
    undefined,
    options.typeValueRefComponent,
    expr.refs,
  );
  targetChildren.splice(startChildIndex, 0, wrapper);

  // Re-append the terminator text
  if (afterTerminator !== null) {
    targetChildren.push({ type: 'text', value: afterTerminator });
  }
}
