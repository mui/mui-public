'use client';

import * as React from 'react';
import { useCrossTabMirror } from './useCrossTabMirror';

/**
 * A `useState` whose value is mirrored across same-origin browser tabs/windows of the
 * same page through a `BroadcastChannel` — set it in one tab and the others follow.
 * For example, edit a live demo in a Chrome split view and both panes stay in sync.
 *
 * Drop-in for `useState`: returns `[value, setValue]` and supports lazy initializers
 * and functional updates. The extra `key` is the channel name — tabs sync only when
 * their keys match, and `null` disables syncing (also SSR-safe; no channel opens on
 * the server). State is EPHEMERAL: nothing is persisted, but a tab opened mid-session
 * catches up from a peer that already holds it instead of starting at `initialValue`.
 * For state that must survive a reload, use `useLocalStorageState` instead.
 *
 * `value` must be structured-cloneable (plain data) — `postMessage` clones it. When the
 * state lives elsewhere (a reducer, a store, a controller) and you only want to sync
 * it, use the lower-level {@link useCrossTabMirror} instead.
 *
 * @param key The channel name; tabs sync only when their keys match. `null` disables syncing (and is SSR-safe).
 * @param initialValue The initial state, or a lazy initializer — exactly like `useState`.
 */
export function useCrossTabState<T>(
  key: string | null,
  initialValue: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(initialValue);
  // `setValue` applies a peer's value directly; `useCrossTabMirror` broadcasts our
  // resolved `value` on change and skips echoing back what it just handed us.
  useCrossTabMirror(key, value, setValue);
  return [value, setValue];
}
