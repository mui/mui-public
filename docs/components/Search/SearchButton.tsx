import * as React from 'react';
import { Button } from '@base-ui-components/react/button';
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
        <div className={styles.wrapper}>
          <div className={styles.buttonContent}>
            <Search className={styles.icon} />
            <span className={styles.text}>Search</span>
          </div>
          {enableKeyboardShortcut && (
            <div className={`expanding-box-content-right ${styles.shortcut}`}>
              <kbd className={`${styles.kbd} ${styles.cmd}`}>⌘</kbd>
              <kbd className={styles.kbd}>K</kbd>
            </div>
          )}
        </div>
      </ExpandingBox>
    </Button>
  );
}
