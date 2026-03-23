'use client';

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { useType } from '@mui/internal-docs-infra/useType';
import type { TypeRefProps } from '@mui/internal-docs-infra/useType';
import { TypesTable } from '@/app/docs-infra/hooks/use-types/demos/TypesTable';
import { PopoverArrow } from '@/components/PopoverArrow/PopoverArrow';
import styles from './TypeRef.module.css';

const EMPTY_SET = new Set<string>();
const ActiveTypeRefContext = React.createContext<ReadonlySet<string>>(EMPTY_SET);

/**
 * Renders a type reference as an interactive element.
 * When clicked, displays a popover showing the type's documentation
 * rendered via the `TypesTable` component from the nearest `TypesDataProvider`.
 *
 * Falls back to a standard anchor link when no type data is available.
 * When rendered inside a popover for the same type (self-reference),
 * renders a plain span instead of a nested popover.
 */
export function TypeRef({ href, name, className, children }: TypeRefProps) {
  const activeTypeNames = React.useContext(ActiveTypeRefContext);
  const typeData = useType(name);
  const aliases = typeData?.meta.aliases;
  const nextActiveTypeNames = React.useMemo(
    () => new Set([...activeTypeNames, name, ...(aliases ?? [])]),
    [activeTypeNames, name, aliases],
  );

  // Render a plain span for circular type references (direct or through intermediaries)
  if (activeTypeNames.has(name)) {
    return <span className={className}>{children}</span>;
  }

  // Fall back to a standard anchor if no type data is available
  if (!typeData) {
    return (
      <a href={href} className={[className, styles.fallback].filter(Boolean).join(' ')}>
        {children}
      </a>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger className={[className, styles.trigger].filter(Boolean).join(' ')}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className={styles.popup}>
            <PopoverArrow />
            <div className={styles.header}>
              <a href={href} className={styles.link}>
                Go to full documentation
              </a>
              <Popover.Close aria-label="Close" className={styles.close}>
                &times;
              </Popover.Close>
            </div>
            <ActiveTypeRefContext.Provider value={nextActiveTypeNames}>
              <TypesTable type={typeData.meta} additionalTypes={[]} />
            </ActiveTypeRefContext.Provider>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
