import * as React from 'react';
import { initialMessages, olderHistory } from './messages';
import type { ChatMessage } from './messages';

const STREAM_INTERVAL = 700;

// Simulates a real-world async stream: older messages arrive from the server
// one at a time and prepend to the top of the chat. Each message is a fresh
// DOM mutation above the current scroll position — exactly the case Safari
// can't compensate for.
export function useStreamedHistory({
  onBeforePrepend,
}: {
  onBeforePrepend?: () => void;
} = {}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = React.useState(false);
  const remaining = React.useRef<ChatMessage[]>([]);

  React.useEffect(() => {
    if (!streaming) {
      return undefined;
    }
    const id = setInterval(() => {
      const next = remaining.current.pop();
      if (!next) {
        setStreaming(false);
        return;
      }
      onBeforePrepend?.();
      setMessages((prev) => [next, ...prev]);
    }, STREAM_INTERVAL);
    return () => clearInterval(id);
  }, [streaming, onBeforePrepend]);

  const start = () => {
    if (streaming) {
      return;
    }
    if (messages.length >= initialMessages.length + olderHistory.length) {
      // Reset so the demo can be replayed.
      remaining.current = [...olderHistory];
      setMessages(initialMessages);
    } else {
      remaining.current = olderHistory.slice(
        0,
        olderHistory.length - (messages.length - initialMessages.length),
      );
    }
    setStreaming(true);
  };

  const reset = () => {
    setStreaming(false);
    remaining.current = [];
    setMessages(initialMessages);
  };

  const done = !streaming && messages.length >= initialMessages.length + olderHistory.length;

  return { messages, streaming, start, reset, done };
}
