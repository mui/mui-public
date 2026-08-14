import type * as CodeEditorExports from './CodeEditor';

export type CodeEditorModule = typeof CodeEditorExports;
export type CodeEditorLoader = () => Promise<CodeEditorModule>;

export const defaultCodeEditorLoader: CodeEditorLoader = () => import('./CodeEditor');

// Keyed by loader so an eager provider and a lazy one each dedupe independently.
const modules = new WeakMap<CodeEditorLoader, CodeEditorModule>();
const promises = new WeakMap<CodeEditorLoader, Promise<CodeEditorModule>>();

/** Reads the resolved module synchronously, or `undefined` when still cold. */
export function peekCodeEditor(loader: CodeEditorLoader): CodeEditorModule | undefined {
  return modules.get(loader);
}

/** Resolves the editor module, deduplicating concurrent loads per loader. */
export function loadCodeEditor(
  loader: CodeEditorLoader = defaultCodeEditorLoader,
): Promise<CodeEditorModule> {
  const loaded = modules.get(loader);
  if (loaded) {
    return Promise.resolve(loaded);
  }
  const pending = promises.get(loader);
  if (pending) {
    return pending;
  }
  const promise = loader().then(
    (module) => {
      modules.set(loader, module);
      return module;
    },
    (error: unknown) => {
      // Drop the rejected promise so a later attempt can retry.
      promises.delete(loader);
      throw error;
    },
  );
  promises.set(loader, promise);
  return promise;
}

/** Warms the editor chunk ahead of first focus. Fails open. */
export async function preloadCodeEditor(loader?: CodeEditorLoader): Promise<void> {
  try {
    await loadCodeEditor(loader);
  } catch {
    // A failed preload leaves the block read-only until the next attempt.
  }
}

/** Clears the cache for a loader. For tests. */
export function resetCodeEditorCache(loader: CodeEditorLoader = defaultCodeEditorLoader): void {
  modules.delete(loader);
  promises.delete(loader);
}
