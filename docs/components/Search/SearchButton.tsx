import * as React from 'react';
import { Button } from '@base-ui/react/button';
import { Search } from 'lucide-react';
import { ExpandingBox } from '../ExpandingBox';
import styles from './SearchButton.module.css';

interface SearchButtonProps {
  onClick: () => void;
  isDialogOpen: boolean;
  enableKeyboardShortcut: boolean;
}

export function SearchButton({ onClick, isDialogOpen, enableKeyboardShortcut }: SearchButtonProps) {
  return (
    <Button onClick={onClick} className={`${styles.button} ${isDialogOpen ? styles.hidden : ''}`}>
      <ExpandingBox isActive={!isDialogOpen} isCollapsed={true} className={styles.content}>
        <span className={styles.wrapper}>
          <span className={styles.buttonContent}>
            <Search className={styles.icon} />
            <span className={styles.text}>Search</span>
          </span>
          {enableKeyboardShortcut && (
            <span className={`expanding-box-content-right ${styles.shortcut}`}>
              <kbd className={`${styles.kbd} ${styles.kbdCmd}`}>⌘</kbd>
              <kbd className={styles.kbd}>K</kbd>
            </span>
          )}
        </span>
      </ExpandingBox>
    </Button>
  );
}
