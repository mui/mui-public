import * as React from 'react';
import styles from './Blockquote.module.css';

type BlockquoteProps = {
  children: React.ReactNode;
  [key: string]: unknown; // Allow additional props
};

const svg: Record<string, React.ReactNode> = {
  note: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16ZM6.93 3.75c.13-.27.42-.75 1.07-.75s.94.48 1.07.75c.22.45.35 1.15.35 2.25s-.13 1.8-.35 2.25c-.13.27-.42.75-1.07.75s-.94-.48-1.07-.75C6.71 7.8 6.58 7.1 6.58 6s.13-1.8.35-2.25ZM8 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
        fill="currentColor"
      />
    </svg>
  ),
  tip: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12.25a.25.25 0 0 1 .25-.25h4a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-4a.25.25 0 0 1-.25-.25v-.5ZM6 15.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25v-.5Z"
        fill="currentColor"
      />
    </svg>
  ),
  important: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.5 1.5 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25H1.75ZM8 3.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 3.5ZM8 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
        fill="currentColor"
      />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047Zm1.08.638L1.455 13.063a.25.25 0 0 0 .22.437h12.165a.25.25 0 0 0 .22-.368L7.98 1.685a.25.25 0 0 0-.443 0ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm1 5.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  ),
  caution: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53L4.47.22Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5H5.31ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        fill="currentColor"
      />
    </svg>
  ),
};

export default function Blockquote(props: BlockquoteProps) {
  const { children, ...otherProps } = props;

  let calloutType =
    typeof props['data-callout-type'] === 'string' ? props['data-callout-type'] : undefined;
  const icon = calloutType && svg[calloutType];

  if (calloutType) {
    calloutType = `${calloutType.charAt(0).toUpperCase()}${calloutType.slice(1)}`;
  }

  return (
    <blockquote {...otherProps} className={styles.root}>
      {calloutType && (
        <p className={styles.title}>
          {icon}
          {calloutType}
        </p>
      )}
      {children}
    </blockquote>
  );
}
