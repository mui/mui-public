'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Sitemap } from '@mui/internal-docs-infra/createSitemap/types';
import styles from './Navigation.module.css';

export function Navigation({ sitemap }: { sitemap: Sitemap }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const pathname = usePathname();

  const toggleNav = () => setIsOpen(!isOpen);
  const closeNav = () => setIsOpen(false);

  return (
    <React.Fragment>
      <button
        type="button"
        className={styles.toggleButton}
        onClick={toggleNav}
        aria-label="Toggle navigation"
        aria-expanded={isOpen}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M3 12h18M3 6h18M3 18h18" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <nav className={`${styles.nav} ${isOpen ? styles.navOpen : ''}`}>
        <ul className={styles.list}>
          {Object.entries(sitemap?.data || {})
            .filter(([sectionName]) => sectionName.startsWith('DocsInfra'))
            .map(([sectionName, section]) => {
              const displayName = sectionName.slice('DocsInfra'.length);

              return (
                <li key={sectionName} className={styles.section}>
                  <span className={styles.sectionTitle}>{displayName}</span>
                  {section.pages && (
                    <ul className={styles.pageList}>
                      {section.pages.map((page, i) => {
                        const url = page.path
                          ? `/docs-infra/${displayName.toLowerCase()}/${page.path.replace(/^\.\//, '').replace(/\/page\.mdx$/, '')}`
                          : '#';
                        const isSelected = pathname === url;

                        return (
                          <li key={i} className={styles.pageItem}>
                            <Link
                              href={url}
                              className={`${styles.pageLink} ${isSelected ? styles.selected : ''}`}
                              onClick={closeNav}
                              aria-current={isSelected ? 'page' : undefined}
                            >
                              {page.title}
                              {page.tags?.includes('New') && (
                                <span className={styles.new}>New</span>
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
        </ul>
      </nav>

      {isOpen && (
        <div
          className={styles.overlay}
          onClick={closeNav}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              closeNav();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close navigation"
        />
      )}
    </React.Fragment>
  );
}
