/**
 * Core GitHub OAuth authentication utilities
 *
 * This utility provides core GitHub OAuth functionality using openid-client.
 * It handles token storage, refresh, and device flow initiation.
 * CLI-specific user interaction is handled in cli/cmdGithubAuth.mjs.
 *
 */

import {
  createDeviceCode,
  exchangeDeviceCode,
  refreshToken as ghRefreshToken,
} from '@octokit/oauth-methods';
import clipboardy from 'clipboardy';
import open from 'open';
import chalk from 'chalk';

import * as credentials from './credentials.mjs';

const GITHUB_APP_CLIENT_ID = 'Iv23lilHsGU3i1tIARsT'; // MUI Code Infra Oauth App
// Use the client id as the key so that if it changes, we don't conflict with old tokens
const GITHUB_APP_CREDENTIAL_KEY = GITHUB_APP_CLIENT_ID;

/**
 * @typedef {Object} GitHubAppAuthenticationWithRefreshToken
 * @property {string} token - The access token
 * @property {string} [expiresAt] - ISO string when the access token expires
 * @property {string} [refreshToken] - The refresh token
 * @property {string} [refreshTokenExpiresAt] - ISO string when the refresh token expires
 */

export function persistentAuthStrategy() {
  /**
   * Request hook to add authentication token to requests.
   * Automatically handles token refresh on 401 errors.
   *
   * @param {import('@octokit/types').RequestInterface} request
   * @param {import('@octokit/types').Route} route
   * @param {import('@octokit/types').RequestParameters} parameters
   * @returns
   */
  async function hook(request, route, parameters) {
    const token = await endToEndGhAuthGetToken({ log: true });
    const endpoint = request.endpoint.merge(route, parameters);
    endpoint.headers.authorization = `token ${token}`;
    try {
      // @ts-expect-error - request.endpoint.merge doesn't return correct type
      return await request(endpoint);
    } catch (error) {
      const err =
        /** @type {import('@octokit/types').RequestError & {response: {data: {message: string}}}} */ (
          error
        );
      if (err.status === 401 && err.response.data.message.toLowerCase() === 'bad credentials') {
        // refresh token and retry again
        await clearGitHubAuth();
        const newToken = await endToEndGhAuthGetToken();
        endpoint.headers.authorization = `token ${newToken}`;
        // @ts-expect-error - request.endpoint.merge doesn't return correct type
        return await request(endpoint);
      }
      throw error;
    }
  }

  return { hook };
}

/**
 * @param {Object} data
 * @param {string} data.url
 * @param {string} data.code
 * @param {Object} options
 * @param {boolean} [options.openInBrowser=true] - Whether to open the URL in the default browser
 * @param {boolean} [options.copyToClipboard=true] - Whether to copy the code to clipboard
 * @returns {Promise<void>}
 */
async function logAuthInformation(data, { openInBrowser = true, copyToClipboard = true } = {}) {
  if (copyToClipboard) {
    await clipboardy.write(data.code);
    console.warn(`Pasted authentication code ${chalk.bold(data.code)} to system clipboard...`);
  } else {
    console.warn(`To authenticate, paste "${chalk.bold(data.code)}" when prompted.`);
  }
  if (openInBrowser) {
    console.warn(`Opening ${chalk.bold(data.url)} in default browser, or goto the link manually.`);
    await open(data.url);
  } else {
    console.warn(`Open ${data.url} in your browser to authenticate.`);
  }
}

/**
 * Checks if the stored access token is expired
 * @returns {Promise<boolean>}
 */
async function isTokenExpired() {
  try {
    const tokens = await getCredentialData();

    if (tokens.expiresAt) {
      return Date.now() > new Date(tokens.expiresAt).getTime();
    }

    if (tokens.refreshTokenExpiresAt) {
      return Date.now() > new Date(tokens.refreshTokenExpiresAt).getTime();
    }
    return false;
  } catch (error) {
    return true; // If we can't get expiry, assume expired
  }
}

/**
 *
 * @returns {Promise<GitHubAppAuthenticationWithRefreshToken>} Stored GitHub authentication tokens
 */
async function getCredentialData() {
  const data = await credentials.getPassword(GITHUB_APP_CREDENTIAL_KEY);
  if (!data) {
    return {
      token: '',
    };
  }
  return /** @type {GitHubAppAuthenticationWithRefreshToken} */ (JSON.parse(data));
}

