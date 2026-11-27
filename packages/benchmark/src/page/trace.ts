/**
 * Puts a sample's spans on a "Benchmark" track of their own in a DevTools trace, through the
 * Performance panel's extensibility API; elsewhere, the `detail` is just data.
 */
export function benchmarkTrackDetail(color: 'primary' | 'tertiary') {
  return { devtools: { dataType: 'track-entry', track: 'Benchmark', color } };
}
