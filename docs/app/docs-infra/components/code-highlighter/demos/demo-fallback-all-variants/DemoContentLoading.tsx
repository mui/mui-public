'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import {
  generateFileSlug,
  getLanguageFromExtension,
} from '@mui/internal-docs-infra/pipeline/loaderUtils';
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

/** Derive a `language-*` hint from a file name's extension (e.g. `.tsx` → `tsx`). */
function languageForFile(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? getLanguageFromExtension(fileName.slice(dot)) : undefined;
}

export function DemoContentLoading(props: ContentLoadingProps<object>) {
  // @focus-start
  // `useCodeFallback` decodes the compact per-file fallbacks (and hoists them as
  // the DEFLATE dictionary). The semantic `<section><figure><dl>` markup keeps
  // every file/variant in the DOM for crawlers; CSS shows only the initial
  // variant's main file.
  const { source, extraSource, extraVariants, totalLines, focusedLines, collapsible } =
    useCodeFallback(props);
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
      {Object.keys(extraVariants || {}).flatMap((variantName) =>
        (extraVariants?.[variantName]?.fileNames || []).map((name) => {
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
          <section className={loadingStyles.variants}>
            <figure className={loadingStyles.variant}>
              <figcaption>{mainVariant} variant</figcaption>
              <dl>
                {source && (
                  <React.Fragment>
                    <dt>
                      <code>{firstFileName}</code>
                    </dt>
                    <dd>
                      <pre className={styles.codeBlock}>
                        <code
                          className={language ? `language-${language}` : undefined}
                          data-filename={firstFileName}
                          data-collapsible={collapsible ? '' : undefined}
                          data-total-lines={totalLines}
                          data-focused-lines={focusedLines}
                        >
                          {hastToJsx(source)}
                        </code>
                      </pre>
                    </dd>
                  </React.Fragment>
                )}
                {Object.entries(extraSource || {}).map(([fileName, file]) => {
                  const fileLanguage = languageForFile(fileName);
                  return (
                    <React.Fragment key={fileName}>
                      <dt>
                        <code>{fileName}</code>
                      </dt>
                      <dd>
                        <pre className={styles.codeBlock}>
                          <code
                            className={fileLanguage ? `language-${fileLanguage}` : undefined}
                            data-filename={fileName}
                            data-collapsible={file.collapsible ? '' : undefined}
                            data-total-lines={file.totalLines}
                            data-focused-lines={file.focusedLines}
                          >
                            {hastToJsx(file.source)}
                          </code>
                        </pre>
                      </dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            </figure>
            {Object.keys(extraVariants || {}).map((variantName) => {
              const variant = extraVariants?.[variantName];
              if (!variant) {
                return null;
              }
              const variantMainFile = variant.fileNames?.[0];
              const variantLanguage = languageForFile(variantMainFile);
              return (
                <figure key={variantName} className={loadingStyles.variant}>
                  <figcaption>{variantName} variant</figcaption>
                  <dl>
                    {variant.source && (
                      <React.Fragment>
                        <dt>
                          <code>{variantMainFile}</code>
                        </dt>
                        <dd>
                          <pre className={styles.codeBlock}>
                            <code
                              className={
                                variantLanguage ? `language-${variantLanguage}` : undefined
                              }
                              data-filename={variantMainFile}
                              data-collapsible={variant.collapsible ? '' : undefined}
                              data-total-lines={variant.totalLines}
                              data-focused-lines={variant.focusedLines}
                            >
                              {hastToJsx(variant.source)}
                            </code>
                          </pre>
                        </dd>
                      </React.Fragment>
                    )}
                    {Object.entries(variant.extraSource || {}).map(([fileName, file]) => {
                      const fileLanguage = languageForFile(fileName);
                      return (
                        <React.Fragment key={fileName}>
                          <dt>
                            <code>{fileName}</code>
                          </dt>
                          <dd>
                            <pre className={styles.codeBlock}>
                              <code
                                className={fileLanguage ? `language-${fileLanguage}` : undefined}
                                data-filename={fileName}
                                data-collapsible={file.collapsible ? '' : undefined}
                                data-total-lines={file.totalLines}
                                data-focused-lines={file.focusedLines}
                              >
                                {hastToJsx(file.source)}
                              </code>
                            </pre>
                          </dd>
                        </React.Fragment>
                      );
                    })}
                  </dl>
                </figure>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
