import * as React from 'react';
import copyToClipboard from 'clipboard-copy';

type OnCopied = () => void;
type OnCopyError = (error: unknown) => void;
type OnCopyClick = (event: React.MouseEvent<HTMLButtonElement>) => void;
export type UseCopierOpts = {
  onCopied?: OnCopied;
  onError?: OnCopyError;
  onClick?: OnCopyClick;
  timeout?: number;
};

export function useCopier(contents: (() => string | undefined) | string, opts?: UseCopierOpts) {
  const { onCopied, onError, onClick, timeout = 2000 } = opts || {};

  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const [disabled, setDisabled] = React.useState(false);

  const copy = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      clearTimeout(copyTimeoutRef.current);
      setDisabled(true);

      try {
        const content = typeof contents === 'function' ? contents() : contents;
        if (content) {
          await copyToClipboard(content);
        }

        onCopied?.();
      } catch (error) {
        onError?.(error);
      }

      onClick?.(event);

      copyTimeoutRef.current = setTimeout(() => {
        clearTimeout(copyTimeoutRef.current);
        setDisabled(false);
      }, timeout);
    },
    [contents, timeout, onCopied, onError, onClick],
  );

  return { copy, disabled };
}
