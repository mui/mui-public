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
}

/**
 * Shared 48px-tall header used at the top of code blocks and demo code sections.
 * Renders the border chrome and an optional menu slot that overflows 8px past
 * the right edge of the container.
 */
export function CodeBlockHeader({ children, menu, roundedTop }: CodeBlockHeaderProps) {
  // @focus-start
  return (
    <div className={styles.header}>
      <div
        className={`${styles.headerContainer} ${roundedTop ? styles.headerContainerRoundedTop : ''}`}
      >
        <div className={styles.tabContainer}>{children}</div>
        {menu}
      </div>
    </div>
  );
  // @focus-end
}

/**
 * A filename / static label rendered inside `<CodeBlockHeader>` when there
 * are no tabs. Matches the typography of the tab labels.
 */
export function CodeBlockHeaderLabel({ children }: { children: React.ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}
