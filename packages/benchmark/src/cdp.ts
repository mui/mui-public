/** Sends a raw Chrome DevTools Protocol command to the page under test. */
export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/**
 * The Chrome DevTools Protocol, on the session that drives the page under test: for what a case
 * sets up or reads itself — trusted input gestures (`Input.synthesizeScrollGesture`), CPU
 * throttling (`Emulation.setCPUThrottlingRate`), the engine's own counters
 * (`Performance.getMetrics`) as custom metrics.
 *
 * A setting changed this way stays on the tab, through later samples and the other cases sampled in
 * it — those of a `compare()` too — so a case that changes one sets it every time, and the others
 * set it as they need it.
 */
export interface BenchmarkCdp {
  send: CdpSend;
}
