// A signal ends the process without running `finally` blocks, so cleanup that must survive a Ctrl-C
// — a temporary checkout, say — registers here instead.

const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const cleanups = new Set<() => Promise<void>>();

function handleSignal(signal: NodeJS.Signals): void {
  for (const watched of SIGNALS) {
    process.off(watched, handleSignal);
  }
  const pending = [...cleanups];
  cleanups.clear();
  // Ends the process as the signal would have, once every cleanup has had its chance.
  void Promise.allSettled(pending.map((cleanup) => cleanup())).then(() => {
    process.kill(process.pid, signal);
  });
}

/**
 * Runs `cleanup` if the process is stopped by a signal before the returned function is called, then
 * lets the signal end the process.
 */
export function onInterrupt(cleanup: () => Promise<void>): () => void {
  if (cleanups.size === 0) {
    for (const signal of SIGNALS) {
      process.on(signal, handleSignal);
    }
  }
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
    if (cleanups.size === 0) {
      for (const signal of SIGNALS) {
        process.off(signal, handleSignal);
      }
    }
  };
}
