import type { ElementContent } from 'hast';
import type { LanguageCapabilities } from './getLanguageCapabilities';
import type { ScanState } from './scanState';
import { currentOwner, lookupOwner, buildPropHref } from './scanState';
import { propPathToString } from './hastUtils';
import { createPropRefElement } from './createElements';
import { tryStartFuncParamContext, flushUnannotatedParam } from './tryStartFuncParamContext';

/**
 * Process a text node for brace/JSX tracking and plain text property extraction.
 * Returns an array of ElementContent nodes (possibly splitting the text node).
 */
export function processTextNode(
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
      if ((linkParams || linkScope) && lang.semantics === 'js') {
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
        lang.semantics === 'js' &&
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
    if (ch === ':' && lang.semantics === 'css' && state.pendingCssProperty && linkProps) {
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
export function handleOpenBrace(
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
export function handleCloseBrace(state: ScanState): boolean {
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
