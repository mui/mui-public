import type { ElementContent } from 'hast';
import type { LanguageCapabilities } from './getLanguageCapabilities';
import type { ScanState, ScopeBinding } from './scanState';
import {
  currentOwner,
  lookupOwner,
  buildPropHref,
  finalizePendingDefaultExport,
  getResolvedValueExportAt,
  recordObjectValueBinding,
  recordArrayValueBinding,
  resetImportState,
  resetExportState,
  recordExport,
} from './scanState';
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
  linkMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
  linkParams: boolean | undefined,
  linkScope: boolean | undefined,
  linkValues: boolean | undefined,
  linkArrays: boolean | undefined,
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

    // Import statement punctuation: track `{`, `}`, `*` within import context.
    // This must come before all other handlers so import-internal characters
    // don't trigger unrelated state changes (e.g., brace tracking, JSX).
    if (state.sawJsImportKeyword) {
      if (ch === '.') {
        // `import.meta` — property access, not an import statement.
        // Clear import state so subsequent strings aren't treated as specifiers.
        resetImportState(state);
        break;
      }
      if (ch === '(') {
        // `import(` — dynamic import expression, not a static import statement.
        // Switch to dynamic import tracking mode.
        state.sawJsImportKeyword = false;
        state.dynamicImportDepth = 1;
        i += 1;
        continue;
      }
      if (ch === '{') {
        state.inImportBraces = true;
        i += 1;
        continue;
      }
      if (ch === '}') {
        state.inImportBraces = false;
        i += 1;
        continue;
      }
      if (ch === '*') {
        state.importSawStar = true;
        i += 1;
        continue;
      }
      // Skip other characters within the import statement
      // (commas, spaces, etc. are fine to pass through)
    }

    // Export statement punctuation: track `{`, `}` within export { ... } context.
    // This must come before other handlers so export-internal characters
    // don't trigger unrelated state changes.
    if (
      state.sawExportKeyword &&
      (!state.pendingExportKind || state.pendingExportKind === 'type')
    ) {
      if (ch === '{') {
        state.inExportBraces = true;
        // `export type { ... }` — the kind applies to each individual name
        // inside the braces, so preserve pendingExportKind for later use.
        i += 1;
        continue;
      }
      if (ch === '}' && state.inExportBraces) {
        state.inExportBraces = false;
        // Finalize the `export { ... }` or `export type { ... }` statement.
        // Clear the keyword node so recordExport doesn't overwrite it with each name.
        state.pendingExportKeywordNode = null;
        const listKind = state.pendingExportKind === 'type' ? 'type' : 'unknown';
        // Save entries for potential `from 'module'` enrichment via moduleLinkMap.
        // Must be done before resetExportState clears pendingExportNames.
        state.pendingReExportEntries = [];
        for (const { localName, exportedName, node } of state.pendingExportNames) {
          const idx = recordExport(state, exportedName, listKind);
          node.properties.id = exportedName;
          state.pendingReExportEntries.push({ localName, index: idx });
          // Enrich with type info from scope when available
          if (linkScope) {
            enrichExportFromScope(state, idx, localName, linkMap);
          }
        }
        resetExportState(state);
        i += 1;
        continue;
      }
      // `export *` — star re-export. Record immediately with name '*'.
      if (ch === '*' && !state.inExportBraces) {
        recordExport(state, '*', 'unknown');
        state.pendingStarReExport = true;
        resetExportState(state);
        i += 1;
        continue;
      }
    }

    // Dynamic import `import(` tracking: the `import` keyword was handled as
    // pl-k but in dynamic imports the `(` follows directly in a text node.
    if (ch === '(' && state.dynamicImportDepth > 0) {
      state.dynamicImportDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ')' && state.dynamicImportDepth > 0) {
      state.dynamicImportDepth -= 1;
      if (state.dynamicImportDepth === 0) {
        // Finalization of pendingDynamicImportLink happens in the main loop
        // after processTextNode returns (it needs access to createLinkElement).
        state.dynamicImportIsComputed = false;
      }
      i += 1;
      continue;
    }

    // Any non-whitespace text inside dynamic import parens marks it as computed,
    // preventing the deferred string link from being finalized.
    if (state.dynamicImportDepth > 0 && ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      state.dynamicImportIsComputed = true;
      state.pendingDynamicImportLink = null;
      state.pendingDynamicImportAnnotation = null;
    }

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
      // A `(` while pendingValueVar is active means the initializer is a call
      // expression or grouping, not a simple literal. Clear to prevent false captures.
      if (state.pendingValueVar && !state.pendingObjectValue && !state.pendingArrayValue) {
        state.pendingValueVar = null;
      }
      // Also invalidate any deferred literal candidate (e.g., `const x = 42(...)`)
      state.pendingLiteralCandidate = null;
      state.pendingExpression = null;
      state.expressionNewlineReady = false;

      // Track paren depth for export kind refinement
      if (state.pendingExportKindIndex != null) {
        state.exportKindParenDepth += 1;
      }

      // An open paren means the initializer is a function call or grouping,
      // not a simple literal — stop trying to infer a type from the value.
      if (state.pendingExportTypeIndex !== null) {
        state.pendingExportTypeIndex = null;
      }

      // Track nesting for multi-declarator export comma detection
      if (state.pendingMultiDeclKind) {
        state.multiDeclNestingDepth += 1;
      }

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
          linkMap,
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
        const lookup = lookupOwner(state.pendingTypeDefName, linkMap);
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
        state.lastEntityName in linkMap &&
        (linkProps || linkScope)
      ) {
        state.pendingFuncCall = {
          name: state.lastEntityName,
          anchorHref: linkMap[state.lastEntityName],
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
      // Track paren depth for export kind refinement
      if (state.pendingExportKindIndex != null && state.exportKindParenDepth > 0) {
        state.exportKindParenDepth -= 1;
      }
      // Track nesting for multi-declarator export comma detection
      if (state.pendingMultiDeclKind && state.multiDeclNestingDepth > 0) {
        state.multiDeclNestingDepth -= 1;
      }
      if (state.funcParamContext) {
        state.funcParamContext.parenDepth -= 1;
        if (state.funcParamContext.parenDepth === 0) {
          // Flush last unannotated param as positional binding before saving
          if (linkScope) {
            flushUnannotatedParam(state.funcParamContext, linkMap);
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
      // Multi-declarator export: comma at nesting depth 0 separates declarators.
      // Re-arm export state for the next variable name.
      if (state.pendingMultiDeclKind && state.multiDeclNestingDepth === 0) {
        state.pendingExportKind = state.pendingMultiDeclKind;
        state.sawExportKeyword = true;
        state.pendingExportTypeIndex = null;
        state.pendingExportKindIndex = null;
      }

      if (
        state.funcParamContext &&
        state.funcParamContext.parenDepth === 1 &&
        state.funcParamContext.nestedBracketDepth === 0 &&
        state.funcParamContext.nestedAngleDepth === 0
      ) {
        // Flush unannotated param as positional binding before advancing
        if (linkScope) {
          flushUnannotatedParam(state.funcParamContext, linkMap);
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

    // Newline — potential ASI boundary for complete expressions.
    // If pendingExpression ends with a value token (not an operator), mark
    // it as ready to flush.  The actual flush is deferred so that next-line
    // continuation syntax (`.`, `[`, `(`) can invalidate the expression
    // before it is committed, matching the safeguards for pendingLiteralCandidate.
    if (ch === '\n' && linkScope && state.pendingExpression) {
      const { tokens } = state.pendingExpression;
      if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'operator') {
        state.expressionNewlineReady = true;
      }
    }

    // Semicolon ";" — fail-safe: clear any stuck import parsing state
    if (ch === ';' && state.sawJsImportKeyword) {
      resetImportState(state);
    }

    // Semicolon ";" — fail-safe: clear stuck export parsing state
    if (ch === ';' && state.sawExportKeyword) {
      if (!finalizePendingDefaultExport(state)) {
        resetExportState(state);
      }
    }

    // Semicolon ";" — clear pending export type/kind index (statement boundary)
    if (ch === ';') {
      state.pendingExportTypeIndex = null;
      state.pendingExportKindIndex = null;
      state.pendingMultiDeclKind = null;
      state.pendingReExportEntries = [];
      state.pendingStarReExport = false;
    }

    // Semicolon ";" — fail-safe: clear stuck CSS import state
    if (ch === ';' && state.sawCssImportKeyword) {
      state.sawCssImportKeyword = false;
    }

    // Semicolon ";" — scope ambiguity resets
    if (ch === ';' && linkScope) {
      flushLiteralCandidate(state);
      const exprResult = flushPendingExpression(state);
      if (exprResult) {
        state.lastFlushedExpression = exprResult;
      }
      state.expressionNewlineReady = false;
      state.lastDeclaredVarName = null;
      state.lastVarKeyword = null;
      state.expectingFunctionBody = false;
      state.sawArrowForBody = false;
      state.expressionArrowBody = false;
      state.pendingFunctionBindings = null;
      // Clear pending value tracking at statement boundaries
      state.pendingValueVar = null;
      // Only clear object/array literal collection when we're NOT inside a
      // nested construct. Semicolons inside nested braces (e.g., function
      // bodies within an object literal) should not abort the outer collection.
      if (!state.pendingObjectValue || state.pendingObjectValue.braceDepth <= 1) {
        state.pendingObjectValue = null;
      }
      if (!state.pendingArrayValue || state.pendingArrayValue.bracketDepth <= 1) {
        state.pendingArrayValue = null;
      }
    }

    // Open brace "{"
    if (ch === '{') {
      // Track nesting for multi-declarator export comma detection
      if (state.pendingMultiDeclKind) {
        state.multiDeclNestingDepth += 1;
      }
      // Object literal value tracking: track brace depth
      if (state.pendingObjectValue) {
        state.pendingObjectValue.braceDepth += 1;
        // At braceDepth > 1 we're inside a nested construct (e.g., a function
        // body within the object literal). Push scope frames so that inner
        // bindings don't leak into the outer scope.
        if (state.pendingObjectValue.braceDepth > 1 && linkScope) {
          if (state.expectingFunctionBody) {
            const bindings = state.pendingFunctionBindings ?? new Map();
            const kind = state.expressionArrowBody ? 'block' : 'function';
            state.scopeStack.push({ bindings, kind });
            state.pendingFunctionBindings = null;
            state.expectingFunctionBody = false;
            state.sawArrowForBody = false;
            state.expressionArrowBody = false;
          } else {
            state.scopeStack.push({ bindings: new Map(), kind: 'block' });
          }
        }
        i += 1;
        continue;
      }
      // Function body takes priority over object-value tracking so that
      // `const fn = () => { ... }` pushes a function scope instead of
      // entering pendingObjectValue mode.
      if (
        state.pendingValueVar &&
        linkValues &&
        !state.funcParamContext &&
        !state.expectingFunctionBody
      ) {
        state.pendingObjectValue = {
          varName: state.pendingValueVar,
          properties: new Map(),
          currentPropName: null,
          pendingSpanKey: null,
          braceDepth: 1,
          hasUnresolvedKeys: false,
        };
        state.pendingValueVar = null;
        i += 1;
        continue;
      }
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
        // Clear any pending value tracking — this is a function body, not a value
        state.pendingValueVar = null;
      } else {
        const handled = handleOpenBrace(state, linkMap, linkProps);
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
      // Track nesting for multi-declarator export comma detection
      if (state.pendingMultiDeclKind && state.multiDeclNestingDepth > 0) {
        state.multiDeclNestingDepth -= 1;
      }
      // Object literal value tracking: track depth and flush at top level
      if (state.pendingObjectValue) {
        state.pendingObjectValue.braceDepth -= 1;
        if (state.pendingObjectValue.braceDepth === 0) {
          recordObjectValueBinding(state);
          i += 1;
          continue;
        }
        // At braceDepth > 0 we're closing a nested construct — pop the
        // scope frame that was pushed by the matching `{`.
        if (state.pendingObjectValue.braceDepth >= 1 && linkScope && state.scopeStack.length > 1) {
          state.scopeStack.pop();
        }
        i += 1;
        continue;
      }
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

    // Spread operator "..." — mark pending so the next identifier can be resolved.
    // If the spread target is a tracked array const, its elements are inlined;
    // otherwise the array tracking is invalidated at the identifier handler.
    if (ch === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      if (state.pendingArrayValue) {
        state.pendingArrayValue.pendingSpread = true;
      }
      i += 3;
      continue;
    }

    // Open bracket "[" — array literal value tracking or func param destructuring
    if (ch === '[') {
      // Track nesting for multi-declarator export comma detection
      if (state.pendingMultiDeclKind) {
        state.multiDeclNestingDepth += 1;
      }
      // An open bracket means the initializer is an array literal or index
      // access — not a simple literal — stop trying to infer a type.
      if (state.pendingExportTypeIndex !== null) {
        state.pendingExportTypeIndex = null;
      }
      // A `[` after a literal means index access (e.g., `'hello'[0]`),
      // not a standalone initializer.  Invalidate the deferred candidate.
      if (state.pendingLiteralCandidate) {
        state.pendingLiteralCandidate = null;
      }
      if (state.pendingExpression) {
        state.pendingExpression = null;
        state.expressionNewlineReady = false;
      }
      // Array literal value tracking: start collecting elements
      if (state.pendingArrayValue) {
        state.pendingArrayValue.bracketDepth += 1;
        i += 1;
        continue;
      }
      if (state.pendingValueVar && linkArrays && !state.funcParamContext) {
        state.pendingArrayValue = {
          varName: state.pendingValueVar,
          elements: [],
          bracketDepth: 1,
          pendingSpread: false,
        };
        state.pendingValueVar = null;
        i += 1;
        continue;
      }
      if (state.funcParamContext) {
        state.funcParamContext.nestedBracketDepth += 1;
        i += 1;
        continue;
      }
    }

    // Close bracket "]" — array literal value tracking or func param destructuring
    if (ch === ']') {
      // Track nesting for multi-declarator export comma detection
      if (state.pendingMultiDeclKind && state.multiDeclNestingDepth > 0) {
        state.multiDeclNestingDepth -= 1;
      }
      if (state.pendingArrayValue) {
        state.pendingArrayValue.bracketDepth -= 1;
        if (state.pendingArrayValue.bracketDepth === 0) {
          recordArrayValueBinding(state);
        }
        i += 1;
        continue;
      }
      if (state.funcParamContext && state.funcParamContext.nestedBracketDepth > 0) {
        state.funcParamContext.nestedBracketDepth -= 1;
        i += 1;
        continue;
      }
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

    // Confirm a span-based property key when we see `:` (with optional leading whitespace).
    // This handles object keys emitted as span elements (e.g. <span class="pl-v">key</span>:).
    if (
      state.pendingObjectValue &&
      state.pendingObjectValue.braceDepth === 1 &&
      state.pendingObjectValue.pendingSpanKey
    ) {
      if (ch === ':') {
        state.pendingObjectValue.currentPropName = state.pendingObjectValue.pendingSpanKey;
        state.pendingObjectValue.pendingSpanKey = null;
        i += 1;
        continue;
      }
      // Whitespace is allowed between the span and `:`
      if (ch !== ' ' && ch !== '\t') {
        // Shorthand property (no `:` value) — mark shape as incomplete
        state.pendingObjectValue.hasUnresolvedKeys = true;
        state.pendingObjectValue.pendingSpanKey = null;
      }
    }

    // Try to match a property name inside a pending object value literal
    if (
      state.pendingObjectValue &&
      state.pendingObjectValue.braceDepth === 1 &&
      /[a-zA-Z_$]/.test(ch)
    ) {
      const rest = text.substring(i);
      const identMatch = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/);
      if (identMatch) {
        state.pendingObjectValue.currentPropName = identMatch[1];
        i += identMatch[0].length;
        continue;
      }
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

    // Dot invalidates a pending literal candidate — it means property/method
    // access on the value (e.g., `'hello'.toUpperCase()`), so the
    // initializer is a compound expression, not a standalone literal.
    if (ch === '.') {
      if (state.pendingLiteralCandidate) {
        state.pendingLiteralCandidate = null;
      }
      if (state.pendingExpression) {
        state.pendingExpression = null;
        state.expressionNewlineReady = false;
      }
    }

    // Evaluable arithmetic/concat operators: promote a pending literal to a
    // compound expression, or push the operator onto an active expression.
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      if (state.pendingLiteralCandidate) {
        // Promote: literal + operator → expression
        state.pendingExpression = {
          varName: state.pendingLiteralCandidate.varName,
          tokens: [
            tokenFromLiteral(state.pendingLiteralCandidate.value),
            { kind: 'operator', value: ch },
          ],
          startChildIndex: state.pendingLiteralCandidate.startChildIndex ?? -1,
          targetChildren: state.pendingLiteralCandidate.targetChildren,
          endChildIndex: -1,
        };
        state.pendingLiteralCandidate = null;
      } else if (state.pendingExpression) {
        // Consecutive operators (e.g. `++`, `+-`) → invalid expression
        const lastToken = state.pendingExpression.tokens[state.pendingExpression.tokens.length - 1];
        if (lastToken && lastToken.kind === 'operator') {
          state.pendingExpression = null;
          state.expressionNewlineReady = false;
        } else {
          state.pendingExpression.tokens.push({ kind: 'operator', value: ch });
          // Operator extends the expression — it's no longer complete
          state.expressionNewlineReady = false;
        }
      } else if (state.pendingValueVar) {
        // Unary prefix (e.g. `-1`, `+1`) — clear pendingValueVar
        state.pendingValueVar = null;
      }
      i += 1;
      continue;
    }

    // Non-evaluable operators invalidate all expression tracking.
    if (
      ch === '%' ||
      ch === '?' ||
      ch === '&' ||
      ch === '|' ||
      ch === '^' ||
      ch === '~' ||
      ch === '!' ||
      ch === '<' ||
      ch === '>'
    ) {
      if (state.pendingLiteralCandidate) {
        state.pendingLiteralCandidate = null;
      }
      if (state.pendingExpression) {
        state.pendingExpression = null;
        state.expressionNewlineReady = false;
      }
      if (state.pendingValueVar && !state.pendingObjectValue && !state.pendingArrayValue) {
        state.pendingValueVar = null;
      }
    }

    i += 1;
  }

  // Flush remaining text
  flush(text.length);

  return output.length > 0 ? output : [{ type: 'text', value: text }];
}

/**
 * Converts a raw literal string (e.g., `'hello'`, `42`) into an expression token.
 */
export function tokenFromLiteral(value: string): { kind: 'number' | 'string'; value: string } {
  if (/^-?\d/.test(value)) {
    // Strip numeric separators (e.g. 1_000 → 1000) before storing
    return { kind: 'number', value: value.replace(/_/g, '') };
  }
  return { kind: 'string', value };
}

/**
 * Evaluates a list of expression tokens into a single value string.
 * Supports:
 * - Numeric arithmetic: `1 + 2` → `3`, `10 * 3` → `30`
 * - String concatenation: `'a' + 'b'` → `'ab'`
 * - Mixed string + number concat: `'item-' + 3` → `'item-3'`
 * - Partial evaluation with variables: `'a' + 'b' + x + 'c'` → `'ab' + x + 'c'`
 *   where unresolved variables are kept and their type refs recorded.
 *
 * Returns null if the expression cannot be evaluated at all.
 */
export function evaluateExpression(
  tokens: Array<{
    kind: 'number' | 'string' | 'operator' | 'variable';
    value: string;
    ref?: string;
  }>,
): { value: string; refs?: Record<string, string> } | null {
  if (tokens.length === 0) {
    return null;
  }
  // Must start with a value token and end with a value token
  if (tokens[0].kind === 'operator' || tokens[tokens.length - 1].kind === 'operator') {
    return null;
  }
  // Validate proper alternation: value, operator, value, operator, value, ...
  for (let j = 0; j < tokens.length; j += 1) {
    const expectValue = j % 2 === 0;
    const isValue = tokens[j].kind !== 'operator';
    if (expectValue !== isValue) {
      return null;
    }
  }

  const hasString = tokens.some((t) => t.kind === 'string');
  const hasVariable = tokens.some((t) => t.kind === 'variable');

  // Variables in pure numeric context are not evaluable
  if (hasVariable && !hasString) {
    return null;
  }

  // Partial evaluation: string concatenation with unresolved variables.
  // Collapse adjacent evaluable groups, keep variables in place.
  if (hasVariable) {
    // String concatenation with variables: only `+` is valid
    if (tokens.some((t) => t.kind === 'operator' && t.value !== '+')) {
      return null;
    }
    return evaluatePartialConcat(tokens);
  }

  if (hasString) {
    // String concatenation: only `+` is valid
    if (tokens.some((t) => t.kind === 'operator' && t.value !== '+')) {
      return null;
    }
    let result = '';
    for (const token of tokens) {
      if (token.kind === 'string') {
        // Strip quotes to get inner value, then append
        result += stripQuotes(token.value);
      } else if (token.kind === 'number') {
        result += token.value;
      }
      // Skip operator tokens (they're all `+`)
    }
    return { value: `'${escapeQuotes(result)}'` };
  }

  // Pure numeric arithmetic
  // Build a left-to-right evaluation respecting operator precedence
  const values: number[] = [];
  const ops: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'number') {
      const num = Number(token.value);
      if (Number.isNaN(num)) {
        return null;
      }
      values.push(num);
    } else if (token.kind === 'operator') {
      ops.push(token.value);
    }
  }

  if (values.length !== ops.length + 1) {
    return null;
  }

  // Evaluate * and / first (left to right)
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === '*' || ops[i] === '/') {
      const left = values[i];
      const right = values[i + 1];
      if (ops[i] === '/' && right === 0) {
        return null;
      }
      values[i] = ops[i] === '*' ? left * right : left / right;
      values.splice(i + 1, 1);
      ops.splice(i, 1);
    } else {
      i += 1;
    }
  }

  // Then + and -
  let result = values[0];
  for (let j = 0; j < ops.length; j += 1) {
    if (ops[j] === '+') {
      result += values[j + 1];
    } else {
      result -= values[j + 1];
    }
  }

  // Format: avoid trailing decimals for integers
  const formatted = Number.isInteger(result) ? String(result) : String(result);
  return { value: formatted };
}

/**
 * Evaluates a string concatenation expression that contains unresolved variable
 * tokens. Adjacent evaluable tokens (strings, numbers) are collapsed together,
 * while variable tokens remain in the output as-is.
 *
 * Example: `'a' + 'b' + test + 'c' + 'd'` → value `'ab' + test + 'cd'`
 *
 * Returns a refs map pairing each variable name to its type-ref anchor href
 * (if available).
 */
function evaluatePartialConcat(
  tokens: Array<{
    kind: 'number' | 'string' | 'operator' | 'variable';
    value: string;
    ref?: string;
  }>,
): { value: string; refs?: Record<string, string> } | null {
  // Collect runs of evaluable tokens separated by variable tokens
  const segments: Array<{ type: 'literal'; text: string } | { type: 'variable'; name: string }> =
    [];
  const refs: Record<string, string> = {};
  let pendingText = '';

  for (const token of tokens) {
    if (token.kind === 'operator') {
      continue;
    }
    if (token.kind === 'variable') {
      // Flush preceding literal group
      if (pendingText.length > 0) {
        segments.push({ type: 'literal', text: pendingText });
        pendingText = '';
      }
      segments.push({ type: 'variable', name: token.value });
      if (token.ref) {
        refs[token.value] = token.ref;
      }
    } else if (token.kind === 'string') {
      pendingText += stripQuotes(token.value);
    } else if (token.kind === 'number') {
      pendingText += token.value;
    }
  }
  // Flush trailing literal group
  if (pendingText.length > 0) {
    segments.push({ type: 'literal', text: pendingText });
  }

  if (segments.length === 0) {
    return null;
  }

  // Build the simplified expression string
  const parts = segments.map((seg) =>
    seg.type === 'literal' ? `'${escapeQuotes(seg.text)}'` : seg.name,
  );
  const value = parts.join(' + ');
  const hasRefs = Object.keys(refs).length > 0;
  return { value, refs: hasRefs ? refs : undefined };
}

/**
 * Strips surrounding quotes from a string literal value.
 * `'hello'` → `hello`, `"world"` → `world`
 */
function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1).replace(/\\'/g, "'");
  }
  return s;
}

