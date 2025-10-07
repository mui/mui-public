/**
 * Secure credential storage for CLI tools
 *
 * Provides secure credential storage for the MUI code infrastructure tools.
 * It uses OS keychain/credential manager to store credentials.
 *
 */

import { AsyncEntry } from '@napi-rs/keyring';

export const KEYRING_SERVICE = 'mui-code-infra';

/**
 * @type {Map<string, AsyncEntry>}
 */
const credentials = new Map();

/**
 * @type {Map<string, string>} In-memory cache for credentials that have been accessed.
 * This is used to avoid multiple prompts for the same credential during a single run.
 */
const accessedCredentials = new Map();

/**
 * @param {string} key
 * @returns {Promise<string | undefined>}
 */
export async function getPassword(key) {
  if (accessedCredentials.has(key)) {
    return accessedCredentials.get(key);
  }
  let credential = credentials.get(key);
  if (!credential) {
    credential = new AsyncEntry(KEYRING_SERVICE, key);
    credentials.set(key, credential);
  }
  const res = await credential.getPassword();
  if (res) {
    accessedCredentials.set(key, res);
  }
  return res;
}

/**
 * @param {string} key
 * @param {string} password
 * @returns {Promise<void>}
 */
export async function setPassword(key, password) {
  accessedCredentials.set(key, password);
  let credential = credentials.get(key);
  if (!credential) {
    credential = new AsyncEntry(KEYRING_SERVICE, key);
    credentials.set(key, credential);
  }
  await credential.setPassword(password);
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function deleteKey(key) {
  accessedCredentials.delete(key);
  let credential = credentials.get(key);
  credentials.delete(key);
  if (!credential) {
    credential = new AsyncEntry(KEYRING_SERVICE, key);
  }
  await credential.deletePassword();
}
