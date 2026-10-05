import { DASHBOARD_ORIGIN } from '../../constants';

export const SESSION_COOKIE = 'mui_dashboard_session';
export const OAUTH_STATE_COOKIE = 'mui_dashboard_oauth_state';

/** The state cookie only ever travels to the auth routes. */
export const OAUTH_STATE_COOKIE_PATH = '/api/auth';

/** Lifetime of our own session, independent of the GitHub token's lifetime. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Short-lived: the user is only mid-redirect. */
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** Shared by the session and OAuth state cookies. */
export const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  // Render terminates TLS, but local dev is plain http.
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
} as const;

/**
 * Where GitHub sends the user back. Must be registered as a callback URL on the
 * GitHub App. Derived from DASHBOARD_ORIGIN rather than from the request's Host
 * header, which a client controls and which would make this an open redirect.
 */
export const REDIRECT_URI = new URL('/api/auth/callback', DASHBOARD_ORIGIN).toString();

/**
 * The GitHub App backing the browser login, or null wherever sign-in can't
 * complete, so that those deploys degrade to the anonymous experience rather than
 * failing to boot or offering a broken button.
 */
export function getOAuthClient(): { clientId: string; clientSecret: string } | null {
  // Preview deploys serve from a per-pull-request onrender.com origin that can't
  // be registered as a GitHub callback URL, yet they inherit the credentials from
  // the shared environment group. Wildcard callback matching is no way out: GitHub
  // matches every subdomain of the registered host, and we don't control the rest
  // of onrender.com.
  if (process.env.IS_PULL_REQUEST === 'true') {
    return null;
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  // Without a session secret there is nowhere to keep the token we'd receive.
  if (!clientId || !clientSecret || !process.env.SESSION_SECRET) {
    return null;
  }

  return { clientId, clientSecret };
}