/**
 * Escapes single quotes in a string for inclusion in a single-quoted literal.
 */
function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

/**
 * Commits a pending literal candidate as a scope binding and clears it.
 * Called at statement boundaries (`;`) and at the end of the top-level code block
 * traversal (covers ASI / no-semicolon code).
 */
export function flushLiteralCandidate(state: ScanState): void {
  if (!state.pendingLiteralCandidate) {
    return;
  }
  const binding: ScopeBinding = {
    refKind: 'value',
    value: state.pendingLiteralCandidate.value,
    varName: state.pendingLiteralCandidate.varName,
    declKind: 'const',
  };
  const current = state.scopeStack[state.scopeStack.length - 1];
  if (current) {
    current.bindings.set(state.pendingLiteralCandidate.varName, binding);
  }
  state.pendingLiteralCandidate = null;
}

/**
 * Evaluates and commits a pending compound expression as a scope binding.
 * Called at statement boundaries and at end of top-level traversal.
 * Returns the evaluated result (for wrapping) or null if evaluation failed.
 */
export function flushPendingExpression(state: ScanState): {
  value: string;
  varName: string;
  startChildIndex: number;
  endChildIndex: number;
  refs?: Record<string, string>;
  targetChildren: ElementContent[] | null;
} | null {
  if (!state.pendingExpression) {
    return null;
  }
  const { varName, tokens, startChildIndex, endChildIndex, targetChildren } =
    state.pendingExpression;
  state.pendingExpression = null;
  state.expressionNewlineReady = false;
  const result = evaluateExpression(tokens);
  if (!result) {
    return null;
  }
  const binding: ScopeBinding = {
    refKind: 'value',
    value: result.value,
    varName,
    refs: result.refs,
    declKind: 'const',
  };
  const current = state.scopeStack[state.scopeStack.length - 1];
  if (current) {
    current.bindings.set(varName, binding);
  }
  return {
    value: result.value,
    varName,
    startChildIndex,
    endChildIndex,
    refs: result.refs,
    targetChildren,
  };
}

