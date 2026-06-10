import type { Code, CodeHighlighterBaseProps } from './types';
import { promoteCriticalFallback } from './fallbackFormat';

type HighlightAfter = CodeHighlighterBaseProps<{}>['highlightAfter'];

/**
 * Resolve the staging `fallbackCritical` field at a server→client (or client-load)
 * boundary, returning a clone of `code` ready to cross to the client:
 *
 * - **Promote** — under `highlightAt: 'init'` (and not `collapseToEmpty`), each
 *   variant whose `fallbackCritical` *and* plain `fallback` are both present has the
 *   sparse `fallbackCritical` diff spliced over its `fallback` (`promoteCriticalFallback`)
 *   — the visible frames become highlighted, the rest stay plain — so the first paint is
 *   highlighted with no client-side decompression. The promoted `fallback` stays a valid
 *   DEFLATE dictionary because the spliced frames have byte-identical text. With
 *   `collapseToEmpty`, the correct critical fallback is all-plain (no frame is visible),
 *   which already equals `fallback` — so promotion is skipped.
 * - **Strip** — `fallbackCritical` is always deleted (even when not promoting, and
 *   even for non-`init` modes), so it never crosses to the `Content`/`ContentLoading`
 *   components or bloats the serialized payload.
 *
 * Returns `code` unchanged (same reference) when no variant carries `fallbackCritical`,
 * and clones only the variants that do.
 */
export function resolveFallbackCritical(
  code: Code | undefined,
  highlightAfter: HighlightAfter,
  collapseToEmpty: boolean,
): Code | undefined {
  if (!code) {
    return code;
  }

  const promote = highlightAfter === 'init' && !collapseToEmpty;

  let changed = false;
  const resolved: Code = {};
  for (const [key, variant] of Object.entries(code)) {
    if (!variant || typeof variant === 'string' || variant.fallbackCritical === undefined) {
      resolved[key] = variant;
      continue;
    }

    const { fallbackCritical, ...rest } = variant;
    resolved[key] =
      promote && rest.fallback
        ? { ...rest, fallback: promoteCriticalFallback(rest.fallback, fallbackCritical) }
        : rest;
    changed = true;
  }

  return changed ? resolved : code;
}
