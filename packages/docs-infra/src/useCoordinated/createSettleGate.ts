/**
 * Fallback ceiling for {@link createSettleGate}: if a registered source never
 * settles (its swap errored or hung), the gate opens anyway after this many
 * milliseconds so coordination can never be blocked forever. Matches the
 * coordinator's default `ultimateTimeoutMs` and the value the module-global
 * `layoutShiftGate` shipped with.
 */
export const SETTLE_SAFETY_TIMEOUT_MS = 10_000;

/**
 * A reusable "all sources settled" gate.
 *
 * The module-global page-wide layout-shift gate (`layoutShiftGate`) is one
 * instance; each `StreamController` and `CoordinatedLazy` swap registers with
 * one too. The behavior is the original layout-shift gate's, plus two opt-in
 * completion signals (`expect` / `markLast`) for sources that arrive over time
 * (chunks streaming in across ticks) rather than all within the initial
 * hydration commit.
 *
 * Lifecycle: a source `register()`s and later calls the returned settle
 * function when it reaches its stable state. The gate opens once every
 * registered source has settled (and any completion constraint is met). It
 * opens **once** and never re-closes - a source that registers after the gate
 * has opened adopts the open state rather than re-closing it for everyone
 * ("all sources" means "all present by the initial settle").
 */
export interface SettleGate {
  /**
   * Register a pending source. Returns an idempotent settle function; call it
   * when the source reaches its stable state. Calling it more than once is a
   * no-op. Registering after the gate has already opened returns a no-op settle
   * and does not re-close the gate.
   */
  register(): () => void;
  /**
   * `true` before any source registers (nothing to wait for) and once every
   * registered source has settled and any completion constraint is met.
   */
  isSettled(): boolean;
  /**
   * Resolves once {@link isSettled} is `true`. Returns `null` synchronously
   * when already settled so callers can take a fast path (mirrors the original
   * `whenLayoutShiftsSettled`). Rejects with an `AbortError` if `signal` aborts
   * first, so a superseding wait can be abandoned.
   */
  whenSettled(signal?: AbortSignal): Promise<void> | null;
  /**
   * Declare how many sources will register in total. The gate then holds until
   * at least `count` sources have registered (and all have settled), so it
   * won't open during a momentary lull while later sources are still arriving -
   * e.g. chunks streaming in across separate ticks. This is **known-count**
   * completion.
   *
   * Pass a non-finite value (e.g. `Number.POSITIVE_INFINITY`) to hold the gate
   * open-indefinitely for an unknown-count stream, then call {@link markLast}
   * when the stream ends.
   */
  expect(count: number): void;
  /**
   * Terminal signal for **last-chunk** completion. Once called, the gate opens
   * as soon as every outstanding source has settled, regardless of any `expect`
   * count. Use it to end an unknown-count stream held open via
   * `expect(Infinity)`, or to finish early before an `expect(n)` count is
   * reached. Standalone - it does not require `expect` to have been called.
   */
  markLast(): void;
  /** Reset all state to the initial unarmed gate. Test-only. */
  reset(): void;
}

/**
 * Options for {@link createSettleGate}.
 */
export interface CreateSettleGateOptions {
  /**
   * Fallback ceiling (ms): open the gate even if a registered source never
   * settles.
   * @default SETTLE_SAFETY_TIMEOUT_MS
   */
  safetyTimeoutMs?: number;
  /**
   * Schedule the deferred settle check. Defaults to `queueMicrotask`, which
   * batches a burst of same-tick registrations before declaring the gate
   * settled. Injectable so tests can drive the check synchronously.
   */
  scheduleCheck?: (callback: () => void) => void;
}

/**
 * Create an independent "all sources settled" gate. See {@link SettleGate} for
 * the contract.
 *
 * Isomorphic - it touches only `setTimeout` and the injectable `scheduleCheck`
 * (default `queueMicrotask`), so it runs in tests and during SSR without the
 * DOM. Client-only consumers are responsible for never registering during SSR
 * (the page-wide layout-shift gate is only ever touched on the client for this
 * reason).
 */
export function createSettleGate(options: CreateSettleGateOptions = {}): SettleGate {
  const safetyTimeoutMs = options.safetyTimeoutMs ?? SETTLE_SAFETY_TIMEOUT_MS;
  const scheduleCheck =
    options.scheduleCheck ??
    (typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback: () => void) => {
          Promise.resolve().then(callback);
        });

  let pendingCount = 0;
  let registeredCount = 0;
  // `true` once at least one source has registered - until then there is
  // nothing to wait for and the gate reports settled.
  let armed = false;
  let settled = false;
  let checkScheduled = false;
  // Completion constraints layered on top of "every source settled":
  // `expectedCount` holds the gate until that many sources have registered
  // (known-count); `sawLast` is the standalone terminal that opens on the next
  // pending-zero regardless of the count (last-chunk).
  let expectedCount: number | null = null;
  let sawLast = false;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  const settleListeners = new Set<() => void>();

  function isComplete(): boolean {
    if (sawLast) {
      return true;
    }
    if (expectedCount !== null) {
      return registeredCount >= expectedCount;
    }
    return true;
  }

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
    if (settled || checkScheduled) {
      return;
    }
    checkScheduled = true;
    // Defer past the current tick so a burst of same-tick registrations - or an
    // early settle that precedes a sibling's registration - all land before we
    // declare the gate settled.
    scheduleCheck(() => {
      checkScheduled = false;
      if (!settled && armed && pendingCount === 0 && isComplete()) {
        openGate();
      }
    });
  }

  return {
    register(): () => void {
      if (settled) {
        return () => {};
      }
      armed = true;
      pendingCount += 1;
      registeredCount += 1;
      if (safetyTimer === null && typeof setTimeout === 'function') {
        safetyTimer = setTimeout(openGate, safetyTimeoutMs);
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
    },

    isSettled(): boolean {
      return settled || !armed;
    },

    whenSettled(signal?: AbortSignal): Promise<void> | null {
      if (settled || !armed) {
        return null;
      }
      return new Promise<void>((resolve, reject) => {
        const onSettle = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        function onAbort() {
          settleListeners.delete(onSettle);
          reject(new DOMException('Settle gate wait aborted', 'AbortError'));
        }
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException('Settle gate wait aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', onAbort);
        }
        settleListeners.add(onSettle);
      });
    },

    expect(count: number): void {
      expectedCount = count;
      scheduleSettleCheck();
    },

    markLast(): void {
      sawLast = true;
      scheduleSettleCheck();
    },

    reset(): void {
      pendingCount = 0;
      registeredCount = 0;
      armed = false;
      settled = false;
      checkScheduled = false;
      expectedCount = null;
      sawLast = false;
      if (safetyTimer !== null) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      settleListeners.clear();
    },
  };
}
