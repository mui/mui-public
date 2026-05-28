/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useCoordinated } from './useCoordinated';
import {
  resetCoordinatorsForTests,
  getCoordinatorStatsForTests,
} from './coordinatePreference.testUtils';

afterEach(() => {
  resetCoordinatorsForTests();
});

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function useStateTuple<T>(initial: T) {
  const [value, setValue] = React.useState<T>(initial);
  return [value, setValue] as [T, React.Dispatch<React.SetStateAction<T>>];
}

describe('useCoordinated', () => {
  describe('null channelKey (disabled)', () => {
    it('behaves as a transparent pass-through', () => {
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string>(tuple, {
          channelKey: null,
          causesLayoutShift: () => true,
        });
      });
      expect(result.current[0]).toBe('a');
      expect(result.current[2].pendingValue).toBe('a');
      expect(result.current[2].isCoordinating).toBe(false);
      act(() => {
        result.current[1]('b');
      });
      expect(result.current[0]).toBe('b');
      expect(result.current[2].pendingValue).toBe('b');
    });

    it('composes synchronous functional updaters like a transparent pass-through', () => {
      const { result } = renderHook(() => {
        const tuple = useStateTuple<number>(0);
        return useCoordinated<number>(tuple, {
          channelKey: null,
          causesLayoutShift: () => true,
        });
      });
      // Two synchronous functional updaters must compose to +2,
      // matching the behavior of a plain `useState` setter. Without
      // tracking the latest target across calls, the second updater
      // would read the stale pre-render value and collapse to +1.
      act(() => {
        result.current[1]((prev) => prev + 1);
        result.current[1]((prev) => prev + 1);
      });
      expect(result.current[0]).toBe(2);
    });
  });

  describe('originator flow', () => {
    it('flips pendingValue immediately and committedValue after preload settles', async () => {
      const onCommit = vi.fn();
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string, string>(tuple, {
          channelKey: 'ch-originator-1',
          causesLayoutShift: () => true,
          preload: async (target) => `pre-${target}`,
          onCommit,
        });
      });
      act(() => {
        result.current[1]('b');
      });
      expect(result.current[2].pendingValue).toBe('b');
      expect(result.current[0]).toBe('a');
      expect(result.current[2].isCoordinating).toBe(true);
      await flushMicrotasks();
      expect(result.current[0]).toBe('b');
      expect(result.current[2].isCoordinating).toBe(false);
      expect(onCommit).toHaveBeenCalledWith('b', 'pre-b');
    });

    it('writes back through underlying setValue on commit', async () => {
      const writes: string[] = [];
      const { result } = renderHook(() => {
        const [value, setValue] = React.useState('a');
        const wrapped = React.useCallback(
          (action: React.SetStateAction<string>) => {
            const resolved =
              typeof action === 'function' ? (action as (prev: string) => string)(value) : action;
            writes.push(resolved);
            setValue(action);
          },
          [value],
        );
        return useCoordinated<string>([value, wrapped], {
          channelKey: 'ch-originator-2',
          causesLayoutShift: () => true,
        });
      });
      act(() => {
        result.current[1]('b');
      });
      await flushMicrotasks();
      expect(writes).toEqual(['b']);
    });

    it('lazy path commits per-peer without barrier', async () => {
      const order: string[] = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string, string>(tuple, {
          channelKey: 'ch-low',
          causesLayoutShift: () => false,
          preload: async (target) => {
            order.push(`preload-${target}`);
            return target;
          },
          onCommit: (target) => order.push(`commit-${target}`),
        });
      });
      // Mount-time with a matching initial value runs no preload
      // (see receiver flow); assert on the user-triggered cycle
      // directly.
      await flushMicrotasks();
      expect(order).toEqual([]);
      act(() => {
        result.current[1]('b');
      });
      await flushMicrotasks();
      expect(order).toEqual(['preload-b', 'commit-b']);
      expect(result.current[0]).toBe('b');
    });

    it('superseding announcements cancels the previous in-flight one', async () => {
      const commits: string[] = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string, string>(tuple, {
          channelKey: 'ch-super',
          causesLayoutShift: () => true,
          preload: async (target, signal) => {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 30);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            });
            return target;
          },
          onCommit: (target) => commits.push(target),
        });
      });
      act(() => {
        result.current[1]('b');
      });
      act(() => {
        result.current[1]('c');
      });
      expect(result.current[2].pendingValue).toBe('c');
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 60);
        });
      });
      expect(commits).toEqual(['c']);
      expect(result.current[0]).toBe('c');
    });

    it('functional updater reads the latest in-flight target so rapid clicks compose', async () => {
      const commits: number[] = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<number>(0);
        return useCoordinated<number, number>(tuple, {
          channelKey: 'ch-functional-updater',
          causesLayoutShift: () => true,
          // Async preload keeps the first announce in flight so the
          // second one can actually supersede it; without a preload
          // the first barrier would resolve synchronously and both
          // would commit independently.
          preload: (target, signal) =>
            new Promise<number>((resolve, reject) => {
              const timer = setTimeout(() => resolve(target), 20);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            }),
          onCommit: (target) => commits.push(target),
        });
      });
      act(() => {
        result.current[1]((prev) => prev + 1);
        result.current[1]((prev) => prev + 1);
      });
      expect(result.current[2].pendingValue).toBe(2);
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        });
      });
      // Only the final supersede commits — and crucially the second
      // updater read the in-flight target (1), not the stale render
      // value (0), so we ended at 2 not 1.
      expect(commits).toEqual([2]);
      expect(result.current[0]).toBe(2);
    });

    it("aborts the previous preload's signal when superseded", async () => {
      const signals: AbortSignal[] = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string, string>(tuple, {
          channelKey: 'ch-abort-signal',
          causesLayoutShift: () => true,
          preload: async (target, signal) => {
            signals.push(signal);
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 60);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            });
            return target;
          },
        });
      });
      // Mount-time with a matching initial value runs no preload
      // (see receiver flow); we'll only observe the supersede-pair.
      await flushMicrotasks();
      expect(signals).toEqual([]);
      act(() => {
        result.current[1]('b');
      });
      // Let the first preload actually start so its signal is recorded.
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        result.current[1]('c');
      });
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 80);
        });
      });
      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it('setValue to the currently committed value still runs onCommit', async () => {
      const commits: string[] = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string>(tuple, {
          channelKey: 'ch-noop-setvalue',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(target),
        });
      });
      await flushMicrotasks();
      commits.length = 0;
      act(() => {
        result.current[1]('a');
      });
      await flushMicrotasks();
      expect(commits).toEqual(['a']);
      expect(result.current[0]).toBe('a');
    });

    it('preload rejection still commits with preloaded=undefined', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const calls: Array<[string, string | undefined]> = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string, string>(tuple, {
          channelKey: 'ch-preload-reject',
          causesLayoutShift: () => true,
          preload: async () => {
            throw new Error('boom');
          },
          onCommit: (target, preloaded) => calls.push([target, preloaded]),
        });
      });
      act(() => {
        result.current[1]('b');
      });
      await flushMicrotasks();
      expect(calls).toEqual([['b', undefined]]);
      expect(result.current[0]).toBe('b');
      errorSpy.mockRestore();
    });
  });

  describe('receiver flow (external underlying changes)', () => {
    it("does not re-coordinate when the underlying state echoes the originator's own write back", async () => {
      const commits: string[] = [];
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string>(tuple, {
          channelKey: 'ch-echo',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(target),
        });
      });
      await flushMicrotasks();
      commits.length = 0;
      act(() => {
        result.current[1]('b');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      // Originator's write triggers an underlying-state update which
      // re-renders the hook with the new `underlyingValue`. The
      // receiver effect must recognize that as an echo of our own
      // write and not start a second coordination cycle.
      expect(commits).toEqual(['b']);
      expect(result.current[0]).toBe('b');
    });

    it('coordinates a later external write that round-trips back to a previously self-written value', async () => {
      const commits: string[] = [];
      let externalSet: React.Dispatch<React.SetStateAction<string>> | null = null;
      const { result } = renderHook(() => {
        const [value, set] = React.useState<string>('a');
        externalSet = set;
        return useCoordinated<string>([value, set], {
          channelKey: 'ch-echo-stale',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(target),
        });
      });
      await flushMicrotasks();
      commits.length = 0;
      // Local write → 'b'. The echo of the underlying update must
      // not be treated as a persistent sentinel — a later external
      // write back to the same value still needs to coordinate.
      act(() => {
        result.current[1]('b');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      // External moves the underlying to 'c'.
      act(() => {
        externalSet!('c');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      // External moves the underlying back to 'b' — this is a fresh
      // change from outside the hook, not an echo of step 1.
      act(() => {
        externalSet!('b');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      expect(commits).toEqual(['b', 'c', 'b']);
      expect(result.current[0]).toBe('b');
    });

    it('coordinates a later external round-trip even after a no-op originator write left the sentinel armed', async () => {
      const commits: string[] = [];
      let externalSet: React.Dispatch<React.SetStateAction<string>> | null = null;
      const { result } = renderHook(() => {
        const [value, set] = React.useState<string>('a');
        externalSet = set;
        return useCoordinated<string>([value, set], {
          channelKey: 'ch-echo-noop',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(target),
        });
      });
      await flushMicrotasks();
      commits.length = 0;
      // Local "write" to the already-committed value. The originator
      // path still runs coordination and arms the self-write
      // sentinel, but the underlying `useState` setter no-ops (no
      // re-render), so the echo guard never has a chance to consume
      // the sentinel.
      act(() => {
        result.current[1]('a');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      // External moves the underlying to 'b'.
      act(() => {
        externalSet!('b');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      // External moves the underlying back to 'a'. Without the
      // stale-sentinel cleanup, this would be misclassified as an
      // echo of the original no-op write and dropped.
      act(() => {
        externalSet!('a');
      });
      await flushMicrotasks();
      await flushMicrotasks();
      expect(commits).toEqual(['a', 'b', 'a']);
      expect(result.current[0]).toBe('a');
    });

    it('external change matching the in-flight target is deduplicated', async () => {
      const commits: string[] = [];
      let externalSet: React.Dispatch<React.SetStateAction<string>> | null = null;
      const { result } = renderHook(() => {
        const [value, set] = React.useState<string>('a');
        externalSet = set;
        return useCoordinated<string, string>([value, set], {
          channelKey: 'ch-external-same',
          causesLayoutShift: () => true,
          preload: (target, signal) =>
            new Promise<string>((resolve, reject) => {
              const timer = setTimeout(() => resolve(target), 30);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            }),
          onCommit: (target) => commits.push(target),
        });
      });
      act(() => {
        result.current[1]('b');
      });
      act(() => {
        externalSet!('b');
      });
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 60);
        });
      });
      // Both signaled the same target, so we commit it exactly once.
      expect(commits).toEqual(['b']);
      expect(result.current[0]).toBe('b');
    });

    it('external change to a different target during in-flight supersedes', async () => {
      const commits: string[] = [];
      let externalSet: React.Dispatch<React.SetStateAction<string>> | null = null;
      const { result } = renderHook(() => {
        const [value, set] = React.useState<string>('a');
        externalSet = set;
        return useCoordinated<string, string>([value, set], {
          channelKey: 'ch-external-diff',
          causesLayoutShift: () => true,
          preload: (target, signal) =>
            new Promise<string>((resolve, reject) => {
              const timer = setTimeout(() => resolve(target), 30);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            }),
          onCommit: (target) => commits.push(target),
        });
      });
      act(() => {
        result.current[1]('b');
      });
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        externalSet!('c');
      });
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 80);
        });
      });
      expect(commits).toEqual(['c']);
      expect(result.current[0]).toBe('c');
    });

    it('coordinates external changes even when no peer originates through coordinatedSetValue', async () => {
      // Regression: previously, the receiver flow skipped the barrier
      // until some peer called the hook's returned `setValue` (which
      // flipped a channel-wide `hasEverAnnounced` flag). In the
      // common "parent owns state, children are pure subscribers"
      // pattern the children never originate writes, so the gate
      // never tripped and every external change bypassed the barrier
      // forever. The fix is to route every receiver-effect run
      // through the full coordination cycle — mount included — so
      // external changes always engage the barrier.
      const commits: string[] = [];
      let externalSet: React.Dispatch<React.SetStateAction<string>> | null = null;
      function useHarness() {
        const [shared, setShared] = React.useState<string>('a');
        React.useEffect(() => {
          externalSet = setShared;
          return () => {
            externalSet = null;
          };
        }, []);
        // Two pure subscriber peers — neither calls its returned
        // setValue. All writes come from the parent's `setShared`.
        const r1 = useCoordinated<string, string>([shared, setShared], {
          channelKey: 'ch-parent-owns-state',
          peerId: 'p1',
          causesLayoutShift: () => true,
          preload: async (target) => target,
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        const r2 = useCoordinated<string, string>([shared, setShared], {
          channelKey: 'ch-parent-owns-state',
          peerId: 'p2',
          causesLayoutShift: () => true,
          preload: async (target) => target,
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        return { r1, r2 };
      }
      const { result } = renderHook(useHarness);
      // Mount-time with matching initial values runs no preloads
      // and fires no commits. Preload only runs when the value
      // actually changes — either from a consumer setter call or
      // from an external write (hydration, parent state update).
      await flushMicrotasks();
      expect(commits).toEqual([]);
      // External change after mount: both peers see the new value
      // simultaneously and must coordinate so their `onCommit` hooks
      // fire inside the same barrier.
      act(() => {
        externalSet!('b');
      });
      await flushMicrotasks();
      expect(commits.slice().sort()).toEqual(['p1-b', 'p2-b']);
      expect(result.current.r1[0]).toBe('b');
      expect(result.current.r2[0]).toBe('b');
      // And a second change still coordinates.
      commits.length = 0;
      act(() => {
        externalSet!('c');
      });
      await flushMicrotasks();
      expect(commits.slice().sort()).toEqual(['p1-c', 'p2-c']);
    });
  });

  describe('cross-peer barrier (same channel, same tab)', () => {
    it('two peers commit together when both barrier-path', async () => {
      const commits: string[] = [];
      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string>(t1, {
          channelKey: 'ch-pair',
          peerId: 'p1',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        const r2 = useCoordinated<string>(t2, {
          channelKey: 'ch-pair',
          peerId: 'p2',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        return { r1, r2 };
      }
      const { result } = renderHook(useHarness);
      await flushMicrotasks();
      commits.length = 0;
      act(() => {
        result.current.r1[1]('b');
        result.current.r2[1]('b');
      });
      await flushMicrotasks();
      expect(commits).toHaveLength(2);
      expect(result.current.r1[0]).toBe('b');
      expect(result.current.r2[0]).toBe('b');
    });

    it('does not wait for a sibling that is already committed to the target', async () => {
      const commits: string[] = [];

      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('b');
        const r1 = useCoordinated<string>(t1, {
          channelKey: 'ch-already-target',
          peerId: 'p1',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        useCoordinated<string>(t2, {
          channelKey: 'ch-already-target',
          peerId: 'p2',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        return { r1 };
      }

      const { result } = renderHook(useHarness);

      await flushMicrotasks();
      commits.length = 0;

      act(() => {
        result.current.r1[1]('b');
      });

      await flushMicrotasks();

      expect(commits).toEqual(['p1-b']);
      expect(result.current.r1[0]).toBe('b');
    });

    it('originator notifies a sibling on the same channel so the barrier resolves without waiting for the underlying value echo', async () => {
      // Regression: previously a sibling peer with independent
      // underlying state would never join the originator's barrier
      // (the originator defers `setUnderlyingValue` until commit, so
      // the sibling's underlying primitive never echoes the target
      // back), and the barrier would hang until `ultimateTimeoutMs`.
      const commits: string[] = [];
      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string>(t1, {
          channelKey: 'ch-notify',
          peerId: 'p1',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p1-${target}`),
          ultimateTimeoutMs: 200,
        });
        const r2 = useCoordinated<string>(t2, {
          channelKey: 'ch-notify',
          peerId: 'p2',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p2-${target}`),
          ultimateTimeoutMs: 200,
        });
        return { r1, r2 };
      }
      const { result } = renderHook(useHarness);
      await flushMicrotasks();
      commits.length = 0;
      act(() => {
        // Only the originator clicks. The sibling has no idea about
        // the target until the coordinator fans the announce out.
        result.current.r1[1]('b');
      });
      await flushMicrotasks();
      expect(commits).toEqual(['p1-b', 'p2-b']);
      expect(result.current.r1[0]).toBe('b');
      expect(result.current.r2[0]).toBe('b');
    });

    it("sibling notification does not cancel the originator's in-flight barrier", async () => {
      // The notification fans back out as each peer joins. When the
      // notification re-enters the originator, the dedupe must skip
      // the call instead of cancelling and re-opening the barrier
      // (which historically caused infinite recursion or duplicate
      // commits).
      const commits: string[] = [];
      const preloads: string[] = [];
      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string, string>(t1, {
          channelKey: 'ch-no-recurse',
          peerId: 'p1',
          causesLayoutShift: () => true,
          preload: async (target) => {
            preloads.push(`p1-${target}`);
            return `pre-${target}`;
          },
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        const r2 = useCoordinated<string, string>(t2, {
          channelKey: 'ch-no-recurse',
          peerId: 'p2',
          causesLayoutShift: () => true,
          preload: async (target) => {
            preloads.push(`p2-${target}`);
            return `pre-${target}`;
          },
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        return { r1, r2 };
      }
      const { result } = renderHook(useHarness);
      await flushMicrotasks();
      preloads.length = 0;
      commits.length = 0;
      act(() => {
        result.current.r1[1]('b');
      });
      await flushMicrotasks();
      expect(preloads).toEqual(['p1-b', 'p2-b']);
      expect(commits).toEqual(['p1-b', 'p2-b']);
    });

    it('three peers all commit together when a single originator broadcasts', async () => {
      const commits: string[] = [];
      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const t3 = useStateTuple<string>('a');
        const r1 = useCoordinated<string>(t1, {
          channelKey: 'ch-trio',
          peerId: 'p1',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        useCoordinated<string>(t2, {
          channelKey: 'ch-trio',
          peerId: 'p2',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        useCoordinated<string>(t3, {
          channelKey: 'ch-trio',
          peerId: 'p3',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p3-${target}`),
        });
        return { r1 };
      }
      const { result } = renderHook(useHarness);
      await flushMicrotasks();
      commits.length = 0;
      act(() => {
        result.current.r1[1]('b');
      });
      await flushMicrotasks();
      expect(commits.slice().sort()).toEqual(['p1-b', 'p2-b', 'p3-b']);
    });

    it('mixed barrier + lazy peers on the same channel both commit without hanging the barrier', async () => {
      const commits: string[] = [];
      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string>(t1, {
          channelKey: 'ch-mixed',
          peerId: 'p1',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        useCoordinated<string>(t2, {
          channelKey: 'ch-mixed',
          peerId: 'p2',
          causesLayoutShift: () => false,
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        return { r1 };
      }
      const { result } = renderHook(useHarness);
      await flushMicrotasks();
      commits.length = 0;
      act(() => {
        result.current.r1[1]('b');
      });
      await flushMicrotasks();
      // Lazy peer's deferred release fires one macrotask after the
      // barrier's batched commit, so we need to pump the timer queue.
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      });
      await flushMicrotasks();
      // p1 routes to its barrier, p2 routes to the lazy path; both
      // commit. The barrier commit lands first, then the lazy peer's
      // commit lands in the render after — never beating the
      // layout-shifting sibling to the DOM.
      expect(commits).toContain('p1-b');
      expect(commits).toContain('p2-b');
      expect(commits.indexOf('p1-b')).toBeLessThan(commits.indexOf('p2-b'));
    });

    it("an external underlying change on one peer notifies siblings via the channel (not just via each peer's own receiver effect)", async () => {
      // Real-world: a cross-tab storage echo lands on every peer
      // independently, but only one of them needs to *originate* the
      // coordination — the sibling-announce notification then pulls
      // the rest into the same barrier rather than each peer racing
      // to open its own.
      const commits: string[] = [];
      let externalSet1: React.Dispatch<React.SetStateAction<string>> | null = null;
      function useHarness() {
        const [v1, set1] = React.useState<string>('a');
        React.useEffect(() => {
          externalSet1 = set1;
          return () => {
            externalSet1 = null;
          };
        }, [set1]);
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string>([v1, set1], {
          channelKey: 'ch-receiver-notify',
          peerId: 'p1',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p1-${target}`),
        });
        const r2 = useCoordinated<string>(t2, {
          channelKey: 'ch-receiver-notify',
          peerId: 'p2',
          causesLayoutShift: () => true,
          onCommit: (target) => commits.push(`p2-${target}`),
        });
        // Prime `hasEverAnnounced` so the receiver flow goes through
        // coordination rather than the first-render fast path.
        return { r1, r2 };
      }
      const { result } = renderHook(useHarness);
      // Prime the channel with a real announcement so the receiver
      // path doesn't hit the hydration shortcut.
      act(() => {
        result.current.r1[1]('a');
      });
      await flushMicrotasks();
      commits.length = 0;
      // External change on peer 1 only — peer 2's underlying does NOT
      // change (independent state). Without the sibling-announce
      // notification, peer 2 would never learn about the new target.
      act(() => {
        externalSet1!('b');
      });
      await flushMicrotasks();
      expect(commits.slice().sort()).toEqual(['p1-b', 'p2-b']);
    });
  });

  describe('lifecycle', () => {
    it('unmount unregisters the peer and disposes the channel', () => {
      const { unmount } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string>(tuple, {
          channelKey: 'ch-lifecycle',
          causesLayoutShift: () => true,
        });
      });
      expect(getCoordinatorStatsForTests().totalPeers).toBe(1);
      unmount();
      expect(getCoordinatorStatsForTests().channelCount).toBe(0);
    });

    it("an unmounting peer mid-barrier doesn't hang the sibling barrier", async () => {
      const commits: string[] = [];
      function useHarness({ includeB }: { includeB: boolean }) {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string, string>(t1, {
          channelKey: 'ch-unmount-mid',
          peerId: 'p1',
          causesLayoutShift: () => true,
          preload: async (target, signal) => {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 40);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            });
            return target;
          },
          onCommit: (target) => commits.push(`p1-${target}`),
          ultimateTimeoutMs: 500,
        });
        useCoordinated<string, string>(t2, {
          channelKey: includeB ? 'ch-unmount-mid' : null,
          peerId: 'p2',
          causesLayoutShift: () => true,
          preload: async (target, signal) => {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 200);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            });
            return target;
          },
          onCommit: (target) => commits.push(`p2-${target}`),
          ultimateTimeoutMs: 500,
        });
        return { r1 };
      }
      const { result, rerender } = renderHook(useHarness, {
        initialProps: { includeB: true },
      });
      act(() => {
        result.current.r1[1]('b');
      });
      // Let both peers join the barrier and start their preloads.
      await act(async () => {
        await Promise.resolve();
      });
      // Detach p2 from the channel mid-flight.
      rerender({ includeB: false });
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 80);
        });
      });
      // p1 should commit on its own preload finishing, not on the
      // ultimate timeout — p2's slow preload no longer gates the
      // barrier because p2 left the channel.
      expect(commits).toContain('p1-b');
      expect(result.current.r1[0]).toBe('b');
    });
  });

  describe('channelKey reconfiguration', () => {
    it('moving from one channel to another re-registers the peer on the new channel', () => {
      const { rerender } = renderHook(
        ({ channelKey }: { channelKey: string }) => {
          const tuple = useStateTuple<string>('a');
          return useCoordinated<string>(tuple, {
            channelKey,
            peerId: 'p-move',
            causesLayoutShift: () => true,
          });
        },
        { initialProps: { channelKey: 'ch-move-a' } },
      );
      expect(getCoordinatorStatsForTests().channelCount).toBe(1);
      expect(getCoordinatorStatsForTests().totalPeers).toBe(1);
      rerender({ channelKey: 'ch-move-b' });
      // Old channel disposed (no peers left), new one created.
      expect(getCoordinatorStatsForTests().channelCount).toBe(1);
      expect(getCoordinatorStatsForTests().totalPeers).toBe(1);
    });

    it('switching from a real channel to null leaves the channel and disposes it', () => {
      const { rerender } = renderHook(
        ({ channelKey }: { channelKey: string | null }) => {
          const tuple = useStateTuple<string>('a');
          return useCoordinated<string>(tuple, {
            channelKey,
            peerId: 'p-detach',
            causesLayoutShift: () => true,
          });
        },
        { initialProps: { channelKey: 'ch-detach' as string | null } },
      );
      expect(getCoordinatorStatsForTests().totalPeers).toBe(1);
      rerender({ channelKey: null });
      expect(getCoordinatorStatsForTests().channelCount).toBe(0);
    });

    it('switching from null to a real channel registers the peer fresh', () => {
      const { rerender } = renderHook(
        ({ channelKey }: { channelKey: string | null }) => {
          const tuple = useStateTuple<string>('a');
          return useCoordinated<string>(tuple, {
            channelKey,
            peerId: 'p-attach',
            causesLayoutShift: () => true,
          });
        },
        { initialProps: { channelKey: null as string | null } },
      );
      expect(getCoordinatorStatsForTests().channelCount).toBe(0);
      rerender({ channelKey: 'ch-attach' });
      expect(getCoordinatorStatsForTests().totalPeers).toBe(1);
      expect(getCoordinatorStatsForTests().channelCount).toBe(1);
    });
  });

  describe('extras / state surfaces', () => {
    it('pendingValue flips synchronously while committedValue lags behind the barrier', async () => {
      let resolvePreload: (() => void) | null = null;
      const { result } = renderHook(() => {
        const tuple = useStateTuple<string>('a');
        return useCoordinated<string, string>(tuple, {
          channelKey: 'ch-pending-timing',
          causesLayoutShift: () => true,
          preload: () =>
            new Promise<string>((resolve) => {
              resolvePreload = () => resolve('preloaded');
            }),
        });
      });
      // Before any setValue: both are at 'a'.
      expect(result.current[0]).toBe('a');
      expect(result.current[2].pendingValue).toBe('a');

      act(() => {
        result.current[1]('b');
      });
      // Sync after setValue: pendingValue flipped, committedValue lags.
      expect(result.current[2].pendingValue).toBe('b');
      expect(result.current[0]).toBe('a');
      expect(result.current[2].isCoordinating).toBe(true);

      await act(async () => {
        resolvePreload!();
        await Promise.resolve();
      });
      // After preload resolves and barrier commits: both at 'b'.
      expect(result.current[0]).toBe('b');
      expect(result.current[2].pendingValue).toBe('b');
      expect(result.current[2].isCoordinating).toBe(false);
    });

    it('isWaitingForPeers fires only on the originator after gracePeriodMs', async () => {
      const states: Array<{ peer: string; waiting: boolean }> = [];
      function useHarness() {
        const t1 = useStateTuple<string>('a');
        const t2 = useStateTuple<string>('a');
        const r1 = useCoordinated<string, string>(t1, {
          channelKey: 'ch-waiting',
          peerId: 'p1',
          causesLayoutShift: () => true,
          preload: (target, signal) =>
            new Promise<string>((resolve, reject) => {
              const timer = setTimeout(() => resolve(target), 150);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            }),
          gracePeriodMs: 30,
          ultimateTimeoutMs: 1000,
        });
        const r2 = useCoordinated<string, string>(t2, {
          channelKey: 'ch-waiting',
          peerId: 'p2',
          causesLayoutShift: () => true,
          preload: (target, signal) =>
            new Promise<string>((resolve, reject) => {
              const timer = setTimeout(() => resolve(target), 150);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            }),
          gracePeriodMs: 30,
          ultimateTimeoutMs: 1000,
        });
        return { r1, r2 };
      }
      const { result } = renderHook(useHarness);
      act(() => {
        result.current.r1[1]('b');
      });
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 60);
        });
      });
      states.push({ peer: 'p1', waiting: result.current.r1[2].isWaitingForPeers });
      states.push({ peer: 'p2', waiting: result.current.r2[2].isWaitingForPeers });
      // Originator p1 (the one that opened the barrier) flips
      // isWaitingForPeers after gracePeriodMs; the non-originating
      // sibling p2 stays quiet.
      expect(states).toEqual([
        { peer: 'p1', waiting: true },
        { peer: 'p2', waiting: false },
      ]);
      // Barrier preloads serialize across sibling peers, so p2's
      // 150ms preload only begins after p1's settles (~150ms). Wait
      // long enough for both to complete before asserting the
      // barrier resolved and `isWaitingForPeers` cleared.
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 260);
        });
      });
      expect(result.current.r1[2].isWaitingForPeers).toBe(false);
      expect(result.current.r1[0]).toBe('b');
    });
  });
});
