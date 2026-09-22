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

/**
 * Where GitHub sends the user back. Must be registered as a callback URL on the
 * GitHub App. Derived from DASHBOARD_ORIGIN rather than from the request's Host
 * header, which a client controls and which would make this an open redirect.
 */
export const REDIRECT_URI = `${DASHBOARD_ORIGIN}/api/auth/callback`;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * The GitHub App backing the browser login. Returns null when unconfigured so
 * that a deploy without these secrets degrades to the anonymous experience
 * rather than failing to boot.
 */
export function getOAuthClient(): OAuthClient | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}
