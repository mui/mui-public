import type { Element, ElementContent, Text } from 'hast';
import type { LanguageCapabilities } from './getLanguageCapabilities';
import type { ScanState, ScopeBinding } from './scanState';
import {
  isLinkableSpan,
  isPropertySpan,
  isKeywordSpan,
  isSmiSpan,
  getTextContent,
  getClassName,
  propPathToString,
} from './hastUtils';
import { createLinkElement, createPropRefElement, createParamRefElement } from './createElements';
import { currentOwner, buildPropHref, buildParamHref } from './scanState';
import { processTextNode } from './processTextNode';

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
  linkProps?: 'shallow' | 'deep';
  linkParams?: boolean;
  linkScope?: boolean;
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
