'use client';

import * as React from 'react';
import type { CodeEditorProps } from './CodeEditor';
import { defaultCodeEditorLoader, loadCodeEditor, peekCodeEditor } from './codeEditorCache';
import type { CodeEditorLoader, CodeEditorModule } from './codeEditorCache';

/** Loads the editor chunk only once an editable block asks for it. */
export function CodeEditorLazy({
  loader = defaultCodeEditorLoader,
  fallback,
  ...props
}: CodeEditorProps & { loader?: CodeEditorLoader; fallback: React.ReactNode }) {
  const [module, setModule] = React.useState<CodeEditorModule | undefined>(() =>
    peekCodeEditor(loader),
  );

  React.useEffect(() => {
    let active = true;
    loadCodeEditor(loader).then(
      (loaded) => {
        if (active) {
          setModule(loaded);
        }
      },
      () => {
        // The block stays read-only on the fallback.
      },
    );
    return () => {
      active = false;
    };
  }, [loader]);

  if (!module) {
    return fallback;
  }
  return <module.CodeEditor {...props} />;
}
