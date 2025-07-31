import * as React from 'react';
import { Tabs as TabsParts } from '@base-ui-components/react/tabs';
import styles from './Tabs.module.css';

export interface Tab {
  name: string;
  id: string;
}

export interface TabsProps {
  tabs: Tab[];
  selectedTabId?: string;
  onTabSelect: (tabId: string) => void;
}

export function Tabs({ tabs, selectedTabId, onTabSelect }: TabsProps) {
  const clickName = React.useCallback(() => {
    onTabSelect(tabs[0].id);
  }, [onTabSelect, tabs]);
  if (tabs.length <= 1) {
    return tabs.length === 1 ? (
      <div className={styles.name} onClick={clickName}>
        <span>{tabs[0].name}</span>
      </div>
    ) : null;
  }

  return (
    <TabsParts.Root
      className={styles.tabsRoot}
      value={selectedTabId || tabs[0]?.id}
      onValueChange={onTabSelect}
    >
      <TabsParts.List className={styles.tabsList}>
        {tabs.map((tab, index) => {
          const isSelected = selectedTabId ? tab.id === selectedTabId : index === 0;
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
            <TabsParts.Tab key={index} className={tabClasses} value={tab.id}>
              {tab.name}
            </TabsParts.Tab>
          );
        })}
      </TabsParts.List>
    </TabsParts.Root>
  );
}
