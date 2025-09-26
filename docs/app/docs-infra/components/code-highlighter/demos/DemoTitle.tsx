import * as React from 'react';
import style from './DemoTitle.module.css';

export function DemoTitle({ slug, children }: { slug?: string; children?: React.ReactNode }) {
  return slug ? (
    <h3 id={slug}>
      <a href={`#${slug}`} className={style.link}>
        {children}
      </a>
    </h3>
  ) : (
    <h3>{children}</h3>
  );
}
