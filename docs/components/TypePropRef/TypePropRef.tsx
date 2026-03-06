'use client';

import * as React from 'react';
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
 * When this is a reference (`href` is present), renders a link to the anchor.
 *
 * Falls back to a plain span or anchor when no property data is available.
 */
export function TypePropRef({ id, href, name, prop, className, children }: TypePropRefProps) {
  const propData = useTypeProp(name, prop);

  // Definition site: render a span with an anchor id
  if (id) {
    return (
      <span id={id} className={className}>
        {children}
      </span>
    );
  }

  const resolvedHref = propData?.href ?? href;

  if (!resolvedHref) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a href={resolvedHref} className={[className, styles.link].filter(Boolean).join(' ')}>
      {children}
    </a>
  );
}
