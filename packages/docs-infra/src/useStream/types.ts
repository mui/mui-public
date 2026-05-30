import type * as React from 'react';
import type { SettleGate } from '../useCoordinated/createSettleGate';

// The source a chunk loads from is defined at the single-chunk layer; re-exported
// here so a consumer driving the client list with `useStream` imports it from the
// same place.
export type { StreamSource, StreamUrlsResult } from '../CoordinatedLazy/types';

/** Options for `useStreamController`. */
export interface UseStreamControllerOptions {
  /**
   * Total number of chunks that will register. The controller stays `loading`
   * until that many have registered and all have settled - **known-count**
   * completion. Use when the chunk count is known up front.
   */
  knownCount?: number;
  /**
   * Hold the controller `loading` for an unknown-count stream until `markLast`
   * is called - **last-chunk** completion. Ignored when `knownCount` is set.
   * Use for a streaming loader that pushes chunks over time and signals the end
   * when its generator returns.
   */
  streaming?: boolean;
  /**
   * Coordination channel forwarded to chunks for cross-instance commits (e.g.
   * a later page-wide change landing together). `null` opts out.
   */
  channelKey?: string | null;
  /** Override the gate's safety timeout (ms). */
  safetyTimeoutMs?: number;
}

/** Result of `useStreamController`. */
export interface UseStreamControllerResult {
  /**
   * Provider that scopes chunk registration to this controller: it supplies the
   * controller's gate as the ambient gate, so chunks rendered inside register
   * their swap with it (via `CoordinatedLazy`) without a `gate` prop.
   */
  Controller: React.ComponentType<{ children: React.ReactNode }>;
  /** `true` while any registered chunk is still loading; `false` once all settle. */
  loading: boolean;
  /** The controller's settle gate (also provided as the ambient gate). */
  gate: SettleGate;
  /** Mark the last chunk as arrived - terminal for a streaming controller. */
  markLast: () => void;
  /** Declare/adjust the total chunk count (known-count completion). */
  setKnownCount: (count: number) => void;
}
