'use client';

import * as React from 'react';

/**
 * Channel protocol: a `state` push (a local change, or a `reply` catching a newcomer
 * up), or a newcomer's `request` for the current state.
 */
type CrossTabMessage<T> = { kind: 'request' } | { kind: 'state'; value: T; reply?: boolean };

/**
 * Mirrors a value you already own across same-origin browser tabs/windows through a
 * `BroadcastChannel` — so, for example, two Chrome split-view tabs of the same page
 * keep a live demo's edits in sync. The lower-level building block behind
 * `useCrossTabState`: use it when the state lives elsewhere (a reducer, a store, a
 * controller's own `useState`) and you only want to keep it in sync; reach for
 * `useCrossTabState` when you just want a synced `useState`.
 *
 * Pass a `key` (the channel name) that is identical across the tabs meant to share
 * state, and `null` to disable — no channel is opened, which also makes it SSR-safe
 * and gives the caller a clean off switch. `value` is broadcast whenever it changes
 * locally; an incoming remote value is handed to `applyRemote` WITHOUT being echoed
 * back, so two tabs can't ping-pong. Last write wins.
 *
 * A tab opened mid-edit catches up: on mount it asks peers for the current state, and
 * any tab already holding shared state replies. A fresh tab with nothing to share
 * stays quiet, so it can never blank out the asker; and once a tab holds shared state
 * it ignores further catch-up replies, keeping its own value authoritative.
 *
 * `value` must be structured-cloneable (plain data) — `postMessage` clones it.
 *
 * @param key The channel name; tabs sync only when their keys match. `null` disables syncing (and is SSR-safe).
 * @param value The current value, broadcast to other tabs whenever it changes.
 * @param applyRemote Called with a value received from another tab — apply it to your own state.
 */
export function useCrossTabMirror<T>(
  key: string | null,
  value: T,
  applyRemote: (value: T) => void,
): void {
  const channelRef = React.useRef<BroadcastChannel | null>(null);
  // The last value sent OR received on the channel. A local change whose value
  // differs from it is broadcast; a value we just applied from a remote message
  // matches it, so the broadcast effect below skips it — that's the echo guard.
  const lastSyncedRef = React.useRef<T>(value);
  // Whether this tab holds shared state (has broadcast a change or adopted a peer's).
  // Only a holder answers a newcomer's request, and a holder ignores catch-up replies.
  const primedRef = React.useRef(false);
  // Keep the latest `applyRemote` without re-opening the channel when an inline
  // callback identity changes between renders.
  const applyRemoteRef = React.useRef(applyRemote);
  React.useEffect(() => {
    applyRemoteRef.current = applyRemote;
  });

  // Open the channel (declared before the broadcast effect, so on mount the channel
  // exists by the time that effect first runs and skips the initial value).
  React.useEffect(() => {
    if (key === null || typeof BroadcastChannel === 'undefined') {
      return undefined;
    }
    const channel = new BroadcastChannel(key);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<CrossTabMessage<T>>) => {
      const message = event.data;
      if (message.kind === 'request') {
        // A tab just came online and asked for the current state. Only a tab that
        // holds shared state answers, so a fresh peer can't reply with a blank value.
        if (primedRef.current) {
          channel.postMessage({ kind: 'state', value: lastSyncedRef.current, reply: true });
        }
        return;
      }
      // A catch-up reply must not overwrite state we already hold (a fast local edit,
      // or an earlier reply we already took). A normal push — a peer's edit — always
      // wins (last write wins).
      if (message.reply && primedRef.current) {
        return;
      }
      primedRef.current = true;
      lastSyncedRef.current = message.value;
      applyRemoteRef.current(message.value);
    };
    // Ask any existing tab to send its current state, so a tab opened mid-edit catches
    // up instead of starting blank.
    channel.postMessage({ kind: 'request' });
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [key]);

  // Broadcast local changes. A value we just received (so it equals `lastSyncedRef`)
  // is not re-sent, which stops the echo.
  React.useEffect(() => {
    const channel = channelRef.current;
    if (!channel || Object.is(value, lastSyncedRef.current)) {
      return;
    }
    lastSyncedRef.current = value;
    primedRef.current = true;
    channel.postMessage({ kind: 'state', value });
  }, [value]);
}
