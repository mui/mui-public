import * as React from 'react';
import { Tabs as TabsParts } from '@base-ui/react/tabs';
import styles from './Tabs.module.css';

export interface Tab {
  name: string;
  id: string;
  /**
   * Optional anchor slug for the tab. When provided, the tab is rendered as
   * an `<a href="#slug">` so users can deep-link to it and use modifier-click
   * (Ctrl/Cmd/Alt/Shift) to open it in a new tab/window like a normal link.
   */
  slug?: string;
}

export interface TabsProps {
  tabs: Tab[];
  selectedTabId?: string;
  onTabSelect: (tabId: string) => void;
  disabled?: boolean;
}

function isModifierClick(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  // Mirrors native anchor behavior so users can open tabs in a new
  // tab/window/split-view without changing the active tab.
  return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
}

export function Tabs({ tabs, selectedTabId, onTabSelect, disabled }: TabsProps) {
  // Track modifier keys across pointerdown -> click to emulate <a> behavior:
  // when the user is opening the tab in a new tab/window, we must skip the
  // Base UI value change but still let the browser navigate to the anchor.
  const modifierClickRef = React.useRef(false);

  const clickName = React.useCallback(() => {
    onTabSelect(tabs[0].id);
  }, [onTabSelect, tabs]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onTabSelect(tabs[0].id);
      }
    },
    [onTabSelect, tabs],
  );

  const handleValueChange = React.useCallback(
    (value: string, eventDetails: TabsParts.Root.ChangeEventDetails) => {
      if (modifierClickRef.current) {
        // Let the browser handle the anchor navigation (new tab/window/split).
        eventDetails.cancel();
        return;
      }
      onTabSelect(value);
    },
    [onTabSelect],
  );

  const handleTabPointerDown = React.useCallback((event: React.PointerEvent) => {
    modifierClickRef.current = isModifierClick(event);
  }, []);

  const handleTabClick = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (isModifierClick(event)) {
      // Defer the reset so `handleValueChange` (fired synchronously after
      // click) still sees the modifier state and cancels the value change.
      queueMicrotask(() => {
        modifierClickRef.current = false;
      });
      return;
    }
    // Plain click: prevent the browser from scroll-jumping to the anchor.
    event.preventDefault();
    modifierClickRef.current = false;
  }, []);

  if (tabs.length <= 1) {
    return tabs.length === 1 ? (
      <div
        className={styles.name}
        onClick={clickName}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <span>{tabs[0].name}</span>
      </div>
    ) : null;
  }

  return (
    <TabsParts.Root
      className={styles.tabsRoot}
      value={selectedTabId || tabs[0]?.id}
      onValueChange={handleValueChange}
      aria-disabled={disabled}
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

          if (tab.slug) {
            return (
              <TabsParts.Tab
                key={index}
                className={tabClasses}
                disabled={disabled}
                value={tab.id}
                nativeButton={false}
                onPointerDown={handleTabPointerDown}
                render={<a href={`#${tab.slug}`} onClick={handleTabClick} aria-label={tab.name} />}
              >
                {tab.name}
              </TabsParts.Tab>
            );
          }

          return (
            <TabsParts.Tab key={index} className={tabClasses} disabled={disabled} value={tab.id}>
              {tab.name}
            </TabsParts.Tab>
          );
        })}
      </TabsParts.List>
    </TabsParts.Root>
  );
}
