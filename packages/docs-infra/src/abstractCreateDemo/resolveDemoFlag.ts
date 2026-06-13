/** A single cascade layer for a demo on/off flag pair (instance or meta). */
export type DemoFlagLayer = {
  /** The "turn on" value at this layer (e.g. `collapseToEmpty`, `initialExpanded`). */
  on?: boolean;
  /** The "force off" override at this layer (e.g. `showCollapsedFocus`, `initialCollapsed`). */
  off?: boolean;
};

/**
 * Resolves a cascading boolean demo flag, highest priority first: the given
 * `layers` (instance → meta) then the factory `on` default. At each layer an
 * explicit `off` forces `false` (it wins over that layer's `on`); otherwise an
 * explicit `on` value is used. Falls through to the factory default.
 *
 * Used for the demo factory's render-time flag pairs:
 *   - `collapseToEmpty` (on) / `showCollapsedFocus` (off)
 *   - `initialExpanded` (on) / `initialCollapsed` (off)
 *
 * Internal helper — not part of the public `abstractCreateDemo` surface.
 */
export function resolveDemoFlag(
  layers: Array<DemoFlagLayer | undefined>,
  factoryOn: boolean | undefined,
): boolean {
  for (const layer of layers) {
    if (layer?.off === true) {
      return false;
    }
    if (layer?.on !== undefined) {
      return layer.on;
    }
  }
  return factoryOn === true;
}
