declare global {
  interface Window {
    gc?: () => void;
  }
}

let warned = false;

/**
 * Lets pending tasks finish — a previous iteration's cleanup — then collects garbage twice, the
 * second pass catching what the first freed weak references to, so no iteration pays for another's
 * allocations. Needs `--js-flags=--expose-gc`, and warns once without it.
 */
export async function collectGarbage(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  if (typeof window.gc === 'function') {
    window.gc();
    window.gc();
  } else if (!warned) {
    warned = true;
    console.warn(
      'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
    );
  }
}
