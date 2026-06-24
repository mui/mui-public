/**
 * The autoprefixer/browserslist target for the live-demo CSS compiler: the EXACT
 * browser + version the preview is running in.
 *
 * A demo's compiled CSS only has to work in the visitor's own browser, so prefixing
 * for that single engine adds exactly what it needs — usually nothing on a current
 * browser — instead of the whole "baseline" range. Off the main thread (SSR/Node) or
 * in an unrecognized engine it falls back to `baseline widely available`, a
 * broad-but-safe default. On iOS every browser is WebKit, so the `safari` branch
 * (matched for any `Version/x Safari` UA) is the correct target there too.
 *
 * Pair with autoprefixer's `ignoreUnknownVersions`, so a browser newer than the
 * bundled caniuse-lite resolves to no prefixes (correct — current browsers need none)
 * rather than throwing.
 */
export function currentBrowserTarget(): string[] {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

  const edge = userAgent.match(/Edg\/(\d+)/);
  if (edge) {
    return [`edge ${edge[1]}`];
  }
  const firefox = userAgent.match(/Firefox\/(\d+)/);
  if (firefox) {
    return [`firefox ${firefox[1]}`];
  }
  // Edge is matched above, so a remaining `Chrome/` is Chromium proper.
  const chrome = userAgent.match(/Chrome\/(\d+)/);
  if (chrome) {
    return [`chrome ${chrome[1]}`];
  }
  const safari = userAgent.match(/Version\/(\d+\.\d+) Safari/);
  if (safari) {
    return [`safari ${safari[1]}`];
  }
  return ['baseline widely available'];
}
