'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../app/docs-infra/components/code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../app/docs-infra/components/code-highlighter/demos/CodeBlockHeader';
import { CodeSource } from '../../app/docs-infra/components/code-highlighter/demos/CodeSource';
import styles from '../../app/docs-infra/components/code-highlighter/demos/DemoContent.module.css';
import benchStyles from '../BenchViewer/BenchViewer.module.css';

export function DemoPerformanceContentLoading(props: ContentLoadingProps<object>) {
  const { source } = useCodeFallback(props);
  const mainSlug = props.slug ?? '';
  const tabs = React.useMemo(
    () =>
      props.fileNames?.map((name) => ({
        id: name || '',
        name: name || '',
        slug: generateFileSlug(mainSlug, name || '', 'Default'),
      })),
    [props.fileNames, mainSlug],
  );

  const onTabSelect = React.useCallback(() => {
    // No-op
  }, []);

  const firstFileName = props.fileNames?.[0];
  const showTabs = !!tabs && tabs.length > 1;

  return (
    <div>
      {(props.fileNames || []).map((name) => {
        const slug = generateFileSlug(mainSlug, name, 'Default');
        return <span key={slug} id={slug} className={styles.fileRefs} />;
      })}
      <div className={styles.container}>
        <div className={styles.demoSection}>
          {/* Disabled stand-in for BenchViewer's "Start Benchmark" button so the
              demo surface reserves its height and doesn't shift when the live
              BenchViewer mounts. */}
          <div className={styles.demoSurface}>
            <div className={benchStyles.Root}>
              <button className={benchStyles.Button} type="button" disabled>
                Start Benchmark
              </button>
            </div>
          </div>
        </div>
        <div className={styles.codeSection}>
          <CodeBlockHeader menu={<CodeActionsMenu loading inline={!showTabs} />}>
            {showTabs && (
              <Tabs tabs={tabs} selectedTabId={firstFileName} onTabSelect={onTabSelect} disabled />
            )}
            {!showTabs && firstFileName && (
              <CodeBlockHeaderLabel>{firstFileName}</CodeBlockHeaderLabel>
            )}
          </CodeBlockHeader>
          <CodeSource className={styles.code}>
            <pre className={styles.codeBlock}>
              {/* `data-filename` lets `transformHtmlCodeBlock` / crawlers read the
                  file name; the source is the code element's text content. */}
              <code data-filename={firstFileName}>{source ? hastToJsx(source) : null}</code>
            </pre>
          </CodeSource>
        </div>
      </div>
    </div>
  );
}
