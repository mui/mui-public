'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from '../CodeBlockHeader';
import { DemoVariantBar } from '../DemoVariantBar';
import styles from '../DemoContent.module.css';
import loadingStyles from './DemoContentLoading.module.css';

import '../syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

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
  const variants = React.useMemo(
    () =>
      Object.keys(props.components || {}).map((variant) => ({
        value: variant,
        label: variantNames[variant] || variant,
      })),
    [props.components],
  );

  const onTabSelect = React.useCallback(() => {
    // Handle tab selection
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
      {Object.entries(props.extraVariants || {}).flatMap(([variantName, variant]) =>
        (variant.fileNames || []).map((name) => {
          const slug = generateFileSlug(mainSlug, name, variantName);
          return <span key={slug} id={slug} className={styles.fileRefs} />;
        }),
      )}
      <div className={styles.container}>
        <div className={styles.demoSection}>
          <DemoVariantBar variants={variants} selectedVariant={variants[0]?.value} disabled />
          <div className={`${styles.demoSurface} demo`}>{props.component}</div>
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
          <section className={loadingStyles.variants}>
            <figure className={loadingStyles.variant}>
              <figcaption>{mainVariant} variant</figcaption>
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
            {Object.entries(props.extraVariants || {}).map(([variantName, variant]) => (
              <figure key={variantName} className={loadingStyles.variant}>
                <figcaption>{variantName} variant</figcaption>
                <dl>
                  {variant.source && (
                    <React.Fragment>
                      <dt>
                        <code>{variant.fileNames?.[0]}</code>
                      </dt>
                      <dd>
                        <pre className={styles.codeBlock}>
                          <code
                            className={
                              variant.language ? `language-${variant.language}` : undefined
                            }
                          >
                            <span className="frame">{variant.source}</span>
                          </code>
                        </pre>
                      </dd>
                    </React.Fragment>
                  )}
                  {Object.entries(variant.extraSource || {}).map(([fileName, entry]) => (
                    <React.Fragment key={fileName}>
                      <dt>
                        <code>{fileName}</code>
                      </dt>
                      <dd>
                        <pre className={styles.codeBlock}>
                          <code
                            className={entry.language ? `language-${entry.language}` : undefined}
                          >
                            <span className="frame">{entry.source}</span>
                          </code>
                        </pre>
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              </figure>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
