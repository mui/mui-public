'use client';
import * as React from 'react';
import type { ChatMessage } from './messages';
import styles from './Safari.module.css';

type ChatProps = {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  listRef?: React.RefObject<HTMLOListElement | null>;
  messages: ChatMessage[];
  registerMessage?: (id: string, node: HTMLLIElement | null) => void;
};

export function Chat({ scrollerRef, listRef, messages, registerMessage }: ChatProps) {
  return (
    <div ref={scrollerRef} className={styles.scroller}>
      {/* @focus-start */}
      <ol ref={listRef} className={styles.list}>
        {messages.map((message) => (
          <li
            key={message.id}
            ref={(node) => {
              registerMessage?.(message.id, node);
            }}
            className={styles.message}
          >
            <header className={styles.messageHeader}>
              <span className={styles.author}>{message.author}</span>
              <time className={styles.time}>{message.time}</time>
            </header>
            <p className={styles.body}>{message.body}</p>
          </li>
        ))}
      </ol>
      {/* @focus-end */}
    </div>
  );
}
