'use client';

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { useType } from '@mui/internal-docs-infra/useType';
import type { TypeRefProps } from '@mui/internal-docs-infra/useType';
import { TypesTable } from '@/app/docs-infra/hooks/use-types/demos/TypesTable';
import styles from './TypeRef.module.css';

/**
 * Renders a type reference as an interactive element.
 * When clicked, displays a popover showing the type's documentation
 * rendered via the `TypesTable` component from the nearest `TypesDataProvider`.
 *
 * Falls back to a standard anchor link when no type data is available.
 */
export function TypeRef({ href, name, className, children }: TypeRefProps) {
  const typeData = useType(name);

  // Fall back to a standard anchor if no type data is available
  if (!typeData) {
    return (
      <a href={href} className={className}>
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
            <div className={styles.header}>
              <a href={href} className={styles.link}>
                Go to full documentation
              </a>
              <Popover.Close aria-label="Close" className={styles.close}>
                &times;
              </Popover.Close>
            </div>
            <TypesTable type={typeData.meta} additionalTypes={[]} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
