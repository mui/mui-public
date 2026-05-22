import * as React from 'react';
import styles from './CodeBlockHeader.module.css';

export interface CodeBlockHeaderProps {
  /**
   * Main header content (typically a `<Tabs>` element or a filename label).
   */
  children?: React.ReactNode;
  /**
   * Right-aligned action slot — typically a `<CodeActionsMenu>`.
   */
  menu?: React.ReactNode;
  /**
   * When true, the side decoration lines start 8px below the top edge so they
   * clear a rounded container corner. Use for standalone code blocks where the
   * header sits at the top of a rounded container; leave false for demo code
   * sections that have a sibling above.
   */
  roundedTop?: boolean;
  /**
   * Forward `useCode().pendingTransform` (or `useDemo().pendingTransform`)
   * here to render a built-in loading indicator inside the header while a
   * cross-demo transform swap is waiting on slow peers past the coordinator's
   * grace window. `undefined` (the default) keeps the indicator hidden; a
   * `string` or `null` fades it in and announces the target via a visually
   * hidden live region. The spinner stays mounted at all times so layout
   * doesn't reflow when it toggles.
   */
  pending?: string | null | undefined;
}

/**
 * Shared 48px-tall header used at the top of code blocks and demo code sections.
 * Renders the border chrome and an optional menu slot that overflows 8px past
 * the right edge of the container.
 */
export function CodeBlockHeader({ children, menu, roundedTop, pending }: CodeBlockHeaderProps) {
  // @focus-start
  const isPending = pending !== undefined;
  return (
    <div className={styles.header}>
      <div
        className={`${styles.headerContainer} ${roundedTop ? styles.headerContainerRoundedTop : ''}`}
      >
        <div className={styles.tabContainer}>{children}</div>
        <span
          className={styles.pendingIndicator}
          data-pending={isPending ? '' : undefined}
          aria-hidden={!isPending}
        >
          <PendingSpinner />
          <span className={styles.srOnly} role="status" aria-live="polite">
            {isPending ? `Switching to ${pending ?? 'original'}…` : ''}
          </span>
        </span>
        {menu}
      </div>
    </div>
  );
  // @focus-end
}

function PendingSpinner() {
  return (
    <svg className={styles.spinner} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

/**
 * A filename / static label rendered inside `<CodeBlockHeader>` when there
 * are no tabs. Matches the typography of the tab labels.
 */
export function CodeBlockHeaderLabel({ children }: { children: React.ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}
