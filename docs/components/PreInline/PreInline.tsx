import * as React from 'react';
import styles from './PreInline.module.css';

export function PreInline(props: React.ComponentProps<'pre'>) {
  return <pre {...props} className={[styles.root, props.className].filter(Boolean).join(' ')} />;
}
