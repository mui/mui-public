import * as React from 'react';
import styles from './Tabs.module.css';

export interface Tab {
  name: string;
  id: string;
}

export interface TabsProps {
  tabs: Tab[];
  selectedTabId: string;
  onTabSelect: (tabId: string) => void;
}

export function Tabs({ tabs, selectedTabId, onTabSelect }: TabsProps) {
  if (tabs.length <= 1) {
    return tabs.length === 1 ? <span>{tabs[0].name}</span> : null;
  }

  return (
    <div className={styles.tabGroup}>
      {tabs.map((tab, index) => {
        const isSelected = tab.id === selectedTabId;
        const isFirst = index === 0;
        const isLast = index === tabs.length - 1;
        const nextTabSelected = index < tabs.length - 1 && tabs[index + 1].id === selectedTabId;
        const prevTabSelected = index > 0 && tabs[index - 1].id === selectedTabId;

        const tabClasses = [
          styles.tab,
          isSelected && styles.tabSelected,
          !isSelected && isFirst && styles.tabFirst,
          !isSelected && isLast && styles.tabLast,
          !isSelected && !isFirst && !isLast && styles.tabMiddle,
          nextTabSelected && styles.tabNextSelected,
          prevTabSelected && styles.tabPrevSelected,
          isLast || isSelected ? styles.tabWithBorderRight : styles.tabNoBorderRight,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button key={tab.id} onClick={() => onTabSelect(tab.id)} className={tabClasses}>
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
