import type * as CodeEditorExports from './CodeEditor';

export type CodeEditorModule = typeof CodeEditorExports;
export type CodeEditorLoader = () => Promise<CodeEditorModule>;

export const defaultCodeEditorLoader: CodeEditorLoader = () => import('./CodeEditor');

const modules = new WeakMap<CodeEditorLoader, CodeEditorModule>();
const promises = new WeakMap<CodeEditorLoader, Promise<CodeEditorModule>>();

export function peekCodeEditor(loader: CodeEditorLoader): CodeEditorModule | undefined {
  return modules.get(loader);
}

/** Loads and deduplicates the editor module for a provider loader. */
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
      promises.delete(loader);
      throw error;
    },
  );
  promises.set(loader, promise);
  return promise;
}

export async function preloadCodeEditor(loader?: CodeEditorLoader): Promise<void> {
  await loadCodeEditor(loader);
}
