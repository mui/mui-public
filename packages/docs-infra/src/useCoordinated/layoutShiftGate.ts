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
 * The gate opens **once**, and it coordinates only the *initial hydration
 * cohort* — every source present by the first settle. A source that registers
 * after the page has already settled (e.g. a block streamed in and hydrated
 * late, or a block mounted later on a client-side SPA navigation) registers
 * into the already-settled gate: {@link whenLayoutShiftsSettled} resolves
 * immediately, so it adopts the current coordinated value rather than
 * re-closing the gate for everyone — "all sources" means "all present by the
 * initial settle". This is by design: client-side navigations do **not**
 * re-coordinate a fresh cohort, and there is no production path that reopens a
 * settled gate.
 */

/**
 * Fallback ceiling: if a registered source never settles (its swap errored or
 * hung), open the gate anyway so coordination can never be blocked forever.
 * Matches the coordinator's default `ultimateTimeoutMs`.
 */
const SETTLE_SAFETY_TIMEOUT_MS = 10_000;

let pendingCount = 0;
// `true` once at least one source has registered — until then there is nothing
// to wait for and the gate reports settled.
let armed = false;
let settled = false;
let settleCheckScheduled = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
const settleListeners = new Set<() => void>();

function openGate(): void {
  if (settled) {
    return;
  }
  settled = true;
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  const listeners = Array.from(settleListeners);
  settleListeners.clear();
  for (const listener of listeners) {
    listener();
  }
}

function scheduleSettleCheck(): void {
  if (settled || settleCheckScheduled) {
    return;
  }
  settleCheckScheduled = true;
  // Defer past the current commit/tick so a burst of same-tick registrations —
  // several blocks hydrating together, or an `init` block that settles before
  // a sibling has registered — all land before we declare the page settled.
  queueMicrotask(() => {
    settleCheckScheduled = false;
    if (!settled && armed && pendingCount === 0) {
      openGate();
    }
  });
}

/**
 * Register a source that may cause a layout shift once it settles. Call the
 * returned function when the source has reached its stable post-hydration
 * layout. Idempotent — calling it more than once is a no-op.
 */
export function registerLayoutShiftSource(): () => void {
  if (settled) {
    return () => {};
  }
  armed = true;
  pendingCount += 1;
  if (safetyTimer === null && typeof setTimeout === 'function') {
    safetyTimer = setTimeout(openGate, SETTLE_SAFETY_TIMEOUT_MS);
  }

  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    pendingCount -= 1;
    scheduleSettleCheck();
  };
}

/**
 * Whether the page's initial layout-shifting swaps have settled. `true` before
 * any source registers (nothing to wait for) and once every registered source
 * has settled.
 */
export function layoutShiftsSettled(): boolean {
  return settled || !armed;
}

/**
 * Resolves once {@link layoutShiftsSettled} is `true`. Returns `null`
 * synchronously when already settled so callers can take a fast path (mirrors
 * `useHighlightGate`). Rejects with an `AbortError` if `signal` aborts first,
 * so a superseding coordination announce can abandon the wait.
 */
export function whenLayoutShiftsSettled(signal?: AbortSignal): Promise<void> | null {
  if (layoutShiftsSettled()) {
    return null;
  }
  return new Promise<void>((resolve, reject) => {
    const onSettle = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    function onAbort() {
      settleListeners.delete(onSettle);
      reject(new DOMException('Layout-shift gate wait aborted', 'AbortError'));
    }
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Layout-shift gate wait aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
    settleListeners.add(onSettle);
  });
}

/**
 * Reset all gate state. Test-only — there is no production reason to reopen a
 * settled gate.
 */
export function resetLayoutShiftGate(): void {
  pendingCount = 0;
  armed = false;
  settled = false;
  settleCheckScheduled = false;
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  settleListeners.clear();
}
