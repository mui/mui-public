// Document-level subscriber registry for `<details>` toggle events. Each
// `<Pre>` would otherwise install its own capture-phase listener; on docs
// pages with many code blocks that's N listeners all firing on every
// toggle anywhere in the document. A single shared listener fans out to
// the relevant subscribers instead.
//
// Subscribers register their `<pre>` element so the dispatcher can do a
// single `target.contains(pre)` ancestry check per subscriber and skip
// the nudge entirely for unrelated toggles — no JS-side work runs in
// `<Pre>` instances whose subtree the toggle didn't touch.
//
// The value is a Set rather than a single function so the registry
// tolerates the (unlikely but possible) case where two `<Pre>` instances
// transiently share the same DOM node — e.g. a fast unmount/remount
// where the next mount's setup runs before the prior mount's cleanup.
// Without the set the second subscribe would silently overwrite the
// first nudge and a single unsubscribe would orphan the other instance.
type ToggleNudge = () => void;
const toggleSubscribers = new Map<HTMLElement, Set<ToggleNudge>>();
let toggleListenerAttached = false;
let sharedToggleListener: ((event: Event) => void) | null = null;

// Reconcile the document-level capture listener with the current
// subscriber set. Idempotent: callable from any code path (including
// test teardowns that want to defensively assert no leaked listener)
// without risk of leaving the document in a half-attached state.
function syncToggleListener(): void {
  if (typeof document === 'undefined') {
    if (toggleSubscribers.size === 0) {
      sharedToggleListener = null;
      toggleListenerAttached = false;
    }
    return;
  }
  if (toggleSubscribers.size === 0) {
    if (toggleListenerAttached && sharedToggleListener) {
      document.removeEventListener('toggle', sharedToggleListener, true);
    }
    sharedToggleListener = null;
    toggleListenerAttached = false;
    return;
  }
  if (!toggleListenerAttached || !sharedToggleListener) {
    sharedToggleListener = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      // Snapshot before iterating: a nudge may synchronously trigger an
      // unmount that mutates `toggleSubscribers` mid-dispatch. Iterating
      // a snapshot keeps dispatch order independent of subscriber
      // mutations and matches the snapshot pattern used by
      // `sweepDetachedFrames` / `nudgeFrameObserver`.
      Array.from(toggleSubscribers).forEach(([preNode, nudges]) => {
        // Centralized ancestry filter: only nudge subscribers whose `<pre>`
        // is a descendant of the toggled element. Done here (rather than
        // in each subscriber) so unrelated toggles short-circuit before
        // any subscriber-side work runs.
        if (!target.contains(preNode)) {
          return;
        }
        Array.from(nudges).forEach((nudge) => nudge());
      });
    };
    document.addEventListener('toggle', sharedToggleListener, true);
    toggleListenerAttached = true;
  }
}

export function subscribeToggleNudge(preNode: HTMLElement, nudge: ToggleNudge): () => void {
  // Defensive SSR no-op: there is no `document` to attach a listener to,
  // and module state in Node persists across requests — leaking a
  // subscriber here would also leak the closure it captures. `useEffect`
  // already won't run on the server, but make the contract explicit so
  // any future non-effect caller can't strand entries in the registry.
  if (typeof document === 'undefined') {
    return () => {};
  }
  let nudges = toggleSubscribers.get(preNode);
  if (!nudges) {
    nudges = new Set();
    toggleSubscribers.set(preNode, nudges);
  }
  nudges.add(nudge);
  syncToggleListener();
  return () => {
    const existing = toggleSubscribers.get(preNode);
    if (existing) {
      existing.delete(nudge);
      if (existing.size === 0) {
        toggleSubscribers.delete(preNode);
      }
    }
    syncToggleListener();
  };
}
