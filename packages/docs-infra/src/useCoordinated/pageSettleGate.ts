import { createSettleGate } from './createSettleGate';

/**
 * The process-global default settle gate that page-level `CoordinatedLazy`
 * swaps register with when no explicit gate is supplied. The page-wide
 * layout-shift coordination (`layoutShiftGate`) aliases this same instance, so
 * a demo's fallback->content swap and a code block's highlight swap both feed
 * one "page initial swaps settled" signal that `useCoordinated` can await.
 *
 * Inert until a client hook registers with it; nothing registers during SSR, so
 * the shared module state cannot leak across server requests.
 */
export const pageSettleGate = createSettleGate();
