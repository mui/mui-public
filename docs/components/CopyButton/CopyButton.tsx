import * as React from 'react';
import styles from './CopyButton.module.css';

type CopyButtonProps = {
  copy: (event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  copyDisabled?: boolean;
};

export function CopyButton({ copy, copyDisabled }: CopyButtonProps) {
  return (
    <button
      className={styles.copyButton}
      onClick={copy}
      disabled={copyDisabled}
      type="button"
      aria-label={copyDisabled ? 'Copied' : 'Copy code'}
    >
      {copyDisabled ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z" fill="currentColor" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
