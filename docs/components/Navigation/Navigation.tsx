'use client';

import * as React from 'react';
import Link from 'next/link';
import styles from './Navigation.module.css';

export function Navigation({ sitemap }: { sitemap?: { schema: {}; data: {} } }) {
  const [isOpen, setIsOpen] = React.useState(false);

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
            .map(([sectionName, section]: [string, any]) => {
              const displayName = sectionName.slice('DocsInfra'.length);

              return (
                <li key={sectionName} className={styles.section}>
                  <span className={styles.sectionTitle}>{displayName}</span>
                  {section.pages && (
                    <ul className={styles.pageList}>
                      {section.pages.map((page: any, i: number) => {
                        const url = page.path
                          ? `/docs-infra/${displayName.toLowerCase()}/${page.path.replace(/^\.\//, '').replace(/\/page\.mdx$/, '')}`
                          : '#';

                        return (
                          <li key={i} className={styles.pageItem}>
                            <Link href={url} className={styles.pageLink} onClick={closeNav}>
                              {page.title}
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
