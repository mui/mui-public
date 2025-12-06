import * as React from 'react';
import type { SearchResult } from '@mui/internal-docs-infra/useSearch/types';
import { FileText, Blocks, Package, Heading2, Heading3 } from 'lucide-react';
import styles from './SearchItem.module.css';

interface SearchItemProps {
  result: SearchResult;
}

export function SearchItem({ result }: SearchItemProps) {
  return (
    <React.Fragment>
      <div className={styles.container}>
        <div className={styles.left}>
          {result.type === 'page' && <FileText className={styles.icon} />}
          {result.type === 'part' && <Blocks className={styles.icon} />}
          {result.type === 'export' && <Package className={styles.icon} />}
          {result.type === 'section' && <Heading2 className={styles.icon} />}
          {result.type === 'subsection' && <Heading3 className={styles.icon} />}
          <strong className={styles.title}>{result.title}</strong>
          {result.type === 'page' && (
            <span className={styles.sectionTitle}>{result.sectionTitle.replace('React ', '')}</span>
          )}
        </div>
        {process.env.NODE_ENV === 'development' && result.score && (
          <span className={styles.score}>{result.score.toFixed(2)}</span>
        )}
      </div>
      {result.type === 'page' && result.description && (
        <div className={styles.description}>{result.description}</div>
      )}
    </React.Fragment>
  );
}
