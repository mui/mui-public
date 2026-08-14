export const normalizeGitHubLogin = (login) => login.replace(/\[bot\]$/i, '').toLowerCase();
