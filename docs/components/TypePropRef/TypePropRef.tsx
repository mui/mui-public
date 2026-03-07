'use client';

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { useTypeProp } from '@mui/internal-docs-infra/useType';
import styles from './TypePropRef.module.css';

interface TypePropRefProps {
  /** The anchor id (when this is the definition site) */
  id?: string;
  /** The anchor href (when this is a reference to the definition) */
  href?: string;
  /** The owner type name (e.g., "Root", "Trigger") */
  name: string;
  /** The property path (e.g., "className", "open") */
  prop: string;
  /** Optional CSS class name(s) inherited from syntax highlighting */
  className?: string;
  /** The rendered text content */
  children: React.ReactNode;
}

/**
 * Renders a type property reference as an interactive element.
 * When this is the definition site (`id` is present), renders a span with the anchor id.
 * When property metadata is available, shows a popover with description, type, and default.
 * At the definition site the popover omits the type (already shown inline).
 *
 * Falls back to a plain span or anchor when no property data is available.
 */
export function TypePropRef({ id, href, name, prop, className, children }: TypePropRefProps) {
  const propData = useTypeProp(name, prop);
  const property = propData?.property;
  const resolvedHref = propData?.href ?? href;

  const hasPopoverContent =
    property &&
    (property.description || property.default || property.example || property.detailedType);

  // Definition site with popover content: show anchor span + popover for meta
  if (id && hasPopoverContent) {
    return (
      <Popover.Root>
        <Popover.Trigger id={id} className={[className, styles.trigger].filter(Boolean).join(' ')}>
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8}>
            <Popover.Popup className={styles.popup}>
              <PropPopoverContent property={property} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  // Definition site without popover content: plain span with anchor
  if (id) {
    return (
      <span id={id} className={className}>
        {children}
      </span>
    );
  }

  // Reference site with popover content
  if (hasPopoverContent) {
    return (
      <Popover.Root>
        <Popover.Trigger className={[className, styles.trigger].filter(Boolean).join(' ')}>
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8}>
            <Popover.Popup className={styles.popup}>
              {resolvedHref && (
                <div className={styles.header}>
                  <a href={resolvedHref} className={styles.headerLink}>
                    Go to definition
                  </a>
                  <Popover.Close aria-label="Close" className={styles.close}>
                    &times;
                  </Popover.Close>
                </div>
              )}
              <PropPopoverContent property={property} showType />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  // No popover: fall back to link or plain span
  if (!resolvedHref) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a href={resolvedHref} className={[className, styles.link].filter(Boolean).join(' ')}>
      {children}
    </a>
  );
}

function PropPopoverContent({
  property,
  showType,
}: {
  property: NonNullable<ReturnType<typeof useTypeProp>>['property'];
  showType?: boolean;
}) {
  return (
    <dl className={styles.propList}>
      {property.description && (
        <div className={styles.propRow}>
          <dd className={styles.description}>{property.description}</dd>
        </div>
      )}
      {showType && (
        <div className={styles.propRow}>
          <dt className={styles.label}>Type</dt>
          <dd className={styles.value}>{property.detailedType ?? property.type}</dd>
        </div>
      )}
      {property.default && (
        <div className={styles.propRow}>
          <dt className={styles.label}>Default</dt>
          <dd className={styles.value}>{property.default}</dd>
        </div>
      )}
      {property.example && (
        <div className={styles.propRow}>
          <dt className={styles.label}>Example</dt>
          <dd className={styles.value}>{property.example}</dd>
        </div>
      )}
    </dl>
  );
}
