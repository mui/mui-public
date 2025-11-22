'use client';
import * as React from 'react';
import { useUrlHashState } from '@mui/internal-docs-infra/useUrlHashState';
import styles from './TabNavigation.module.css';

const tabs = [
  {
    id: 'overview',
    label: 'Overview',
    content: 'Overview content - describing the main features.',
  },
  { id: 'details', label: 'Details', content: 'Detailed information about the implementation.' },
  { id: 'examples', label: 'Examples', content: 'Code examples and usage patterns.' },
];

export function TabNavigation() {
  const [hash, setHash] = useUrlHashState();
  const activeTab = hash || 'overview';

  const activeContent = tabs.find((tab) => tab.id === activeTab)?.content || tabs[0].content;

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setHash(tab.id, false)}
            className={activeTab === tab.id ? styles.tabActive : styles.tab}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        <p className={styles.contentText}>{activeContent}</p>
        <p className={styles.hint}>Try clicking tabs and using browser back/forward buttons</p>
      </div>
    </div>
  );
}