/**
 * Handles an open brace "{" in text, updating the scan state.
 * Returns true if the brace was consumed by owner logic, false otherwise.
 */
export function handleOpenBrace(
  state: ScanState,
  linkMap: Record<string, string>,
  linkProps: 'shallow' | 'deep' | undefined,
): boolean {
  const owner = currentOwner(state);

  // Function call: pending function call with object argument
  if (!owner && state.pendingFuncCall) {
    const paramKey = `${state.pendingFuncCall.name}[${state.pendingFuncCall.paramIndex}]`;
    const paramAnchorHref = linkMap[paramKey] ?? null;
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
    const lookup = lookupOwner(state.pendingTypeDefName, linkMap);
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
    const lookup = lookupOwner(state.pendingAnnotationType, linkMap);
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

/**
 * Enriches a recorded export entry with type and kind information from scope bindings.
 * When identifiers in `export { ... }` resolve to a binding in the scope stack,
 * this populates the export's `type`, `typeHref`, and `kind` fields.
 */
function enrichExportFromScope(
  state: ScanState,
  exportIndex: number,
  localName: string,
  linkMap: Record<string, string>,
): void {
  for (let k = state.scopeStack.length - 1; k >= 0; k -= 1) {
    const binding = state.scopeStack[k].bindings.get(localName);
    if (binding) {
      const entry = getResolvedValueExportAt(state, exportIndex);
      if (!entry) {
        break;
      }
      if (binding.refKind === 'type') {
        entry.type = binding.typeName;
        entry.typeHref = linkMap[binding.typeName] ?? binding.href;
      } else if (binding.refKind === 'value') {
        entry.type = binding.value;
      }
      if ('declKind' in binding && binding.declKind) {
        entry.kind = binding.declKind;
      }
      break;
    }
  }
}
