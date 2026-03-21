import type { ElementContent } from 'hast';
import { toKebabCase } from '../loaderUtils/toKebabCase';
import type { ScanState } from './scanState';
import { lookupOwner, currentOwner, buildPropHref, buildParamOwnerKey } from './scanState';
import { hasArrowAfterParens } from './arrowDetection';

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
export function tryStartFuncParamContext(
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
export function flushUnannotatedParam(
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
