import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter';
import styles from './CustomContentLoading.module.css';

export function CustomContentLoading(props: ContentLoadingProps<{}>) {
  const fileNames = props.fileNames || [];

  return (
    <div className={styles.loadingContainer}>
      <div className={styles.spinnerContainer}>
        <div className={styles.spinner} />
      </div>
      <h3 className={styles.loadingTitle}>Loading Demo...</h3>
      <p className={styles.loadingText}>
        Processing {fileNames.length} file{fileNames.length !== 1 ? 's' : ''}
      </p>
      {fileNames.length > 0 && <div className={styles.fileNames}>{fileNames.join(', ')}</div>}
    </div>
  );
}
