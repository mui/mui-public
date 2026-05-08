export type ChatMessage = {
  id: string;
  author: string;
  time: string;
  body: string;
};

export const initialMessages: ChatMessage[] = [
  {
    id: 'm1',
    author: 'priya',
    time: '09:14',
    body: 'Smoke tests are green. Going to start the canary in five.',
  },
  {
    id: 'm2',
    author: 'leo',
    time: '09:15',
    body: 'Cool. I have the dashboard open if anything spikes.',
  },
  {
    id: 'm3',
    author: 'priya',
    time: '09:18',
    body: 'Canary is live. 5% of traffic on release-2.4.0.',
  },
  {
    id: 'm4',
    author: 'leo',
    time: '09:20',
    body: 'Error rate flat. Latency p95 within 2ms of baseline.',
  },
  {
    id: 'm5',
    author: 'priya',
    time: '09:24',
    body: 'Bumping to 25%.',
  },
];

// Older messages that "stream in" from the server, oldest first. They will
// be prepended to the top of the chat one at a time.
export const olderHistory: ChatMessage[] = [
  {
    id: 'h1',
    author: 'priya',
    time: '08:42',
    body: 'Heads up — release-2.4.0 build just finished. Lint and unit are green.',
  },
  {
    id: 'h2',
    author: 'leo',
    time: '08:45',
    body: 'Nice. I will set up the staging deploy after standup.',
  },
  {
    id: 'h3',
    author: 'priya',
    time: '08:51',
    body: 'Actually I can take it. Want to keep moving on this one.',
  },
  {
    id: 'h4',
    author: 'leo',
    time: '08:52',
    body: 'All yours. Ping me when smoke tests start.',
  },
  {
    id: 'h5',
    author: 'priya',
    time: '09:02',
    body: 'Bundle uploaded. Smoke tests starting now across 3 regions.',
  },
];
