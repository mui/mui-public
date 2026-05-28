'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from '../CodeBlockHeader';
import styles from '../DemoContent.module.css';
import loadingStyles from './DemoContentLoading.module.css';

import '../syntax.css';

export function DemoContentLoading(props: ContentLoadingProps<object>) {
  // @focus-start
  const mainSlug = props.slug ?? '';
  const mainVariant = props.initialVariant ?? 'Default';
  const tabs = React.useMemo(
    () =>
      props.fileNames?.map((name) => ({
        id: name || '',
        name: name || '',
        slug: generateFileSlug(mainSlug, name || '', mainVariant),
      })),
    [props.fileNames, mainSlug, mainVariant],
  );

  const onTabSelect = React.useCallback(() => {
    // No-op
  }, []);

  const firstFileName = props.fileNames?.[0];
  const showTabs = !!tabs && tabs.length > 1;
  const { language } = props;

  return (
    <div>
      {(props.fileNames || []).map((name) => {
        const slug = generateFileSlug(mainSlug, name, mainVariant);
        return <span key={slug} id={slug} className={styles.fileRefs} />;
      })}
      <div className={styles.container}>
        <div className={styles.demoSection}>
          <div className={styles.demoSurface}>{props.component}</div>
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
          <section className={loadingStyles.files}>
            <figure>
              <dl>
                {props.source && (
                  <React.Fragment>
                    <dt>
                      <code>{firstFileName}</code>
                    </dt>
                    <dd>
                      <pre className={styles.codeBlock}>
                        <code className={language ? `language-${language}` : undefined}>
                          <span className="frame">{props.source}</span>
                        </code>
                      </pre>
                    </dd>
                  </React.Fragment>
                )}
                {Object.entries(props.extraSource || {}).map(([fileName, entry]) => (
                  <React.Fragment key={fileName}>
                    <dt>
                      <code>{fileName}</code>
                    </dt>
                    <dd>
                      <pre className={styles.codeBlock}>
                        <code className={entry.language ? `language-${entry.language}` : undefined}>
                          <span className="frame">{entry.source}</span>
                        </code>
                      </pre>
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </figure>
          </section>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