/**
 * Stores GitHub authentication tokens securely
 * @param {{token: string, refreshToken?: string, expiresAt?: string; refreshTokenExpiresAt?: string}} tokens - Token response from openid-client
 * @returns {Promise<void>}
 */
async function storeGitHubTokens(tokens) {
  /**
   * @type {GitHubAppAuthenticationWithRefreshToken}
   */
  const newTokens = {
    token: tokens.token,
    expiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
  };

  await credentials.setPassword(GITHUB_APP_CREDENTIAL_KEY, JSON.stringify(newTokens));
}

/**
 * @returns {Promise<string>} Refreshed GitHub access token
 */
async function refreshAccessToken() {
  const tokenData = await getCredentialData();
  if (!tokenData.refreshToken) {
    return await doGithubAuth();
  }
  if (
    tokenData.refreshTokenExpiresAt &&
    Date.now() > new Date(tokenData.refreshTokenExpiresAt).getTime()
  ) {
    // Refresh token has also expired. Need to re-authenticate
    await clearGitHubAuth();
    return await doGithubAuth();
  }
  const { authentication } = await ghRefreshToken({
    clientId: GITHUB_APP_CLIENT_ID,
    refreshToken: tokenData.refreshToken,
    clientType: 'github-app',
    clientSecret: '',
  });
  storeGitHubTokens(authentication);
  return authentication.token;
}

/**
 * @returns {Promise<{url: string, code: string; deviceCode: string}>} Device flow response with verification URI and user code
 */
async function getAuthInformation() {
  const { data } = await createDeviceCode({
    clientId: GITHUB_APP_CLIENT_ID,
    clientType: 'github-app',
  });
  return {
    url: data.verification_uri,
    code: data.user_code,
    deviceCode: data.device_code,
  };
}

/**
 * Retries exchanging device code for tokens until success or timeout.
 * Defaults to 12 retries with 5s delay (1 minute total).
 * Has initial delay to allow user to enter code in browser.
 *
 * @param {string} deviceCode
 * @param {{delay?: number, retries?: number}} [options]
 * @returns {Promise<import('@octokit/oauth-methods').GitHubAppAuthenticationWithRefreshToken>}
 */
async function exchangeDeviceCodeWithRetry(deviceCode, { delay = 5000, retries = 12 } = {}) {
  if (delay) {
    await new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }
  try {
    const { authentication } = await exchangeDeviceCode({
      clientId: GITHUB_APP_CLIENT_ID,
      clientType: 'github-app',
      code: deviceCode,
    });
    return /** @type {import('@octokit/oauth-methods').GitHubAppAuthenticationWithRefreshToken} */ (
      authentication
    );
  } catch (/** @type {any} */ ex) {
    if (ex.response.data.error !== 'authorization_pending') {
      throw ex; // Some other error
    }
    if (retries > 0) {
      console.warn('Retrying device code exchange...');
      return exchangeDeviceCodeWithRetry(deviceCode, { delay, retries: retries - 1 });
    }
    throw new Error(`[github-auth]: Timed out waiting for user authentication`);
  }
}

async function doGithubAuth() {
  const data = await getAuthInformation();
  await logAuthInformation(data);
  const tokens = await exchangeDeviceCodeWithRetry(data.deviceCode);
  await storeGitHubTokens(tokens);
  return tokens.token;
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.log=false] - Whether to log progress to console
 * @returns {Promise<string>} Valid GitHub access token
 */
export async function endToEndGhAuthGetToken({ log = false } = {}) {
  const tokenData = await getCredentialData();
  if (!tokenData.token) {
    if (log) {
      console.warn("🔍 GitHub token doesn't exist. Starting authentication flow...");
    }
    return await doGithubAuth();
  }

  if (await isTokenExpired()) {
    if (log) {
      console.warn('GitHub token expired. Attempting to refresh...');
    }
    return refreshAccessToken();
  }

  return tokenData.token;
}

/**
 * Clears stored GitHub authentication tokens
 * @returns {Promise<void>}
 */
export async function clearGitHubAuth() {
  await credentials.deleteKey(GITHUB_APP_CREDENTIAL_KEY);
}
