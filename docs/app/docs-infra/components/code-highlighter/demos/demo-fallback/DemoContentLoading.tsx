'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from '../CodeBlockHeader';
import { CodeSource } from '../CodeSource';
import styles from '../DemoContent.module.css';
import loadingStyles from './DemoContentLoading.module.css';

export function DemoContentLoading(props: ContentLoadingProps<object>) {
  // @focus-start
  // `useCodeFallback` decodes the compact fallback (and hoists it as the DEFLATE
  // dictionary). The semantic `<section><figure><dl>` markup puts the filename in
  // a `<dt>` and the source in a `<dd>` so `transformHtmlCodeBlock` / crawlers
  // can parse both; CSS hides the `<dt>` since the header already shows it.
  const { source } = useCodeFallback(props);
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
    // No-op while loading.
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
                {source && (
                  <React.Fragment>
                    <dt>
                      <code>{firstFileName}</code>
                    </dt>
                    <dd>
                      <CodeSource>
                        <pre className={styles.codeBlock}>
                          <code className={language ? `language-${language}` : undefined}>
                            {hastToJsx(source)}
                          </code>
                        </pre>
                      </CodeSource>
                    </dd>
                  </React.Fragment>
                )}
              </dl>
            </figure>
          </section>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
