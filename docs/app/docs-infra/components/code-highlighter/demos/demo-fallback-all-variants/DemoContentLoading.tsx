'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
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
  const { source, extraSource, extraVariants } = useCodeFallback(props);
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
          <div className={styles.code}>
            <pre className={styles.codeBlock}>{source ? hastToJsx(source) : null}</pre>
          </div>
          <div className={loadingStyles.extraFiles}>
            {Object.keys(extraSource || {}).map((slug) => (
              <pre key={slug}>{extraSource?.[slug] ? hastToJsx(extraSource[slug]) : null}</pre>
            ))}
          </div>
          <div className={loadingStyles.extraVariants}>
            {Object.keys(extraVariants || {}).map((slug) => (
              <div key={slug} className={loadingStyles.extraVariant}>
                <span>{slug}</span>
                <pre>
                  {Object.keys(extraVariants?.[slug].extraSource || {}).map((key) => (
                    <div key={key}>
                      <strong>{key}:</strong>{' '}
                      {extraVariants?.[slug]?.extraSource?.[key]
                        ? hastToJsx(extraVariants[slug].extraSource![key])
                        : null}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
