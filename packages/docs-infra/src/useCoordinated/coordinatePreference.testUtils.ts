/**
 * Test-only affordances for `coordinatePreference`. Kept in a sibling
 * file so the production module's public surface (`registerPeer`,
 * `announceTarget`, `reportValue`, `hasEverAnnounced`,
 * `getBarrierAnnounceTime`) stays free of helpers that should never
 * be reachable from runtime code or re-exported from the package
 * entry.
 *
 * The implementation here reaches into `__testInternals` from
 * `coordinatePreference.ts`. That export is the only sanctioned
 * channel into module-private state and is marked `__`-prefixed so
 * accidental imports are obvious in code review.
 */
import { __testInternals } from './coordinatePreference';

const { channels, setTargetEncoder } = __testInternals;

/**
 * Reset all module state between test cases. Production callers never
 * need this; channels self-dispose when their last peer unregisters.
 */
export function resetCoordinatorsForTests(): void {
  for (const channel of channels.values()) {
    for (const barrier of channel.pendingBarriers.values()) {
      clearTimeout(barrier.minWaitTimer);
      clearTimeout(barrier.waitingForPeersTimer);
      clearTimeout(barrier.ultimateTimer);
      for (const waiter of barrier.waiters.values()) {
        waiter.abort.abort();
      }
    }
    for (const peer of channel.peers.values()) {
      for (const controller of peer.lazyInFlight.keys()) {
        controller.abort();
      }
    }
  }
  channels.clear();
}

/**
 * Snapshot of channel/peer/barrier counts across all channels.
 * Useful for asserting cleanup in tests.
 */
export function getCoordinatorStatsForTests(): {
  channelCount: number;
  totalPeers: number;
  totalPendingBarriers: number;
} {
  let totalPeers = 0;
  let totalPendingBarriers = 0;
  for (const channel of channels.values()) {
    totalPeers += channel.peers.size;
    totalPendingBarriers += channel.pendingBarriers.size;
  }
  return {
    channelCount: channels.size,
    totalPeers,
    totalPendingBarriers,
  };
}

/**
 * Override the target encoder. Returns a function that restores the
 * previous encoder. Useful when the value type contains unstable
 * references that the default `JSON.stringify`-based encoder cannot
 * key deterministically.
 */
export function setTargetEncoderForTests(impl: (value: unknown) => string): () => void {
  return setTargetEncoder(impl);
}
