import type { SitemapSectionData } from '@mui/internal-docs-infra/createSitemap/types';
import * as React from 'react';
import Link from 'next/link';
import styles from './PagesIndex.module.css';

export function PagesIndex({ data }: { data?: SitemapSectionData }) {
  return (
    <div>
      <div className={styles.pages}>
        {data?.pages.map((page, i) => (
          <Link
            key={i}
            href={`${data.prefix}${page.path.replace(/^\.\//, '').replace(/\/page\.mdx$/, '')}`}
            className={styles.page}
          >
            <div className={styles.pageTitle}>
              <span>{page.title}</span>

              {page.tags?.includes('New') && <span className={styles.new}>New</span>}
            </div>
            <div className={styles.pageDescription}>{page.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
