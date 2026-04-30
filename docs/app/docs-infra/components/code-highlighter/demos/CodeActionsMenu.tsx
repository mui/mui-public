'use client';

import * as React from 'react';
import { Menu } from '@base-ui/react/menu';
import { Select } from '@/components/Select';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import styles from './CodeActionsMenu.module.css';

export interface CodeActionsMenuProps {
  onCopy?: (event: React.MouseEvent<Element>) => void | Promise<void>;
  /**
   * Copies all files in the current variant as a Markdown snippet (heading
   * + per-file fenced code blocks). Provide only on multi-file demos and
   * code blocks; single-file callers should leave this `undefined`.
   */
  onCopyMarkdown?: (event: React.MouseEvent<Element>) => void | Promise<void>;
  fileUrl?: string;
  fileName?: string;
  jsTransform?: {
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
  };
  variants?: {
    items: { label: string; value: string }[];
    selected?: string;
    onChange: (value: string) => void;
  };
  /**
   * Render actions as a row of icon buttons in the header instead of as a
   * popup menu. Use for single-file code blocks where there's plenty of
   * horizontal room. The same icons are used in both modes.
   */
  inline?: boolean;
  loading?: boolean;
}

export function CodeActionsMenu({
  onCopy,
  onCopyMarkdown,
  fileUrl,
  fileName,
  jsTransform,
  variants,
  inline,
  loading,
}: CodeActionsMenuProps) {
  // Hide the GitHub link when the URL is a local `file://` URL — that means
  // the build-time URL rewrite was skipped (e.g. for server-loaded demos) and
  // the link wouldn't be navigable from the browser.
  const externalFileUrl = fileUrl && !fileUrl.startsWith('file://') ? fileUrl : undefined;
  // @focus-start @padding 1
  if (inline) {
    if (loading) {
      return (
        <div className={styles.inlineActions}>
          {jsTransform && (
            <button
              type="button"
              className={styles.inlineIconButton}
              aria-label="Toggle JavaScript"
              disabled
            >
              <CheckIcon />
            </button>
          )}
          <button type="button" className={styles.inlineIconButton} aria-label="Copy code" disabled>
            <CopyIcon />
          </button>
        </div>
      );
    }
    return (
      <div className={styles.inlineActions}>
        {variants && variants.items.length > 1 && (
          <Select
            items={variants.items}
            value={variants.selected}
            onValueChange={(value) => value && variants.onChange(value)}
          />
        )}
        {jsTransform && (
          <LabeledSwitch
            checked={jsTransform.enabled}
            onCheckedChange={jsTransform.onToggle}
            labels={{ false: 'TS', true: 'JS' }}
          />
        )}
        {onCopy && (
          <InlineIconButton
            onClick={onCopy}
            label={fileName ? `Copy ${fileName}` : 'Copy code'}
            icon={<CopyIcon />}
          />
        )}
        {externalFileUrl && (
          <a
            className={styles.inlineIconButton}
            href={externalFileUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={fileName ? `Open ${fileName} in GitHub` : 'Open in GitHub'}
          >
            <GitHubIcon />
          </a>
        )}
        {onCopyMarkdown && (
          <InlineIconButton
            onClick={onCopyMarkdown}
            label="Copy all files as Markdown"
            icon={<MarkdownIcon />}
          />
        )}
      </div>
    );
  }

  const handleCopy = (event: React.MouseEvent<Element>) => {
    onCopy?.(event);
  };

  const handleCopyMarkdown = (event: React.MouseEvent<Element>) => {
    onCopyMarkdown?.(event);
  };

  if (loading) {
    return (
      <button type="button" className={styles.menuTrigger} aria-label="More actions" disabled>
        <span className={styles.menuTriggerInner}>
          <MoreIcon />
        </span>
      </button>
    );
  }

  return (
    <Menu.Root>
      <Menu.Trigger className={styles.menuTrigger} aria-label="More actions" type="button">
        <span className={styles.menuTriggerInner}>
          <MoreIcon />
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" alignOffset={2} arrowPadding={3}>
          <Menu.Popup className={styles.menuPopup}>
            <Menu.Arrow className={styles.menuArrow}>
              <ArrowIcon />
            </Menu.Arrow>
            {onCopy && (
              <Menu.Item className={styles.menuItem} onClick={handleCopy}>
                <span className={styles.menuItemIcon} aria-hidden>
                  <CopyIcon />
                </span>
                {fileName ? `Copy ${fileName}` : 'Copy code'}
              </Menu.Item>
            )}
            {externalFileUrl && (
              <Menu.Item
                className={styles.menuItem}
                render={
                  <a href={externalFileUrl} target="_blank" rel="noreferrer noopener">
                    <span className={styles.menuItemIcon} aria-hidden>
                      <GitHubIcon />
                    </span>
                    {fileName ? `Open ${fileName} in GitHub` : 'Open in GitHub'}
                  </a>
                }
                closeOnClick
              />
            )}
            {onCopyMarkdown && (
              <Menu.Item className={styles.menuItem} onClick={handleCopyMarkdown}>
                <span className={styles.menuItemIcon} aria-hidden>
                  <MarkdownIcon />
                </span>
                Copy all files as Markdown
              </Menu.Item>
            )}
            {jsTransform && (
              <React.Fragment>
                <div className={styles.menuSeparator} role="separator" />
                <Menu.CheckboxItem
                  className={styles.menuItem}
                  checked={jsTransform.enabled}
                  onCheckedChange={jsTransform.onToggle}
                  closeOnClick={false}
                >
                  <span className={styles.menuItemIcon} aria-hidden>
                    {jsTransform.enabled ? <CheckIcon /> : null}
                  </span>
                  Transpile to JavaScript
                </Menu.CheckboxItem>
              </React.Fragment>
            )}
            {variants && variants.items.length > 1 && (
              <React.Fragment>
                <div className={styles.menuSeparator} role="separator" />
                <Menu.RadioGroup value={variants.selected} onValueChange={variants.onChange}>
                  {variants.items.map((item) => (
                    <Menu.RadioItem
                      key={item.value}
                      value={item.value}
                      className={styles.menuItem}
                      closeOnClick
                    >
                      <span className={styles.menuItemIcon} aria-hidden>
                        <Menu.RadioItemIndicator>
                          <CheckIcon />
                        </Menu.RadioItemIndicator>
                      </span>
                      {item.label}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </React.Fragment>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
  // @focus-end
}

function InlineIconButton({
  onClick,
  label,
  icon,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button type="button" className={styles.inlineIconButton} onClick={onClick} aria-label={label}>
      {icon}
    </button>
  );
}

function MoreIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" {...props}>
      <circle cx="8" cy="2" r="2" />
      <circle cx="8" cy="10" r="2" />
      <circle cx="8" cy="18" r="2" />
    </svg>
  );
}

function CopyIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MarkdownIcon(props: React.ComponentProps<'svg'>) {
  // GitHub's Markdown mark, simplified.
  return (
    <svg width="16" height="12" viewBox="0 0 208 128" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M193 0H15C6.7 0 0 6.7 0 15v98c0 8.3 6.7 15 15 15h178c8.3 0 15-6.7 15-15V15c0-8.3-6.7-15-15-15zM30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39H30zm125 0l-30-33h20V30h20v35h20l-30 33z"
      />
    </svg>
  );
}

function GitHubIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function CheckIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor" {...props}>
      <path d="M9.1603 1.12218C9.50684 1.34873 9.60427 1.81354 9.37792 2.16038L5.13603 8.66012C5.01614 8.8438 4.82192 8.96576 4.60451 8.99384C4.3871 9.02194 4.1683 8.95335 4.00574 8.80615L1.24664 6.30769C0.939709 6.02975 0.916013 5.55541 1.19372 5.24822C1.47142 4.94102 1.94536 4.91731 2.2523 5.19524L4.36085 7.10461L8.12299 1.33999C8.34934 0.993152 8.81376 0.895638 9.1603 1.12218Z" />
    </svg>
  );
}

function ArrowIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg width="20" height="10" viewBox="0 0 20 10" fill="none" {...props}>
      <path
        d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
        className={styles.arrowFill}
      />
      <path
        d="M8.99542 1.85876C9.75604 1.17425 10.9106 1.17422 11.6713 1.85878L16.5281 6.22989C17.0789 6.72568 17.7938 7.00001 18.5349 7.00001L15.89 7L11.0023 2.60207C10.622 2.2598 10.0447 2.2598 9.66436 2.60207L4.77734 7L2.13171 7.00001C2.87284 7.00001 3.58774 6.72568 4.13861 6.22989L8.99542 1.85876Z"
        className={styles.arrowOuterStroke}
      />
      <path
        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
        className={styles.arrowInnerStroke}
      />
    </svg>
  );
}
