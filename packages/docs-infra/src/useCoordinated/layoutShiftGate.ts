'use client';

/**
 * Process-global, client-only gate that holds coordinated **layout-shifting**
 * changes until the page has finished its initial hydration swaps.
 *
 * On hydration, anything that may shift layout once it settles — a code block
 * swapping from its plain fallback to highlighted (and focus-collapsed) output,
 * say — calls {@link registerLayoutShiftSource} and invokes the returned
 * `settle` when it reaches its stable layout. `useCoordinated` consumers
 * `await` {@link whenLayoutShiftsSettled} inside their existing `preload` slot,
 * so the coordination barrier defers a layout-shifting commit until the gate
 * opens. The upshot: the first transform/variant change lands as a single
 * unified update across every block, instead of a cascade as blocks swap in at
 * staggered idle times.
 *
 * Deliberately **not** a React context: registration happens in
 * `CodeHighlighterClient` and is read deep inside `useCoordinated`, with no
 * natural shared ancestor to thread a provider through. This mirrors the
 * module-global design of `coordinatePreference`. It is client-only and never
 * touched during SSR, so the shared module state cannot leak across server
 * requests.
 *
 * The gate opens **once**. A source that registers after the page has already
 * settled (e.g. a block streamed in and hydrated late, or mounted on client
 * navigation) adopts the current coordinated value rather than re-closing the
 * gate for everyone — "all sources" means "all present by the initial settle".
 *
 * The mechanism is the generic {@link createSettleGate}; this module wraps the
 * shared {@link pageSettleGate} (the same instance generic `CoordinatedLazy`
 * swaps register with by default) with the named functions preserved for
 * existing callers. The layout-shift use case never needs the `expect` /
 * `markLast` completion signals (sources are a fixed set present by the initial
 * commit), so they are intentionally not re-exported here.
 */

import { pageSettleGate } from './pageSettleGate';

const gate = pageSettleGate;

/**
 * Register a source that may cause a layout shift once it settles. Call the
 * returned function when the source has reached its stable post-hydration
 * layout. Idempotent — calling it more than once is a no-op.
 */
export function registerLayoutShiftSource(): () => void {
  return gate.register();
}

/**
 * Whether the page's initial layout-shifting swaps have settled. `true` before
 * any source registers (nothing to wait for) and once every registered source
 * has settled.
 */
export function layoutShiftsSettled(): boolean {
  return gate.isSettled();
}

/**
 * Resolves once {@link layoutShiftsSettled} is `true`. Returns `null`
 * synchronously when already settled so callers can take a fast path (mirrors
 * `useHighlightGate`). Rejects with an `AbortError` if `signal` aborts first,
 * so a superseding coordination announce can abandon the wait.
 */
export function whenLayoutShiftsSettled(signal?: AbortSignal): Promise<void> | null {
  return gate.whenSettled(signal);
}

/**
 * Reset all gate state. Test-only — there is no production reason to reopen a
 * settled gate.
 */
export function resetLayoutShiftGate(): void {
  gate.reset();
}
