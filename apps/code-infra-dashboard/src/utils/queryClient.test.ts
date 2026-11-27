// @vitest-environment jsdom
import { vi, describe, it, expect, afterEach } from 'vitest';
import { Octokit } from '@octokit/rest';
import { sessionQueryOptions } from '../hooks/useSession';
import { queryClient } from './queryClient';

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

/** A real Octokit whose single request GitHub (or the proxy) answers with `status`. */
function octokitAnswering(status: number): Octokit {
  const fakeFetch: typeof fetch = async () => Response.json({ message: 'Rejected' }, { status });
  vi.stubGlobal('fetch', fakeFetch);
  return new Octokit();
}

function seedSignedInSession() {
  queryClient.setQueryData(sessionQueryOptions.queryKey, {
    available: true,
    signedIn: true,
    login: 'octocat',
  });
}

async function runFailingQuery(octokit: Octokit) {
  await queryClient
    .fetchQuery({
      queryKey: ['github', 'user'],
      queryFn: () => octokit.rest.users.getAuthenticated(),
      retry: false,
    })
    .catch(() => {});
}

describe('queryClient', () => {
  // The proxy answers 401 once the session is over: its token expired with the
  // cookie, or the user revoked the app. The session has to be re-read for the
  // components to switch to anonymous requests.
  it('marks the session stale when a GitHub query is rejected with a 401', async () => {
    seedSignedInSession();

    await runFailingQuery(octokitAnswering(401));

    expect(queryClient.getQueryState(sessionQueryOptions.queryKey)?.isInvalidated).toBe(true);
  });

  it('leaves the session alone for other failures', async () => {
    seedSignedInSession();

    await runFailingQuery(octokitAnswering(404));

    expect(queryClient.getQueryState(sessionQueryOptions.queryKey)?.isInvalidated).toBe(false);
  });
});

describe('queryClient across tabs', () => {
  const openChannels: BroadcastChannel[] = [];

  afterEach(() => {
    openChannels.splice(0).forEach((channel) => channel.close());
  });

  /** Another tab of the dashboard, listening on the same channel. */
  function otherTab() {
    const channel = new BroadcastChannel('dashboard-session');
    openChannels.push(channel);
    const messages: unknown[] = [];
    channel.addEventListener('message', (event) => messages.push(event.data));
    return { channel, messages };
  }

  async function readSession(session: object) {
    vi.stubGlobal('fetch', async () => Response.json(session));
    await queryClient.fetchQuery({ ...sessionQueryOptions, staleTime: 0 });
    // BroadcastChannel delivers on a later task.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  it('tells the other tabs when the session changes, and only then', async () => {
    await readSession({ available: true, signedIn: true, login: 'hubot' });
    const tab = otherTab();

    await readSession({ available: true, signedIn: true, login: 'hubot' });
    expect(tab.messages).toHaveLength(0);

    await readSession({ available: true, signedIn: false });
    expect(tab.messages).toHaveLength(1);
  });

  it('reads the session again when another tab announces a change', async () => {
    const tab = otherTab();
    seedSignedInSession();

    tab.channel.postMessage(null);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(queryClient.getQueryState(sessionQueryOptions.queryKey)?.isInvalidated).toBe(true);
  });
});
