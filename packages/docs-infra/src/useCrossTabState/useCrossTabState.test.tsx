/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useCrossTabState } from './useCrossTabState';

/**
 * In-memory stand-in for `BroadcastChannel` (jsdom ships none). Instances created
 * with the same name reach each other — but never themselves — and the payload is
 * structured-cloned, exactly like the real thing.
 */
class FakeBroadcastChannel {
  static groups = new Map<string, Set<FakeBroadcastChannel>>();

  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public name: string) {
    const group = FakeBroadcastChannel.groups.get(name) ?? new Set();
    group.add(this);
    FakeBroadcastChannel.groups.set(name, group);
  }

  postMessage(data: unknown) {
    const cloned = structuredClone(data);
    for (const peer of FakeBroadcastChannel.groups.get(this.name) ?? []) {
      if (peer !== this) {
        peer.onmessage?.({ data: cloned });
      }
    }
  }

  close() {
    FakeBroadcastChannel.groups.get(this.name)?.delete(this);
  }

  static reset() {
    FakeBroadcastChannel.groups.clear();
  }
}

vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

afterEach(() => {
  FakeBroadcastChannel.reset();
});

/** A "tab": owns a value in state, mirrors it via the hook, and records remote applies. */
function mountTab(key: string | null) {
  const remoteApplies: unknown[] = [];
  const view = renderHook(() => {
    const [value, setValue] = React.useState<{ code: string }>({ code: 'init' });
    const applyRemote = React.useCallback((next: { code: string }) => {
      remoteApplies.push(next);
      setValue(next);
    }, []);
    useCrossTabState(key, value, applyRemote);
    return { value, setValue };
  });
  return { view, remoteApplies };
}

describe('useCrossTabState', () => {
  it('mirrors a local change to another tab on the same key', () => {
    const tabA = mountTab('demo-1');
    const tabB = mountTab('demo-1');

    act(() => tabA.view.result.current.setValue({ code: 'edited' }));

    expect(tabB.view.result.current.value).toEqual({ code: 'edited' });
    expect(tabB.remoteApplies).toEqual([{ code: 'edited' }]);
  });

  it('does not echo a value it received back to the sender (no ping-pong)', () => {
    const tabA = mountTab('demo-1');
    const tabB = mountTab('demo-1');

    act(() => tabA.view.result.current.setValue({ code: 'edited' }));

    // B applied + stored the value, but must not re-broadcast it — so A never sees
    // its own edit come back as a remote apply.
    expect(tabA.remoteApplies).toHaveLength(0);
    expect(tabB.remoteApplies).toHaveLength(1);
  });

  it('does not broadcast the initial value on mount', () => {
    const tabA = mountTab('demo-1');
    mountTab('demo-1'); // mounts after A — must not receive A's initial value

    const tabB = mountTab('demo-1');
    expect(tabB.remoteApplies).toHaveLength(0);
    expect(tabA.remoteApplies).toHaveLength(0);
  });

  it('keeps tabs on different keys independent', () => {
    const tabA = mountTab('demo-1');
    const tabB = mountTab('demo-2');

    act(() => tabA.view.result.current.setValue({ code: 'edited' }));

    expect(tabB.view.result.current.value).toEqual({ code: 'init' });
    expect(tabB.remoteApplies).toHaveLength(0);
  });

  it('disables syncing when the key is null', () => {
    const tabA = mountTab(null);
    const tabB = mountTab(null);

    act(() => tabA.view.result.current.setValue({ code: 'edited' }));

    expect(tabB.view.result.current.value).toEqual({ code: 'init' });
    expect(tabB.remoteApplies).toHaveLength(0);
  });

  it('relays successive edits, last write wins', () => {
    const tabA = mountTab('demo-1');
    const tabB = mountTab('demo-1');

    act(() => tabA.view.result.current.setValue({ code: 'one' }));
    act(() => tabA.view.result.current.setValue({ code: 'two' }));

    expect(tabB.view.result.current.value).toEqual({ code: 'two' });
    expect(tabB.remoteApplies).toEqual([{ code: 'one' }, { code: 'two' }]);
  });

  it('hands the current state to a tab that joins after an edit', () => {
    const tabA = mountTab('demo-1');
    act(() => tabA.view.result.current.setValue({ code: 'edited' }));

    // B opens after the edit — on mount it requests state, A (a holder) replies.
    const tabB = mountTab('demo-1');

    expect(tabB.view.result.current.value).toEqual({ code: 'edited' });
    expect(tabB.remoteApplies).toEqual([{ code: 'edited' }]);
  });

  it('forwards a catch-up through a chain after the original editor leaves', () => {
    const tabA = mountTab('demo-1');
    act(() => tabA.view.result.current.setValue({ code: 'edited' }));

    const tabB = mountTab('demo-1');
    expect(tabB.view.result.current.value).toEqual({ code: 'edited' }); // B caught up from A
    tabA.view.unmount(); // the original editor closes; B now holds the shared state

    const tabC = mountTab('demo-1');
    expect(tabC.view.result.current.value).toEqual({ code: 'edited' }); // C caught up from B
  });

  it('does not answer a request from a tab that never shared state', () => {
    mountTab('demo-1'); // fresh, never edits — has nothing to share
    const tabB = mountTab('demo-1');

    // B's catch-up request goes unanswered, so it keeps its own initial value.
    expect(tabB.view.result.current.value).toEqual({ code: 'init' });
    expect(tabB.remoteApplies).toHaveLength(0);
  });
});
