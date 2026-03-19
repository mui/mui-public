import * as React from 'react';
import { expect, it } from 'vitest';
import * as ReactDOMClient from 'react-dom/client'; // aliased to react-dom/profiling by Vite
import * as ReactDOM from 'react-dom';
import type { RenderEvent } from './types';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

export type { RenderEvent } from './types';

function BenchProfiler({
  captures,
  children,
}: {
  captures: RenderEvent[];
  children: React.ReactNode;
}) {
  const onRender = React.useCallback(
    (
      id: string,
      phase: 'mount' | 'update' | 'nested-update',
      actualDuration: number,
      _baseDuration: number,
      startTime: number,
    ) => {
      captures.push({ id, phase, actualDuration, startTime });
    },
    [captures],
  );

  return (
    <React.Profiler id="bench" onRender={onRender}>
      {children}
    </React.Profiler>
  );
}

// Double GC: the first pass collects garbage, the second catches weak refs
// and prevent leaking into the next iteration.
function forceGC() {
  if (typeof window.gc === 'function') {
    window.gc();
    window.gc();
  }
}

// Flush pending microtasks and React cleanup effects (e.g. from a previous unmount)
// so they don't interfere with the next iteration's timing.
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface BenchmarkOptions {
  runs?: number;
  warmupRuns?: number;
  afterEach?: () => Promise<void> | void;
}

export function benchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: (() => Promise<void> | void) | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
) {
  const interaction = typeof interactionOrOptions === 'function' ? interactionOrOptions : undefined;
  const options = typeof interactionOrOptions === 'object' ? interactionOrOptions : maybeOptions;

  it(name, async ({ task }) => {
    const runs = options?.runs ?? 20;
    const warmupRuns = options?.warmupRuns ?? 10;

    const totalRuns = warmupRuns + runs;
    const iterations: RenderEvent[][] = [];

    if (typeof window.gc !== 'function') {
      console.warn(
        'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
      );
    }

    for (let i = 0; i < totalRuns; i += 1) {
      const isWarmup = i < warmupRuns;

      // Drain event loop from previous unmount, then double GC for thorough cleanup
      // eslint-disable-next-line no-await-in-loop
      await settle();
      forceGC();

      const captures: RenderEvent[] = [];
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      ReactDOM.flushSync(() => {
        root.render(<BenchProfiler captures={captures}>{renderFn()}</BenchProfiler>);
      });
      if (interaction) {
        // eslint-disable-next-line no-await-in-loop
        await interaction();
      }
      root.unmount();
      container.remove();

      if (!isWarmup) {
        iterations.push(captures);
      }

      if (options?.afterEach) {
        // eslint-disable-next-line no-await-in-loop
        await options.afterEach();
      }
    }

    task.meta.benchmarkIterations = iterations;
    task.meta.benchmarkName = name;

    // Validate all iterations produced the same render events (count + order).
    // This runs after meta is set so the reporter can still display results on failure.
    if (iterations.length > 1) {
      const getEventKey = (event: RenderEvent) => `${event.id}:${event.phase}`;
      const expectedKeys = iterations[0].map(getEventKey);

      for (let i = 1; i < iterations.length; i += 1) {
        const iterationKeys = iterations[i].map(getEventKey);
        expect(iterationKeys, `Iteration ${i} render events differ from iteration 0`).toEqual(
          expectedKeys,
        );
      }
    }
  });
}
