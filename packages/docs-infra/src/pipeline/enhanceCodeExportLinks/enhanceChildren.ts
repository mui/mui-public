import type { Element, ElementContent, Text } from 'hast';
import type { LanguageCapabilities } from './getLanguageCapabilities';
import type { ScanState, ScopeBinding } from './scanState';
import {
  isLinkableSpan,
  isPropertySpan,
  isKeywordSpan,
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
import { currentOwner, buildPropHref, buildParamHref } from './scanState';
import { flushLiteralCandidate, processTextNode } from './processTextNode';

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
  anchorMap: Record<string, string>;
  typeRefComponent?: string;
  typePropRefComponent?: string;
  typeParamRefComponent?: string;
  typeValueRefComponent?: string;
  linkProps?: 'shallow' | 'deep';
  linkParams?: boolean;
  linkScope?: boolean;
  linkValues?: boolean;
  linkArrays?: boolean;
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
    anchorMap,
    typePropRefComponent,
    linkProps,
    linkParams,
    linkScope,
    linkValues,
    linkArrays,
    lang,
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
        anchorMap,
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
        handleKeywordSpan(node, state, options);
        newChildren.push(node);
        i += 1;
        continue;
      }

      // String literal span (pl-s): capture value for const tracking
      if (isStringLiteralSpan(node)) {
        handleStringLiteralSpan(node, state, options);
        newChildren.push(node);
        i += 1;
        continue;
      }

      // Identifier reference span (pl-smi): resolve against scope stack
      if (linkScope && isSmiSpan(node)) {
        const result = handleSmiSpan(node, children, i, state, options);
        newChildren.push(...result.nodes);
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
    anchorMap,
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
  linkValues: boolean | undefined,
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
    currentOwner(state)?.kind !== 'css-property' &&
    text in anchorMap
  ) {
    state.pendingCssProperty = { name: text, anchorHref: anchorMap[text] };
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
    (state.pendingArrayValue || state.pendingObjectValue || (state.pendingValueVar && linkValues))
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
      } else if (state.pendingValueVar) {
        // Defer value binding — store as a candidate rather than committing
        // immediately, so that compound expressions like `42 + 1` are invalidated.
        state.pendingLiteralCandidate = { varName: state.pendingValueVar, value: text };
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
  const { lang, linkValues, linkArrays } = options;
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
 */
function extractStringLiteralValue(node: Element): string | null {
  // String literal spans contain: [pl-pds(quote), text, pl-pds(quote)]
  // or possibly more complex nested structures
  const parts: string[] = [];
  let quote = "'";
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
  // Escape embedded single quotes so the output is a valid JS string literal.
  const raw = parts.join('').replace(/'/g, "\\'");
  return `${quote}${raw}${quote}`;
}

/**
 * Handles a string literal span (pl-s) by capturing it for value tracking.
 */
function handleStringLiteralSpan(node: Element, state: ScanState, options: EnhanceOptions): void {
  if (!options.linkValues && !options.linkArrays) {
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
  if (state.pendingValueVar && options.linkValues && !state.pendingFuncCall) {
    state.pendingLiteralCandidate = { varName: state.pendingValueVar, value };
    state.pendingValueVar = null;
  }
}

/**
 * Resolves a variable name against the scope stack and returns its literal value
 * if it's a `'value'` binding. Returns null if not found or not a value binding.
 */
function resolveFromScope(state: ScanState, name: string): string | null {
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(name);
    if (binding) {
      if (binding.refKind === 'value') {
        return binding.value;
      }
      if (binding.refKind === 'value-object') {
        return formatObjectShape(binding.properties);
      }
      return null;
    }
  }
  return null;
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
