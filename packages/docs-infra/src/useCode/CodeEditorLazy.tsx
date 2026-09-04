'use client';

import * as React from 'react';
import type { CodeEditorProps } from './CodeEditor';
import { defaultCodeEditorLoader, loadCodeEditor, peekCodeEditor } from './codeEditorCache';
import type { CodeEditorLoader, CodeEditorModule } from './codeEditorCache';

/** Loads react-simple-code-editor only after an editable block requests it. */
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
      () => {},
    );
    return () => {
      active = false;
    };
  }, [loader]);

  if (!module) {
    return fallback;
  }
  return <module.CodeEditor {...props} fallback={fallback} />;
}
