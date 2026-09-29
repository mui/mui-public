/**
 * Shared measurement helper.
 *
 * Tachometer's `performance` measurement mode polls the page for a `performance.measure()` span of
 * a given name, so a page's only obligation is to produce one.
 */

/** The measure name each case's `tachometer.json` reads. */
const MEASURE = 'mount';

/**
 * Runs `work`, writes its result into the page, and closes the `mount` measure once the browser has
 * painted it.
 *
 * The paint is inside the measured window on purpose: a workload whose result is never displayed
 * can be optimized away, and the number would then track nothing.
 */
export function measureMount(work: () => string): void {
  performance.mark(`${MEASURE}-start`);
  const text = work();

  const root = document.getElementById('root');
  if (!root) {
    throw new Error('The page is missing its #root element.');
  }
  root.textContent = text;

  // A double rAF closes the measure after the DOM write *and* the paint it triggers; a single one
  // would still be inside the frame that performs the paint.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      performance.mark(`${MEASURE}-end`);
      performance.measure(MEASURE, `${MEASURE}-start`, `${MEASURE}-end`);
    });
  });
}

/**
 * Reads a positive integer from the page's query string, so one page can back several cases.
 */
export function numberParam(name: string, fallback: number): number {
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected "${name}" to be a positive integer, got "${raw}".`);
  }
  return value;
}
